# 🍔 FastFood — Full-Stack Food Ordering App

A full-stack food-ordering web application: browse a menu, register/sign in, add items to a cart, pay through **Razorpay**, and view your order history. Includes a role-based **admin panel** for managing the menu.

Built with a **Node.js + Express** REST API, **PostgreSQL**, **JWT authentication** with **bcrypt** password hashing, and server-verified Razorpay payments. The frontend is vanilla HTML/CSS/JavaScript served by the same server.

> Configure Razorpay test credentials first. Do not enable live payments until the deployment, payment capture settings, HTTPS, and webhook/reconciliation procedures have been reviewed.

---

## ✨ Features

- **Menu** loaded from PostgreSQL, with search and category filters.
- **Authentication** — register & log in with real password hashing (bcrypt) and stateless **JWT** sessions that persist across reloads.
- **Cart** — add/remove items, adjust quantities, live total (persisted in `localStorage`).
- **Checkout with Razorpay** — the server prices the cart from trusted DB records, verifies the payment signature, and confirms the captured payment amount/currency before marking an order paid.
- **Order history** — each user sees their past orders with line items.
- **Admin panel** (`admin.html`) — role-gated dashboard to **add / edit / delete** products. Changes appear in the store immediately.
- **Role-based UI** — the admin link only shows for admin accounts.
- **Security controls** — CSP/security headers, origin allowlisting, request limits, route-specific rate limits, strict input validation, and an explicit static-file allowlist.

---

## 🛠 Tech Stack

| Layer     | Technology                                             |
| --------- | ------------------------------------------------------ |
| Backend   | Node.js, Express                                       |
| Database  | PostgreSQL (`pg`)                                      |
| Auth      | JSON Web Tokens (`jsonwebtoken`), `bcryptjs`           |
| Payments  | Razorpay SDK (order creation + HMAC signature verify)  |
| Frontend  | Vanilla HTML, CSS, JavaScript (Swiper for the slider)  |
| Config    | `dotenv`, `cors`, `helmet`, `express-rate-limit`       |

---

## 🚀 Setup

**Prerequisites:** [Node.js](https://nodejs.org/) 18 or newer and a PostgreSQL database.

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your environment file** — copy the example and replace every placeholder:

   ```bash
   copy .env.example .env
   ```

   Set `DATABASE_URL`, a unique random `JWT_SECRET` (at least 32 characters), and a valid `ADMIN_EMAIL` plus an `ADMIN_PASSWORD` (16–72 UTF-8 bytes). `DATABASE_SSL=disable` is intended only for local PostgreSQL; production connections verify TLS certificates by default. Set `CORS_ORIGINS` only when hosting a separate frontend, and list exact trusted origins separated by commas. Set `TRUST_PROXY=true` only when requests pass through one trusted reverse proxy.

3. **Create the schema and initial admin/menu**

   ```bash
   npm run db:seed
   ```

4. **Start the server**

   ```bash
   npm start
   ```

   Open **http://localhost:3000**. Do not open `index.html` directly: sign-in, menu, and checkout need the running API. The health/readiness endpoint is **http://localhost:3000/api/health** and should return `{"status":"ok"}` before signing in.

   For development with auto-restart on file changes:

   ```bash
   npm run dev
   ```

### Admin login

The seed command creates the admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Use those credentials at **http://localhost:3000/admin.html**. The password is not reset when the seed script runs again.

> Use a unique password manager-generated admin password. Keep `.env` out of source control.

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
| GET    | `/api/health`      | —    | —                           | Database-backed readiness check |

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
| POST   | `/api/payment/verify` | User | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`              | Verify signature and captured payment, then save the order |

### Orders

| Method | Endpoint       | Auth | Body | Description                        |
| ------ | -------------- | ---- | ---- | ---------------------------------- |
| GET    | `/api/orders`  | User | —    | Current user's orders + line items |

---

## 🗄 Database Schema

PostgreSQL schema created by `npm run db:seed`; the same command seeds the menu and initial admin account.

- **users** — `id, name, email (unique), password_hash, role ('user' | 'admin'), created_at`
- **products** — `id, name, price, category, image, created_at`
- **orders** — `id, user_id → users, razorpay_order_id, razorpay_payment_id, amount, status, created_at`
- **order_items** — `id, order_id → orders, product_id, name, price, quantity`

---

## 🔒 Security Notes

- Passwords are hashed asynchronously with **bcrypt** — plaintext passwords are never stored.
- Sessions use signed **JWTs**; use HTTPS in production and protect browser storage against XSS.
- Cart values and quantities are validated and totals are recomputed from database prices.
- Razorpay signatures, provider-side captured status, currency, and amount are verified before an order is marked paid.
- **Helmet** security headers/CSP, exact CORS origin allowlisting, JSON body limits, and API/auth/payment rate limits are enabled.
- Static file serving uses an **explicit whitelist**, so `.env`, database credentials, and server files are not exposed over HTTP.
- The default rate-limit store is in-memory and per process. Configure a shared store before running multiple app instances.
- Use a managed PostgreSQL backup/restore plan and rotate all secrets independently for production.

---

## 📁 Project Structure

```
FastFood/
├── server/
│   ├── index.js      Express app: API routes + static frontend
│   ├── db.pg.js      PostgreSQL pool and schema
│   ├── seed-pg.js    Initial schema, menu, and admin setup
│   ├── auth.js       JWT sign/verify + auth & admin guards
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

## 🚀 Production checklist

- Put the app behind HTTPS and configure the trusted proxy setting for your host.
- Use a managed PostgreSQL database with verified TLS, backups, and migrations.
- Configure a shared rate-limit store for multiple instances and monitor health/error logs.
- Configure Razorpay webhooks and reconciliation before accepting live payments.
- Add legal pages, delivery coverage, support details, and real customer-approved review content before public launch.

---

Built as a portfolio project to demonstrate full-stack fundamentals: REST API design, authentication, database modeling, third-party payment integration, and secure server practices.
