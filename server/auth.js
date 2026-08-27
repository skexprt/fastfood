/**
 * Authentication helpers: JWT signing/verification + Express middleware.
 */
const jwt = require("jsonwebtoken");
const { query } = require("./db.pg");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = "7d";

// Fail closed: never fall back to a hardcoded, source-visible secret. If the
// secret is missing or trivially weak, every token could be forged, so refuse
// to start rather than run insecurely.
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === "dev-insecure-secret-change-me") {
  throw new Error(
    "JWT_SECRET is missing or too weak. Set a long random string (>= 32 chars) in .env before starting the server."
  );
}

/** Create a signed token for a user row. */
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/** Shape a user row for sending to the client (never leak the hash). */
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** Read "Authorization: Bearer <token>" and attach req.user, or 401. */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Require an authenticated admin. Re-checks the CURRENT role from the DB so a
 *  stale token (role changed, or user deleted, after the token was issued)
 *  can't retain admin access. Use after authMiddleware. */
async function adminOnly(req, res, next) {
  try {
    if (!req.user) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const result = await query(
      "SELECT role FROM users WHERE id = $1",
      [req.user.id]
    );

    const row = result.rows[0];

    if (!row || row.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    next();
  } catch (error) {
    console.error("[auth] admin check failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { signToken, publicUser, authMiddleware, adminOnly, JWT_SECRET };
