/**
 * SQLite database: connection, schema, and first-run seeding.
 *
 * The driver is isolated to this file. We use `better-sqlite3` (synchronous,
 * clean API). If it ever fails to build on a machine, the only change needed
 * is the two lines marked "DRIVER" below — swap to Node's built-in
 *   const { DatabaseSync } = require("node:sqlite");
 *   const db = new DatabaseSync(DB_PATH);
 * and run the server with `node --experimental-sqlite`. The rest of the app
 * (prepare/run/all/get, exec, PRAGMA-via-exec) works the same on both.
 */
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

// DRIVER (better-sqlite3)
const Database = require("better-sqlite3");
const DB_PATH = path.join(__dirname, "data.db");
const db = new Database(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ---- Schema -------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    price      REAL    NOT NULL,
    category   TEXT    NOT NULL DEFAULT 'Fast Food',
    image      TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    amount              REAL    NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'paid',
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    product_id INTEGER,
    name       TEXT    NOT NULL,
    price      REAL    NOT NULL,
    quantity   INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

// A given Razorpay order/payment must map to at most one row, so replaying a
// valid payment can't mint duplicate orders. Defined as indexes (not inline
// UNIQUE) so they also apply to a pre-existing data.db. NULLs don't collide in
// SQLite, so pending orders (no payment id yet) are unaffected.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_rzp_order   ON orders(razorpay_order_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_rzp_payment ON orders(razorpay_payment_id);
`);

// ---- Seeding ------------------------------------------------------------

/** Products added on top of the ones in products.json (only real images used). */
const EXTRA_PRODUCTS = [
  { name: "French Fries", price: 40.0, category: "Fast Food", image: "images/french-fries.png" },
  { name: "Veggie Sub", price: 48.0, category: "Fast Food", image: "images/sandwich.png" },
  { name: "Double Cheese Pizza", price: 110.0, category: "Fast Food", image: "images/pizza.png" },
];

function seedProducts() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  if (count > 0) return; // already seeded

  // Load base products from products.json, de-duplicating by name (the file
  // has "Chicken lasagna" twice — keep the first).
  let base = [];
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "products.json"), "utf-8");
    base = JSON.parse(raw);
  } catch (err) {
    console.warn("[db] products.json not found/invalid, seeding extras only:", err.message);
  }

  const byName = new Map();
  for (const p of base) {
    const key = String(p.name || "").trim().toLowerCase();
    if (!key || byName.has(key)) continue;
    byName.set(key, {
      name: p.name,
      price: Number(p.price) || 0,
      category: p.category || "Fast Food",
      image: p.image || "",
    });
  }
  for (const p of EXTRA_PRODUCTS) {
    const key = p.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, p);
  }

  const insert = db.prepare(
    "INSERT INTO products (name, price, category, image) VALUES (?, ?, ?, ?)"
  );
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r.name, r.price, r.category, r.image);
  });
  insertMany([...byName.values()]);
  console.log(`[db] Seeded ${byName.size} products.`);
}

function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "admin@fastfood.com").toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return;

  const password = process.env.ADMIN_PASSWORD;
  if (!password || password === "change-me-before-deploying") {
    throw new Error("ADMIN_PASSWORD is required before the first startup. Set a strong value in .env.");
  }
  if (false) {
    console.warn(
      "[db] ADMIN_PASSWORD not set — seeding admin with the weak default 'admin123'. Set ADMIN_PASSWORD in .env."
    );
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')"
  ).run("Admin", email, hash);
  console.log(`[db] Seeded admin account: ${email}`);
}

seedProducts();
seedAdmin();

module.exports = db;
