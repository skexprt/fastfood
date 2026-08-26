# 🍔 FastFood — Full-Stack Food Ordering App

A full-stack food-ordering web application: browse a menu, register/sign in, add items to a cart, pay through **Razorpay**, and view your order history. Includes a role-based **admin panel** for managing the menu.

Built with a **Node.js + Express** REST API, a **SQLite** database, **JWT authentication** with **bcrypt** password hashing, and **server-verified Razorpay payments** (test mode). The frontend is vanilla HTML/CSS/JavaScript served by the same server, so the whole app runs from a single `npm start`.

> **Payments run in Razorpay TEST mode** — no real money is charged. Add your own free Razorpay test keys to enable the live checkout flow (see [Setup](#-setup)).

---

## ✨ Features

- **Menu** loaded from a REST API backed by SQLite (11 seeded products).
- **Authentication** — register & log in with real password hashing (bcrypt) and stateless **JWT** sessions that persist across reloads.
- **Cart** — add/remove items, adjust quantities, live total (persisted in `localStorage`).
- **Checkout with Razorpay** — the server creates the order and **verifies the payment signature (HMAC-SHA256)** before saving it. The order total is **recomputed server-side** from trusted DB prices, so the client can't tamper with the amount.
- **Order history** — each user sees their past orders with line items.
- **Admin panel** (`admin.html`) — role-gated dashboard to **add / edit / delete** products. Changes appear in the store immediately.
- **Role-based UI** — the admin link only shows for admin accounts.
- **Security-minded static serving** — only whitelisted files are served, so `.env` and the database file are never reachable over HTTP.

---

## 🛠 Tech Stack

| Layer     | Technology                                             |
| --------- | ------------------------------------------------------ |
| Backend   | Node.js, Express                                       |
| Database  | SQLite (`better-sqlite3`)                              |
| Auth      | JSON Web Tokens (`jsonwebtoken`), `bcryptjs`           |
| Payments  | Razorpay SDK (order creation + HMAC signature verify)  |
| Frontend  | Vanilla HTML, CSS, JavaScript (Swiper for the slider)  |
| Config    | `dotenv`, `cors`                                       |

---

## 🚀 Setup

**Prerequisites:** [Node.js](https://nodejs.org/) 18 or newer (includes npm).

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your environment file** — copy the example and fill it in:

   ```bash
   cp .env.example .env
   ```

   | Variable             | Description                                           |
   | -------------------- | ----------------------------------------------------- |
   | `PORT`               | Server port (default `3000`)                          |
   | `JWT_SECRET`         | Any long random string used to sign tokens            |
   | `ADMIN_EMAIL`        | Email for the auto-seeded admin account               |
   | `ADMIN_PASSWORD`     | Password for the auto-seeded admin account            |
   | `RAZORPAY_KEY_ID`    | Your Razorpay **test** key id (optional)              |
   | `RAZORPAY_KEY_SECRET`| Your Razorpay **test** key secret (optional)          |

3. **Run the server**

   ```bash
   npm start
   ```

   Open **http://localhost:3000**. On first run the database is created and seeded automatically (11 products + one admin account).

   For development with auto-restart on file changes:

   ```bash
   npm run dev
   ```

### Default admin login

The app seeds an admin account from your `.env` on its first run. Use it to open the admin panel at **http://localhost:3000/admin.html**:

```
Email:    admin@fastfood.com
Password: the `ADMIN_PASSWORD` value you set in `.env`
```

> Set a strong `ADMIN_PASSWORD` in `.env` before the first startup. The server will refuse to create an admin account with a missing password.

### Enabling payments (Razorpay TEST mode)

1. Create a free account at [razorpay.com](https://razorpay.com) and switch the dashboard to **Test Mode**.
2. Go to **Settings → API Keys → Generate Test Key**.
3. Paste the key id and secret into `.env` as `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` and restart the server.
4. At checkout, use a [Razorpay test card](https://razorpay.com/docs/payments/payments/test-card-details/) (e.g. card `4111 1111 1111 1111`, any future expiry, any CVV).

If the keys are absent, the app runs fine and the checkout button explains that payments aren't configured — nothing crashes.

---

## 📡 API Reference

All request/response bodies are JSON. Protected routes require an `Authorization: Bearer <token>` header.

### Auth

| Method | Endpoint           | Auth | Body                        | Description                     |
| ------ | ------------------ | ---- | --------------------------- | ------------------------------- |
| POST   | `/api/auth/signup` | —    | `{ name, email, password }` | Register; returns `{token,user}`|
| POST   | `/api/auth/login`  | —    | `{ email, password }`       | Log in; returns `{token,user}`  |
| GET    | `/api/auth/me`     | User | —                           | Current user from token         |

### Products

| Method | Endpoint            | Auth  | Body                              | Description        |
| ------ | ------------------- | ----- | --------------------------------- | ------------------ |
| GET    | `/api/products`     | —     | —                                 | List all products  |
| POST   | `/api/products`     | Admin | `{ name, price, category, image }`| Create a product   |
| PUT    | `/api/products/:id` | Admin | `{ name, price, category, image }`| Update a product   |
| DELETE | `/api/products/:id` | Admin | —                                 | Delete a product   |

### Payment (Razorpay, test mode)

| Method | Endpoint              | Auth | Body                                                                          | Description                                   |
| ------ | --------------------- | ---- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| POST   | `/api/payment/order`  | User | `{ items: [{ id, quantity }] }`                                               | Create a Razorpay order (amount priced server-side) |
| POST   | `/api/payment/verify` | User | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature, items }`       | Verify signature and save the order           |

### Orders

| Method | Endpoint       | Auth | Body | Description                        |
| ------ | -------------- | ---- | ---- | ---------------------------------- |
| GET    | `/api/orders`  | User | —    | Current user's orders + line items |

---

## 🗄 Database Schema

SQLite file at `server/data.db`, created and seeded on first run.

- **users** — `id, name, email (unique), password_hash, role ('user' | 'admin'), created_at`
- **products** — `id, name, price, category, image, created_at`
- **orders** — `id, user_id → users, razorpay_order_id, razorpay_payment_id, amount, status, created_at`
- **order_items** — `id, order_id → orders, product_id, name, price, quantity`

---

## 🔒 Security Notes

- Passwords are hashed with **bcrypt** — plaintext passwords are never stored.
- Sessions use signed **JWTs**; the client only ever holds a token, never credentials.
- **Payment amounts are recomputed on the server** from DB prices — the client cannot change what it's charged.
- Razorpay **payment signatures are verified** with HMAC-SHA256 before an order is recorded.
- Static file serving uses an **explicit whitelist**, so `.env`, `server/data.db`, and other server files are never exposed over HTTP.
- Secrets and the database are **git-ignored** (`.env`, `*.db`, `node_modules`).

---

## 📁 Project Structure

```
FastFood/
├── server/
│   ├── index.js      Express app: API routes + static frontend
│   ├── db.js         SQLite connection, schema, first-run seeding
│   ├── auth.js       JWT sign/verify + auth & admin guards
│   └── data.db       SQLite database (auto-created, git-ignored)
├── index.html        Store front (menu, cart, auth modal, orders)
├── main.js           Frontend logic (API calls, cart, auth, checkout)
├── admin.html        Admin dashboard
├── admin.js          Admin logic (product CRUD)
├── style1.css        Styles
├── products.json     Seed source for the initial menu
├── images/           Product images
├── .env.example      Environment template
└── package.json
```

---

## 🌱 Possible Next Steps

- Deploy to a host (e.g. Render/Railway) with a persistent volume for SQLite.
- Add product search & category filters.
- Order status tracking (preparing → out for delivery → delivered).
- Move JWTs to httpOnly cookies for stronger XSS protection.

---

Built as a portfolio project to demonstrate full-stack fundamentals: REST API design, authentication, database modeling, third-party payment integration, and secure server practices.
