require("dotenv").config();

const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { query, pool, initDatabase } = require("./db.pg");

async function seedProducts() {
  const existing = await query("SELECT COUNT(*)::int AS count FROM products");

  if (existing.rows[0].count > 0) {
    console.log("Products already exist. Skipping product seed.");
    return;
  }

  const productsPath = path.join(__dirname, "..", "products.json");
  const raw = fs.readFileSync(productsPath, "utf8");
  const products = JSON.parse(raw);

  const extraProducts = [
    {
      name: "French Fries",
      price: 40,
      category: "Fast Food",
      image: "images/french-fries.png",
    },
    {
      name: "Veggie Sub",
      price: 48,
      category: "Fast Food",
      image: "images/sandwich.png",
    },
    {
      name: "Double Cheese Pizza",
      price: 110,
      category: "Fast Food",
      image: "images/pizza.png",
    },
  ];

  const byName = new Map();

  for (const product of products) {
    const name = String(product.name || "").trim();
    const key = name.toLowerCase();

    if (!key || byName.has(key)) continue;

    byName.set(key, {
      name,
      price: Number(product.price) || 0,
      category: product.category || "Fast Food",
      image: product.image || "",
    });
  }

  for (const product of extraProducts) {
    const key = product.name.toLowerCase();

    if (!byName.has(key)) {
      byName.set(key, product);
    }
  }

  for (const product of byName.values()) {
    await query(
      `INSERT INTO products (name, price, category, image)
       VALUES ($1, $2, $3, $4)`,
      [
        product.name,
        product.price,
        product.category,
        product.image,
      ]
    );
  }

  console.log(`Seeded ${byName.size} products.`);
}

async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD are required."
    );
  }

  const existing = await query(
    "SELECT id FROM users WHERE email = $1",
    [email]
  );

  if (existing.rows.length > 0) {
    console.log("Admin already exists. Skipping admin seed.");
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  await query(
    `INSERT INTO users
      (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    ["Admin", email, passwordHash]
  );

  console.log(`Seeded admin account: ${email}`);
}

async function main() {
  await initDatabase();
  await seedProducts();
  await seedAdmin();

  const products = await query("SELECT COUNT(*)::int AS count FROM products");
  const users = await query("SELECT COUNT(*)::int AS count FROM users");

  console.log(`Products: ${products.rows[0].count}`);
  console.log(`Users: ${users.rows[0].count}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });