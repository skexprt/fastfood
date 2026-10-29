/* =========================================================================
 * FastFood — Admin panel
 * Admin-only product management (add / edit / delete) via the REST API.
 * ========================================================================= */

// ---- Auth + API helpers (shared shape with main.js) ----
const getToken = () => localStorage.getItem("ff_token");
const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem("ff_user"));
  } catch {
    return null;
  }
};
const setAuth = (token, user) => {
  localStorage.setItem("ff_token", token);
  localStorage.setItem("ff_user", JSON.stringify(user));
};
const clearAuth = () => {
  localStorage.removeItem("ff_token");
  localStorage.removeItem("ff_user");
};

async function apiFetch(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = "Bearer " + t;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; // let callers distinguish auth (401/403) from transient errors
    throw err;
  }
  return data;
}

const rupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

// ---- Elements ----
const loginSection = document.getElementById("adminLogin");
const dashboard = document.getElementById("adminDashboard");
const logoutBtn = document.getElementById("logoutBtn");
const welcome = document.getElementById("welcome");

const adminLoginForm = document.getElementById("adminLoginForm");
const loginError = document.getElementById("loginError");

const productForm = document.getElementById("productForm");
const formTitle = document.getElementById("formTitle");
const saveBtn = document.getElementById("saveBtn");
const cancelEdit = document.getElementById("cancelEdit");
const formError = document.getElementById("formError");
const productRows = document.getElementById("productRows");
const countEl = document.getElementById("count");

const pName = document.getElementById("pName");
const pPrice = document.getElementById("pPrice");
const pCategory = document.getElementById("pCategory");
const pImage = document.getElementById("pImage");

let editingId = null;

// ---- View switching ----
function showLogin(message = "") {
  loginSection.classList.remove("hidden");
  dashboard.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  loginError.textContent = message;
}

function showDashboard() {
  loginSection.classList.add("hidden");
  dashboard.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  const user = getUser();
  welcome.textContent = user ? `Signed in as ${user.name} (admin)` : "";
  loadProducts();
}

// ---- Gate: only admins reach the dashboard ----
async function ensureAdmin() {
  if (!getToken()) return showLogin();
  try {
    const { user } = await apiFetch("/api/auth/me", { auth: true });
    setAuth(getToken(), user);
    if (user.role === "admin") showDashboard();
    else showLogin("This account does not have admin access.");
  } catch (err) {
    // Definitive client error (4xx) → clear and show login. Transient/server
    // error (5xx or network) → keep the token and ask the admin to retry.
    if (err.status >= 400 && err.status < 500) {
      clearAuth();
      showLogin();
    } else {
      showLogin("Could not reach the server. Please refresh and try again.");
    }
  }
}

// ---- Admin login ----
adminLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  try {
    const { token, user } = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    if (user.role !== "admin") {
      loginError.textContent = "This account does not have admin access.";
      return;
    }
    setAuth(token, user);
    adminLoginForm.reset();
    showDashboard();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

logoutBtn.addEventListener("click", (e) => {
  e.preventDefault();
  clearAuth();
  showLogin();
});

// ---- Load + render products ----
async function loadProducts() {
  productRows.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;
  try {
    const products = await apiFetch("/api/products");
    countEl.textContent = products.length;
    if (!products.length) {
      productRows.innerHTML = `<tr><td colspan="5">No products yet.</td></tr>`;
      return;
    }
    productRows.innerHTML = "";
    products.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><img class="thumb" src="${escapeHtml(safeImageUrl(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy"></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${rupee.format(p.price)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn danger" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>`;
      tr.querySelector(".icon-btn:not(.danger)").addEventListener("click", () => startEdit(p));
      tr.querySelector(".icon-btn.danger").addEventListener("click", () => removeProduct(p));
      productRows.appendChild(tr);
    });
  } catch (err) {
    productRows.innerHTML = `<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---- Add / update ----
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";
  const body = {
    name: pName.value.trim(),
    price: Number(pPrice.value),
    category: pCategory.value.trim() || "Fast Food",
    image: pImage.value.trim(),
  };
  try {
    if (editingId) {
      await apiFetch(`/api/products/${editingId}`, { method: "PUT", auth: true, body });
    } else {
      await apiFetch("/api/products", { method: "POST", auth: true, body });
    }
    resetForm();
    loadProducts();
  } catch (err) {
    formError.textContent = err.message;
  }
});

function startEdit(product) {
  editingId = product.id;
  pName.value = product.name;
  pPrice.value = product.price;
  pCategory.value = product.category;
  pImage.value = product.image;
  formTitle.textContent = `Edit Product #${product.id}`;
  saveBtn.textContent = "Update Product";
  cancelEdit.classList.remove("hidden");
  formError.textContent = "";
  pName.focus();
  productForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

cancelEdit.addEventListener("click", resetForm);

function resetForm() {
  editingId = null;
  productForm.reset();
  pCategory.value = "Fast Food";
  formTitle.textContent = "Add New Product";
  saveBtn.textContent = "Add Product";
  cancelEdit.classList.add("hidden");
  formError.textContent = "";
}

async function removeProduct(product) {
  if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
  try {
    await apiFetch(`/api/products/${product.id}`, { method: "DELETE", auth: true });
    if (editingId === product.id) resetForm();
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

// Minimal HTML-escape for values rendered into the table.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeImageUrl(value) {
  if (typeof value !== "string") return "images/burger.png";
  if (/^\/?images\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..")) {
    return value.replace(/^\/+/, "");
  }
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    return "images/burger.png";
  }
  return "images/burger.png";
}

// ---- Boot ----
ensureAdmin();
