/**
 * FastFood API server.
 *   - Express REST API (auth, products, payment, orders)
 *   - Serves the static frontend from the project root (explicit whitelist so
 *     secrets like .env and server/data.db are never reachable over HTTP)
 */
require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const Razorpay = require("razorpay");
const { OAuth2Client } = require("google-auth-library");

const { query } = require("./db.pg");
const { signToken, publicUser, authMiddleware, adminOnly } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");

app.use(cors());
app.use(express.json({ limit: "64kb" })); // cap request bodies (carts are tiny)

// ---- Razorpay (optional — only if TEST keys are configured) -------------
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const razorpay =
  RZP_KEY_ID && RZP_KEY_SECRET
    ? new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET })
    : null;

// ---- Google Sign-In (optional — only if a Client ID is configured) ------
// Only the public Client ID is needed to VERIFY Google ID tokens (no secret).
// Leave GOOGLE_CLIENT_ID blank in .env to disable the "Sign in with Google"
// button gracefully, exactly like the Razorpay-not-configured path above.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = GOOGLE_CLIENT_ID
  ? new OAuth2Client(GOOGLE_CLIENT_ID)
  : null;

// =========================================================================
// AUTH
// =========================================================================
app.post("/api/auth/signup", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters",
      });
    }

    const exists = await query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);

    if (exists.rows.length > 0) {
      return res.status(409).json({
        error: "Email already registered",
      });
    }

    const hash = bcrypt.hashSync(password, 10);

    const result = await query(
      `INSERT INTO users
        (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'user')
       RETURNING *`,
      [name, email, hash],
    );

    const user = result.rows[0];

    res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("[auth] signup failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    const result = await query("SELECT * FROM users WHERE email = $1", [email]);

    const user = result.rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({
        error: "Invalid email or password",
      });
    }

    res.json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("[auth] login failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const result = await query("SELECT * FROM users WHERE id = $1", [
      req.user.id,
    ]);

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json({
      user: publicUser(user),
    });
  } catch (error) {
    console.error("[auth] me failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});
/**
 * Sign in with Google (Google Identity Services, ID-token flow).
 * The browser obtains a Google ID token ("credential") and posts it here. We
 * verify it against our public Client ID — checking Google's signature, the
 * audience, and the expiry — then find-or-create the matching user and issue
 * our OWN app JWT, so the rest of the app treats Google users like any other.
 */
app.post("/api/auth/google", async (req, res) => {
  if (!googleClient) {
    return res.status(400).json({
      error: "Google sign-in is not configured. Add GOOGLE_CLIENT_ID to .env",
    });
  }

  const credential = req.body.credential || "";

  if (!credential) {
    return res.status(400).json({
      error: "Missing Google credential",
    });
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({
      error: "Invalid Google credential",
    });
  }

  const email = (payload.email || "").trim().toLowerCase();

  if (!email || payload.email_verified === false) {
    return res.status(401).json({
      error: "Your Google account has no verified email",
    });
  }

  const name = (
    payload.name ||
    payload.given_name ||
    email.split("@")[0]
  ).trim();

  try {
    const existing = await query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    let user = existing.rows[0];

    if (!user) {
      const randomHash = bcrypt.hashSync(
        crypto.randomBytes(32).toString("hex"),
        10,
      );

      const result = await query(
        `INSERT INTO users
          (name, email, password_hash, role)
         VALUES ($1, $2, $3, 'user')
         RETURNING *`,
        [name, email, randomHash],
      );

      user = result.rows[0];
    }

    res.json({
      token: signToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("[auth] Google login failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});
// Public runtime config the frontend needs before login (safe to expose — the
// Google Client ID is public by design; no secret is ever sent here).
app.get("/api/config", (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

// =========================================================================
// PRODUCTS
// =========================================================================
app.get("/api/products", async (req, res) => {
  try {
    const result = await query("SELECT * FROM products ORDER BY id");

    res.json(result.rows);
  } catch (error) {
    console.error("[products] fetch failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.post("/api/products", authMiddleware, adminOnly, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const price = Number(req.body.price);
    const category = (req.body.category || "Fast Food").trim();
    const image = (req.body.image || "").trim();

    if (!name || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({
        error: "Valid name and price are required",
      });
    }

    const result = await query(
      `INSERT INTO products
        (name, price, category, image)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, price, category, image],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("[products] create failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.put("/api/products/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Invalid product id",
      });
    }

    const existingResult = await query("SELECT * FROM products WHERE id = $1", [
      id,
    ]);

    const existing = existingResult.rows[0];

    if (!existing) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    const name = (req.body.name ?? existing.name).trim();
    const price =
      req.body.price != null ? Number(req.body.price) : existing.price;

    const category = (req.body.category ?? existing.category).trim();

    const image = (req.body.image ?? existing.image).trim();

    if (!name || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({
        error: "Valid name and price are required",
      });
    }

    const result = await query(
      `UPDATE products
       SET name = $1,
           price = $2,
           category = $3,
           image = $4
       WHERE id = $5
       RETURNING *`,
      [name, price, category, image, id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("[products] update failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.delete("/api/products/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        error: "Invalid product id",
      });
    }

    const result = await query(
      "DELETE FROM products WHERE id = $1 RETURNING id",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    console.error("[products] delete failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

// =========================================================================
// PAYMENT (Razorpay, TEST mode)
// =========================================================================

/**
 * Recompute the cart total on the server from trusted DB prices so a client
 * can't tamper with amounts. Every line item MUST reference a real product by
 * id — unknown/missing ids are rejected and the client-sent name/price are
 * never trusted. Throws an Error with `.status = 400` on invalid input, which
 * callers turn into a 400 response. Returns { amount (₹), items: normalized[] }.
 */
async function findProduct(id) {
  const result = await query(
    "SELECT id, name, price FROM products WHERE id = $1",
    [id],
  );

  return result.rows[0] || null;
}
const MAX_CART_ITEMS = 100;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0)
    throw badRequest("Cart is empty");
  if (items.length > MAX_CART_ITEMS) throw badRequest("Too many items in cart");

  const normalized = [];
  let amount = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") throw badRequest("Invalid cart item");
    const product = await findProduct(raw.id);
    if (!product) throw badRequest("Unknown product in cart");
    const qty = Math.max(1, parseInt(raw.quantity, 10) || 1);
    amount += product.price * qty;
    normalized.push({
      product_id: product.id,
      name: product.name,
      price: product.price,
      quantity: qty,
    });
  }
  return { amount: Math.round(amount * 100) / 100, items: normalized };
}

app.post("/api/payment/order", authMiddleware, async (req, res) => {
  if (!razorpay) {
    return res
      .status(400)
      .json({ error: "Razorpay keys not configured. Add them to .env" });
  }
  try {
    const { amount, items } = await priceCart(req.body.items);

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: `rcpt_${req.user.id}_${Date.now()}`,
    });

    // Persist a pending order bound to this Razorpay order id, this user, and
    // the server-priced amount/items. /verify reconciles against THIS record
    // instead of trusting the client, so the charged and recorded amounts match.
    const client = await require("./db.pg").pool.connect();

    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        `INSERT INTO orders
      (user_id, razorpay_order_id, amount, status)
     VALUES ($1, $2, $3, 'created')
     RETURNING id`,
        [req.user.id, order.id, amount],
      );

      const orderDbId = orderResult.rows[0].id;

      for (const it of items) {
        await client.query(
          `INSERT INTO order_items
        (order_id, product_id, name, price, quantity)
       VALUES ($1, $2, $3, $4, $5)`,
          [orderDbId, it.product_id, it.name, it.price, it.quantity],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: RZP_KEY_ID,
      items,
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error("[payment] order create failed:", err?.error || err);
    res.status(502).json({ error: "Could not create payment order" });
  }
});

app.post("/api/payment/verify", authMiddleware, async (req, res) => {
  if (!razorpay) {
    return res
      .status(400)
      .json({ error: "Razorpay keys not configured. Add them to .env" });
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing payment fields" });
  }

  // Verify signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret),
  // compared in constant time (matches Razorpay's own SDK, avoids timing leaks).
  const expected = crypto
    .createHmac("sha256", RZP_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  const expBuf = Buffer.from(expected, "hex");
  const gotBuf = Buffer.from(String(razorpay_signature), "hex");
  if (
    expBuf.length !== gotBuf.length ||
    !crypto.timingSafeEqual(expBuf, gotBuf)
  ) {
    return res.status(400).json({ error: "Payment verification failed" });
  }

  // Reconcile against the pending order THIS server created for THIS user. The
  // amount and items come from that stored record — never from the request body
  // — so a valid signature can't be replayed with a tampered cart or amount.
  const orderResult = await query(
    "SELECT * FROM orders WHERE razorpay_order_id = $1",
    [razorpay_order_id],
  );

  const order = orderResult.rows[0];
  if (!order || order.user_id !== req.user.id) {
    return res.status(404).json({ error: "Order not found" });
  }

  // Idempotent: replaying a completed verification returns the same order
  // rather than minting a duplicate.
  if (order.status === "paid") {
    return res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
    });
  }

  try {
    await query(
      `UPDATE orders
   SET status = 'paid',
       razorpay_payment_id = $1
   WHERE id = $2`,
      [razorpay_payment_id, order.id],
    );
  } catch (err) {
    // UNIQUE(razorpay_payment_id) violation → this payment was already recorded
    // (e.g. a concurrent replay). Return the existing paid order.
    const existingResult = await query(
      "SELECT id, amount FROM orders WHERE razorpay_payment_id = $1",
      [razorpay_payment_id],
    );

    const existing = existingResult.rows[0];
    if (existing)
      return res.json({
        success: true,
        order_id: existing.id,
        amount: existing.amount,
      });
    throw err;
  }

  res.json({ success: true, order_id: order.id, amount: order.amount });
});

// =========================================================================
// ORDERS (history)
// =========================================================================
app.get("/api/orders", authMiddleware, async (req, res) => {
  try {
    const ordersResult = await query(
      `SELECT *
       FROM orders
       WHERE user_id = $1
         AND status = 'paid'
       ORDER BY id DESC`,
      [req.user.id]
    );

    const orders = ordersResult.rows;

    for (const order of orders) {
      const itemsResult = await query(
        `SELECT name, price, quantity
         FROM order_items
         WHERE order_id = $1`,
        [order.id]
      );

      order.items = itemsResult.rows;
    }

    res.json(orders);
  } catch (error) {
    console.error("[orders] fetch failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});
// =========================================================================
// STATIC FRONTEND (explicit whitelist — keeps .env, data.db, server/ private)
// =========================================================================
app.use("/images", express.static(path.join(ROOT, "images")));

const PUBLIC_FILES = [
  "index.html",
  "main.js",
  "style1.css",
  "admin.html",
  "admin.js",
  "products.json",
];
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
for (const file of PUBLIC_FILES) {
  app.get("/" + file, (req, res) => res.sendFile(path.join(ROOT, file)));
}

// JSON 404 for unknown API routes
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler — turns an unexpected throw into a JSON 500 rather than
// a crash. Express recognises it by its 4-argument signature, so it must come
// after the routes.
app.use((err, req, res, next) => {
  console.error("[error]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

// Last-resort safety nets so a single bad request can never take the process
// down (the root causes are fixed above; these are defence in depth).
process.on("unhandledRejection", (reason) =>
  console.error("[unhandledRejection]", reason),
);
process.on("uncaughtException", (err) =>
  console.error("[uncaughtException]", err),
);

app.listen(PORT, () => {
  console.log(`\n🍔 FastFood server running at http://localhost:${PORT}`);
  console.log(
    `   Razorpay: ${razorpay ? "configured ✓" : "NOT configured (add keys to .env)"}`,
  );
  console.log(
    `   Google sign-in: ${googleClient ? "configured ✓" : "NOT configured (add GOOGLE_CLIENT_ID to .env)"}`,
  );
});
