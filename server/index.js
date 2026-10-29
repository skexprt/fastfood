/**
 * FastFood API server.
 *   - Express REST API (auth, products, payment, orders)
 *   - Serves the static frontend from the project root (explicit whitelist so
 *     secrets and database files are never reachable over HTTP)
 */
require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Razorpay = require("razorpay");
const { OAuth2Client } = require("google-auth-library");

const { query, pool } = require("./db.pg");
const { signToken, publicUser, authMiddleware, adminOnly } = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdn.jsdelivr.net",
          "data:",
        ],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        frameSrc: [
          "https://accounts.google.com",
          "https://*.razorpay.com",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://accounts.google.com",
          "https://*.razorpay.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
          "https://accounts.google.com",
        ],
        connectSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://www.googleapis.com",
          "https://*.razorpay.com",
        ],
      },
    },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  }),
);
app.use(express.json({ limit: "64kb" })); // cap request bodies (carts are tiny)
app.use((req, res, next) => {
  req.body = req.body || {};
  next();
});
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  }),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again later." },
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many payment requests. Please try again later." },
});

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeProductImage(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return null;
  const image = value.trim();
  if (!image) return "";
  if (image.length > 2048) return null;
  if (/^\/?images\/[A-Za-z0-9._/-]+$/.test(image) && !image.includes("..")) {
    return image.replace(/^\/+/, "");
  }
  try {
    const url = new URL(image);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    return null;
  }
  return null;
}

function validateProductInput({ name, price, category, image }) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 120 ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 100000 ||
    typeof category !== "string" ||
    !category.trim() ||
    category.trim().length > 60 ||
    image === null
  ) {
    return false;
  }
  return true;
}

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
app.post("/api/auth/signup", authLimiter, async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!name || name.length > 80 || !isValidEmail(email) || !password) {
      return res.status(400).json({
        error: "Enter a valid name and email address",
      });
    }

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and no more than 72 bytes",
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

    const hash = await bcrypt.hash(password, 12);

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
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already registered" });
    }
    console.error("[auth] signup failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!isValidEmail(email) || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Enter a valid email and password" });
    }

    const result = await query("SELECT * FROM users WHERE email = $1", [email]);

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
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
app.post("/api/auth/google", authLimiter, async (req, res) => {
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

  if (!email || payload.email_verified !== true) {
    return res.status(401).json({
      error: "Your Google account has no verified email",
    });
  }

  const name = (
    payload.name ||
    payload.given_name ||
    email.split("@")[0]
  )
    .trim()
    .slice(0, 80);

  try {
    const existing = await query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    let user = existing.rows[0];

    if (!user) {
      const randomHash = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        12,
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
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const price = req.body.price;
    const category =
      typeof req.body.category === "string"
        ? req.body.category.trim()
        : "Fast Food";
    const image =
      req.body.image == null ? "" : normalizeProductImage(req.body.image);

    if (!validateProductInput({ name, price, category, image })) {
      return res.status(400).json({
        error: "Enter a valid name, price, category, and image",
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

    const name =
      req.body.name == null
        ? existing.name
        : typeof req.body.name === "string"
          ? req.body.name.trim()
          : null;
    const price =
      req.body.price != null
        ? typeof req.body.price === "number"
          ? req.body.price
          : NaN
        : existing.price;

    const category =
      req.body.category == null
        ? existing.category
        : typeof req.body.category === "string"
          ? req.body.category.trim()
          : null;

    const image =
      req.body.image == null
        ? normalizeProductImage(existing.image)
        : normalizeProductImage(req.body.image);

    if (!validateProductInput({ name, price, category, image })) {
      return res.status(400).json({
        error: "Enter a valid name, price, category, and image",
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
    if (error.code === "23503") {
      return res.status(409).json({
        error: "This product is used in order history and cannot be deleted",
      });
    }
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
const MAX_CART_ITEMS = 50;
const MAX_ITEM_QUANTITY = 20;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0)
    throw badRequest("Cart is empty");
  if (items.length > MAX_CART_ITEMS) throw badRequest("Too many items in cart");

  const seen = new Set();
  const quantities = items.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw badRequest("Invalid cart item");
    }
    if (!Number.isInteger(raw.id) || raw.id <= 0 || seen.has(raw.id)) {
      throw badRequest("Invalid or duplicate product in cart");
    }
    if (
      !Number.isInteger(raw.quantity) ||
      raw.quantity < 1 ||
      raw.quantity > MAX_ITEM_QUANTITY
    ) {
      throw badRequest(`Item quantity must be between 1 and ${MAX_ITEM_QUANTITY}`);
    }
    seen.add(raw.id);
    return { id: raw.id, quantity: raw.quantity };
  });

  const productsResult = await query(
    "SELECT id, name, price FROM products WHERE id = ANY($1::int[])",
    [[...seen]],
  );
  const productsById = new Map(
    productsResult.rows.map((product) => [Number(product.id), product]),
  );
  const normalized = [];
  let amountPaise = 0;
  for (const item of quantities) {
    const product = productsById.get(item.id);
    if (!product) throw badRequest("Unknown product in cart");
    const pricePaise = Math.round(Number(product.price) * 100);
    amountPaise += pricePaise * item.quantity;
    if (amountPaise > 10000000) {
      throw badRequest("Cart total exceeds the maximum order value");
    }
    normalized.push({
      product_id: product.id,
      name: product.name,
      price: pricePaise / 100,
      quantity: item.quantity,
    });
  }
  if (amountPaise === 0) {
    throw badRequest("Order total must be greater than zero");
  }
  return { amount: amountPaise / 100, items: normalized };
}

app.post(
  "/api/payment/order",
  authMiddleware,
  paymentLimiter,
  async (req, res) => {
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

      // Bind the provider order to server-priced items before opening checkout.
      const client = await pool.connect();

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
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      console.error("[payment] order create failed:", err?.error || err);
      res.status(502).json({ error: "Could not create payment order" });
    }
  },
);

app.post(
  "/api/payment/verify",
  authMiddleware,
  paymentLimiter,
  asyncRoute(async (req, res) => {
    if (!razorpay) {
      return res
        .status(400)
        .json({ error: "Razorpay keys not configured. Add them to .env" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;
    if (
      typeof razorpay_order_id !== "string" ||
      !/^order_[A-Za-z0-9]+$/.test(razorpay_order_id) ||
      typeof razorpay_payment_id !== "string" ||
      !/^pay_[A-Za-z0-9]+$/.test(razorpay_payment_id) ||
      typeof razorpay_signature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(razorpay_signature)
    ) {
      return res.status(400).json({ error: "Missing payment fields" });
    }

    const expected = crypto
      .createHmac("sha256", RZP_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(razorpay_signature, "hex");
    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const orderResult = await query(
      "SELECT * FROM orders WHERE razorpay_order_id = $1",
      [razorpay_order_id],
    );
    const order = orderResult.rows[0];
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.status === "paid") {
      if (order.razorpay_payment_id !== razorpay_payment_id) {
        return res
          .status(409)
          .json({ error: "Order was completed with another payment" });
      }
      return res.json({
        success: true,
        order_id: order.id,
        amount: order.amount,
      });
    }

    let payment = await razorpay.payments.fetch(razorpay_payment_id);
    const amountPaise = Math.round(Number(order.amount) * 100);
    if (
      payment.order_id !== razorpay_order_id ||
      payment.currency !== "INR" ||
      payment.amount !== amountPaise
    ) {
      return res.status(400).json({ error: "Payment does not match this order" });
    }
    if (payment.status === "authorized") {
      payment = await razorpay.payments.capture(
        razorpay_payment_id,
        amountPaise,
        "INR",
      );
    }
    if (payment.status !== "captured") {
      return res.status(400).json({ error: "Payment has not been captured" });
    }

    try {
      await query(
        `UPDATE orders
         SET status = 'paid',
             razorpay_payment_id = $1
         WHERE id = $2`,
        [razorpay_payment_id, order.id],
      );
    } catch (error) {
      const existingResult = await query(
        `SELECT id, amount
         FROM orders
         WHERE razorpay_payment_id = $1`,
        [razorpay_payment_id],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        return res.json({
          success: true,
          order_id: existing.id,
          amount: existing.amount,
        });
      }
      throw error;
    }

    res.json({ success: true, order_id: order.id, amount: order.amount });
  }),
);

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
       ORDER BY id DESC
       LIMIT 100`,
      [req.user.id]
    );

    const orders = ordersResult.rows;
    if (orders.length === 0) return res.json([]);

    const itemsResult = await query(
      `SELECT order_id, name, price, quantity
       FROM order_items
       WHERE order_id = ANY($1::int[])
       ORDER BY id`,
      [orders.map((order) => order.id)],
    );
    const itemsByOrder = new Map(orders.map((order) => [Number(order.id), []]));
    for (const item of itemsResult.rows) {
      itemsByOrder.get(Number(item.order_id)).push({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      });
    }
    for (const order of orders) order.items = itemsByOrder.get(Number(order.id));

    res.json(orders);
  } catch (error) {
    console.error("[orders] fetch failed:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

app.get(
  "/api/health",
  asyncRoute(async (req, res) => {
    try {
      await query("SELECT 1");
      res.json({ status: "ok" });
    } catch (error) {
      console.error("[health] database check failed:", error);
      res.status(503).json({ status: "unavailable" });
    }
  }),
);

// =========================================================================
// STATIC FRONTEND (explicit whitelist — keeps .env, data.db, server/ private)
// =========================================================================
app.use(
  "/images",
  express.static(path.join(ROOT, "images"), {
    maxAge: "1d",
    etag: true,
    lastModified: true,
    index: false,
  }),
);

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
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`\n🍔 FastFood server running at http://localhost:${PORT}`);
  console.log(
    `   Razorpay: ${razorpay ? "configured ✓" : "NOT configured (add keys to .env)"}`,
  );
  console.log(
    `   Google sign-in: ${googleClient ? "configured ✓" : "NOT configured (add GOOGLE_CLIENT_ID to .env)"}`,
  );
});

function shutdown(signal) {
  console.log(`[server] ${signal} received; closing gracefully`);
  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("[server] shutdown failed:", error);
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
  process.exit(1);
});
