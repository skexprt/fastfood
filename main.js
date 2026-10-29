/* =========================================================================
 * FastFood — frontend
 * Talks to the backend API (same origin): products, auth (JWT), payment, orders.
 * ========================================================================= */

// ---- Reviews slider ----
if (window.Swiper) {
  new Swiper(".mySwiper", {
    navigation: { nextEl: "#Next", prevEl: "#Prev" },
  });
}

// =========================================================================
// API helpers
// =========================================================================
const API = ""; // same origin (server serves this page)

const getToken = () => {
  try {
    return localStorage.getItem("ff_token");
  } catch {
    return null;
  }
};
const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem("ff_user"));
  } catch {
    return null;
  }
};
const setAuth = (token, user) => {
  try {
    localStorage.setItem("ff_token", token);
    localStorage.setItem("ff_user", JSON.stringify(user));
    return true;
  } catch (error) {
    console.error("Could not save the sign-in session:", error);
    showToast("Browser storage is unavailable. Please enable storage and try again.", "error");
    return false;
  }
};
const clearAuth = () => {
  try {
    localStorage.removeItem("ff_token");
    localStorage.removeItem("ff_user");
  } catch (error) {
    console.error("Could not clear the saved session:", error);
  }
};

/** Fetch wrapper: JSON in/out, adds Bearer token when auth=true, throws on !ok. */
async function apiFetch(path, { method = "GET", body, auth = false } = {}) {
  if (window.location.protocol === "file:") {
    throw new Error(
      "Sign-in needs the FastFood server. Run `npm start`, then open http://localhost:3000 instead of opening index.html directly.",
    );
  }

  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = "Bearer " + t;
  }
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      "Cannot reach the FastFood server. Run `npm start` in the project folder and open http://localhost:3000.",
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (auth && res.status === 401) {
      clearAuth();
      updateUIForLogin();
    }
    const message =
      res.status >= 500
        ? "The server could not complete your request. Check the server logs and database at /api/health."
        : data.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status; // let callers distinguish auth (401/403) from transient errors
    throw err;
  }
  return data;
}

// =========================================================================
// DOM references
// =========================================================================
const cartIcon = document.querySelector(".badge-container");
const cartTab = document.querySelector(".cart-tab");
const closeBtn = document.querySelector(".close-btn");
const cardList = document.querySelector(".card-list");
const cartList = document.querySelector(".cart-list");
const cartTotal = document.querySelector(".total-value");
const cartCount = document.querySelector(".badge-value");
const hamburger = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector(".mobile-menu");
const menuIcon = document.querySelector(".menu-toggle i");

const ordersBtn = document.querySelector("#ordersBtn");
const ordersTab = document.querySelector(".orders-tab");
const ordersList = document.querySelector(".orders-list");
const ordersCloseBtn = document.querySelector(".orders-close-btn");
const toast = document.getElementById("appToast");
const drawerFocusReturn = new WeakMap();

function showToast(message, type = "info") {
  if (!toast) {
    window.alert(message);
    return;
  }
  toast.textContent = message;
  toast.dataset.type = type;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.classList.add("toast-visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("toast-visible"), 4000);
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =========================================================================
// Cart / Orders panel open + close
// =========================================================================
function setDrawerOpen(drawer, open) {
  if (!drawer) return;
  const otherDrawer = drawer === cartTab ? ordersTab : cartTab;
  if (open && otherDrawer?.classList.contains("cart-tab-active")) {
    setDrawerOpen(otherDrawer, false);
  }
  if (open) drawerFocusReturn.set(drawer, document.activeElement);
  drawer.classList.toggle("cart-tab-active", open);
  drawer.setAttribute("aria-hidden", String(!open));
  drawer.inert = !open;
  if (open) drawer.querySelector("button, a")?.focus();
  else drawerFocusReturn.get(drawer)?.focus?.();
}

cartIcon.addEventListener("click", (e) => {
  e.preventDefault();
  setDrawerOpen(cartTab, true);
});
closeBtn.addEventListener("click", (e) => {
  e.preventDefault();
  setDrawerOpen(cartTab, false);
});

if (ordersBtn && ordersTab) {
  ordersBtn.addEventListener("click", (e) => {
    e.preventDefault();
    setDrawerOpen(ordersTab, true);
    loadOrders();
  });
  ordersCloseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    setDrawerOpen(ordersTab, false);
  });
}

// ---- Mobile menu toggle ----
function closeMobileMenu() {
  if (!mobileMenu) return;
  mobileMenu.classList.remove("mobile-menu-active");
  hamburger?.setAttribute("aria-expanded", "false");
  if (menuIcon) {
    menuIcon.classList.remove("fa-xmark");
    menuIcon.classList.add("fa-bars");
  }
  hamburger?.setAttribute("aria-label", "Open navigation menu");
}

if (hamburger && mobileMenu && menuIcon) {
  hamburger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    mobileMenu.classList.toggle("mobile-menu-active");
    hamburger.setAttribute(
      "aria-expanded",
      String(mobileMenu.classList.contains("mobile-menu-active")),
    );
    hamburger.setAttribute(
      "aria-label",
      mobileMenu.classList.contains("mobile-menu-active")
        ? "Close navigation menu"
        : "Open navigation menu",
    );
    if (menuIcon.classList.contains("fa-bars")) {
      menuIcon.classList.remove("fa-bars");
      menuIcon.classList.add("fa-xmark");
    } else {
      menuIcon.classList.remove("fa-xmark");
      menuIcon.classList.add("fa-bars");
    }
  });

  // Close the menu when a link inside it is tapped...
  mobileMenu.querySelectorAll("a").forEach((link) =>
    link.addEventListener("click", closeMobileMenu)
  );

  // ...or when tapping/clicking anywhere outside the open menu.
  document.addEventListener("click", (e) => {
    if (!mobileMenu.classList.contains("mobile-menu-active")) return;
    if (mobileMenu.contains(e.target) || hamburger.contains(e.target)) return;
    closeMobileMenu();
  });
}

// =========================================================================
// Cart state
// =========================================================================
let productList = [];
function loadStoredCart() {
  try {
    const stored = JSON.parse(localStorage.getItem("ff_cart") || "[]");
    if (!Array.isArray(stored)) return [];
    const itemsById = new Map();
    stored.forEach((item) => {
      if (
        !item ||
        !Number.isInteger(Number(item.id)) ||
        Number(item.id) <= 0 ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) <= 0
      ) {
        return;
      }
      const id = Number(item.id);
      const quantity = Math.min(
        20,
        (itemsById.get(id) || 0) + Number(item.quantity),
      );
      itemsById.set(id, quantity);
    });
    return [...itemsById.entries()]
      .slice(0, 50)
      .map(([id, quantity]) => ({ id, quantity }));
  } catch {
    return [];
  }
}
let cartproducts = loadStoredCart();

const saveCart = () => {
  try {
    localStorage.setItem(
      "ff_cart",
      JSON.stringify(
        cartproducts.map(({ id, quantity }) => ({ id, quantity })),
      ),
    );
  } catch (error) {
    console.error("Could not save the cart:", error);
    showToast("Your cart could not be saved on this device.", "error");
  }
};

// currency formatter for ₹ Indian Rupee
const rupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

// ---- Render product cards from the API ----
const showCards = () => {
  cardList.innerHTML = "";
  const search = document.getElementById("menuSearch")?.value.trim().toLowerCase();
  const category = document.getElementById("categoryFilter")?.value || "";
  const visibleProducts = productList.filter((product) => {
    const matchesSearch =
      !search ||
      `${product.name} ${product.category}`.toLowerCase().includes(search);
    return matchesSearch && (!category || product.category === category);
  });
  if (!visibleProducts.length) {
    cardList.innerHTML =
      '<p class="menu-empty" role="status">No dishes match your search. Try another item or category.</p>';
    return;
  }
  visibleProducts.forEach((product) => {
    const orderCard = document.createElement("div");
    orderCard.classList.add("order-card");
    orderCard.innerHTML = `
        <div class="card-item">
         <img src="${safeImageUrl(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async">
        </div>
        <h4>${escapeHtml(product.name)}</h4>
        <p class="product-category">${escapeHtml(product.category)}</p>
        <h4 class="price">${rupee.format(product.price)}</h4>
        <button type="button" class="btn card-btn" aria-label="Add ${escapeHtml(product.name)} to cart">Add to Cart</button>`;
    cardList.appendChild(orderCard);

    const cardBtn = orderCard.querySelector(".card-btn");
    cardBtn.addEventListener("click", (e) => {
      e.preventDefault();
      addToCart(product);
    });
  });
};

// ---- Add to cart ----
const addToCart = (product) => {
  const existingProduct = cartproducts.find((item) => item.id === product.id);
  if (existingProduct) {
    if (existingProduct.quantity >= 20) {
      showToast("You can order up to 20 of each dish.", "error");
      return;
    }
    existingProduct.quantity++;
  } else {
    if (cartproducts.length >= 50) {
      showToast("Your cart has reached its item limit.", "error");
      return;
    }
    cartproducts.push({ ...product, quantity: 1 });
  }
  saveCart();
  renderCart();
  updateCartCount();
  showToast(`${product.name} added to your cart.`, "success");
};

// ---- Render cart ----
function renderCart() {
  cartList.innerHTML = "";
  if (!cartproducts.length) {
    cartList.innerHTML =
      '<p class="cart-empty" role="status">Your cart is empty. Add a few favorites to get started.</p>';
  }
  const readyItems = cartproducts.filter((item) => Number.isFinite(item.price));
  if (cartproducts.length && !readyItems.length) {
    cartList.innerHTML =
      '<p class="cart-empty" role="status">Your saved cart will be available when the menu loads.</p>';
  }
  readyItems.forEach((item) => {
    const cardItem = document.createElement("div");
    cardItem.classList.add("cart-item");
    cardItem.innerHTML = `
      <div class="item-image ">
         <img src="${safeImageUrl(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
      </div>
      <div class="item-details">
        <div class="item-info">
          <h4>${escapeHtml(item.name)}</h4>
          <p class="item-total"> ${rupee.format(item.price * item.quantity)}</p>
        </div>
        <div class="quantity-control">
          <button type="button" class="decrease-btn minus" aria-label="Remove one ${escapeHtml(item.name)}">−</button>
          <span class="quantity-value" aria-live="polite">${item.quantity}</span>
          <button type="button" class="increase-btn plus" aria-label="Add one ${escapeHtml(item.name)}">+</button>
        </div>
      </div> `;

    const increaseBtn = cardItem.querySelector(".plus");
    const quantityValue = cardItem.querySelector(".quantity-value");
    const decreaseBtn = cardItem.querySelector(".minus");
    const priceEl = cardItem.querySelector(".item-total");

    increaseBtn.addEventListener("click", () => {
      if (item.quantity >= 20) {
        showToast("You can order up to 20 of each dish.", "error");
        return;
      }
      item.quantity++;
      quantityValue.textContent = item.quantity;
      priceEl.textContent = rupee.format(item.price * item.quantity);
      saveCart();
      updateTotal();
      updateCartCount();
    });

    decreaseBtn.addEventListener("click", () => {
      if (item.quantity > 1) {
        item.quantity--;
        quantityValue.textContent = item.quantity;
        priceEl.textContent = rupee.format(item.price * item.quantity);
      } else {
        cartproducts = cartproducts.filter((c) => c.id !== item.id);
        cardItem.remove();
      }
      saveCart();
      updateTotal();
      updateCartCount();
    });

    cartList.appendChild(cardItem);
  });
  updateTotal();
}

function updateTotal() {
  const total = cartproducts.reduce(
    (sum, item) =>
      Number.isFinite(item.price)
        ? sum + item.price * item.quantity
        : sum,
    0,
  );
  cartTotal.textContent = rupee.format(total);
}

function updateCartCount() {
  let totalItems = 0;
  cartproducts.forEach((item) => (totalItems += item.quantity));
  cartCount.textContent = totalItems;
  cartIcon.setAttribute(
    "aria-label",
    `Open shopping cart, ${totalItems} ${totalItems === 1 ? "item" : "items"}`,
  );
}

// ---- Boot: load products from the API ----
const initApp = async () => {
  try {
    productList = await apiFetch("/api/products");
    const productsById = new Map(
      productList.map((product) => [Number(product.id), product]),
    );
    cartproducts = cartproducts
      .filter((item) => productsById.has(item.id))
      .map((item) => ({
        ...productsById.get(item.id),
        quantity: item.quantity,
      }));
    saveCart();

    const categories = [...new Set(productList.map((item) => item.category))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const categoryFilter = document.getElementById("categoryFilter");
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categoryFilter.appendChild(option);
    });
    showCards();
  } catch (error) {
    console.error("Error fetching products:", error);
    cardList.innerHTML =
      '<p class="menu-empty" role="alert">We could not load the menu right now. Please refresh to try again.</p>';
  }
  document
    .getElementById("menuSearch")
    .addEventListener("input", showCards);
  document
    .getElementById("categoryFilter")
    .addEventListener("change", showCards);
  renderCart();
  updateCartCount();
};
initApp();

// =========================================================================
// Auth modal (UI wiring) + API-backed login / signup
// =========================================================================
const authModal = document.getElementById("authModal");
const authClose = document.getElementById("authClose");
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const formLogin = document.getElementById("formLogin");
const formSignup = document.getElementById("formSignup");
const switchToLogin = document.getElementById("switchToLogin");
const switchToLogin2 = document.getElementById("switchToLogin2");
const signinBtn = document.getElementById("signinBtn");
const mobileSigninBtn = document.getElementById("mobilesigninBtn");

const adminLink = document.getElementById("adminLink");
const mobileOrdersItem = document.getElementById("mobileOrdersItem");
const mobileAdminItem = document.getElementById("mobileAdminItem");
const mobileOrdersBtn = document.getElementById("mobileOrdersBtn");
const supportOrdersBtn = document.getElementById("supportOrdersBtn");

document.getElementById("currentYear").textContent = new Date().getFullYear();

supportOrdersBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (!getToken()) {
    showToast("Sign in to view your orders.", "error");
    openModal("login");
    return;
  }
  setDrawerOpen(ordersTab, true);
  loadOrders();
});

function openModal(defaultTab = "login") {
  authModalReturnFocus = document.activeElement;
  authModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (defaultTab === "signup") showSignup();
  else showLogin();
  document.getElementById(defaultTab === "signup" ? "signupName" : "loginEmail").focus();
}
function closeModal() {
  authModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  authModalReturnFocus?.focus?.();
}
let authModalReturnFocus = null;
window.openModal = openModal;
window.closeModal = closeModal;

function showLogin() {
  tabLogin.classList.add("active");
  tabSignup.classList.remove("active");
  tabLogin.setAttribute("aria-selected", "true");
  tabSignup.setAttribute("aria-selected", "false");
  // Toggle the `hidden` class — it uses `!important`, so an inline display can't win.
  formLogin.classList.remove("hidden");
  formSignup.classList.add("hidden");
  formLogin.style.display = "";
  formSignup.style.display = "";
}
function showSignup() {
  tabSignup.classList.add("active");
  tabLogin.classList.remove("active");
  tabSignup.setAttribute("aria-selected", "true");
  tabLogin.setAttribute("aria-selected", "false");
  formSignup.classList.remove("hidden");
  formLogin.classList.add("hidden");
  formLogin.style.display = "";
  formSignup.style.display = "";
}

// Header "Sign in" button: when logged out → open modal; when logged in → logout.
signinBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (getToken()) {
    if (confirm("Do you want to log out?")) logoutUser();
    return;
  }
  const want = signinBtn.getAttribute("data-open");
  openModal(want === "signup" ? "signup" : "login");
});
mobileSigninBtn.addEventListener("click", (e) => {
  e.preventDefault();
  if (getToken()) {
    if (confirm("Do you want to log out?")) logoutUser();
    return;
  }
  openModal("login");
});

// Tabs + footer switches
tabLogin.addEventListener("click", (e) => { e.preventDefault(); showLogin(); });
tabSignup.addEventListener("click", (e) => { e.preventDefault(); showSignup(); });
switchToLogin.addEventListener("click", (e) => { e.preventDefault(); showSignup(); });
switchToLogin2.addEventListener("click", (e) => { e.preventDefault(); showLogin(); });

// Close controls
authClose.addEventListener("click", (e) => { e.preventDefault(); closeModal(); });
authModal.addEventListener("click", (e) => { if (e.target === authModal) closeModal(); });
document.addEventListener("keydown", (e) => {
  const modalOpen = authModal.getAttribute("aria-hidden") === "false";
  if (e.key === "Escape") {
    if (modalOpen) closeModal();
    else if (ordersTab.classList.contains("cart-tab-active")) {
      setDrawerOpen(ordersTab, false);
    } else if (cartTab.classList.contains("cart-tab-active")) {
      setDrawerOpen(cartTab, false);
    }
    return;
  }
  if (!modalOpen || e.key !== "Tab") return;
  const focusable = [
    ...authModal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// Mobile "My Orders"
if (mobileOrdersBtn) {
  mobileOrdersBtn.addEventListener("click", (e) => {
    e.preventDefault();
    closeMobileMenu();
    setDrawerOpen(ordersTab, true);
    loadOrders();
  });
}

// ---- Signup (API) ----
formSignup.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  try {
    const { token, user } = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: { name, email, password },
    });
    if (!setAuth(token, user)) return;
    updateUIForLogin();
    closeModal();
    formSignup.reset();
    showToast(`Welcome, ${user.name}! Your account is ready.`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

// ---- Login (API) ----
formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    const { token, user } = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    if (!setAuth(token, user)) return;
    updateUIForLogin();
    closeModal();
    formLogin.reset();
    showToast(`Signed in as ${user.name}.`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
});

function logoutUser() {
  clearAuth();
  updateUIForLogin();
}

// ---- Reflect auth state in the header ----
function updateUIForLogin() {
  const user = getUser();
  const loggedIn = !!getToken() && !!user;

  if (loggedIn) {
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-user";
    signinBtn.replaceChildren(icon, document.createTextNode(` ${user.name}`));
    signinBtn.setAttribute("title", "Click to log out");
    mobileSigninBtn.textContent = `Sign out (${user.name})`;
    mobileSigninBtn.setAttribute("title", "Sign out");
    if (ordersBtn) ordersBtn.classList.remove("hidden");
    if (mobileOrdersItem) mobileOrdersItem.classList.remove("hidden");
    const isAdmin = user.role === "admin";
    if (adminLink) adminLink.classList.toggle("hidden", !isAdmin);
    if (mobileAdminItem) mobileAdminItem.classList.toggle("hidden", !isAdmin);
  } else {
    signinBtn.innerHTML = `<i class="fa-solid fa-user"></i> Sign in`;
    signinBtn.setAttribute("title", "Sign in");
    signinBtn.setAttribute("data-open", "login");
    mobileSigninBtn.textContent = "Sign in";
    mobileSigninBtn.setAttribute("title", "Sign in");
    if (ordersBtn) ordersBtn.classList.add("hidden");
    if (adminLink) adminLink.classList.add("hidden");
    if (mobileOrdersItem) mobileOrdersItem.classList.add("hidden");
    if (mobileAdminItem) mobileAdminItem.classList.add("hidden");
  }
}

// On load: restore session if the stored token is still valid.
async function restoreSession() {
  if (!getToken()) {
    updateUIForLogin();
    return;
  }
  // Show the cached user right away so a slow/offline server never flashes "Sign in".
  updateUIForLogin();
  try {
    const { user } = await apiFetch("/api/auth/me", { auth: true });
    if (!setAuth(getToken(), user)) return;
    updateUIForLogin();
  } catch (err) {
    // Drop the session only on a definitive client error (4xx: invalid/expired
    // token, or the user no longer exists). A transient network failure or 5xx
    // (e.g. the server restarting) has no such status and must NOT log the user out.
    if (err.status >= 400 && err.status < 500) {
      clearAuth();
      updateUIForLogin();
    }
  }
}
restoreSession();

// =========================================================================
// Sign in with Google (Google Identity Services)
// =========================================================================
// Ask the backend whether Google sign-in is configured; if so, initialise GIS
// and render Google's official button into the two auth-modal slots. If it's
// not configured (no GOOGLE_CLIENT_ID), the styled fallback button stays and
// simply explains how to enable it — mirroring the Razorpay "not set up" path.
async function initGoogleSignIn() {
  let clientId = null;
  try {
    const cfg = await apiFetch("/api/config");
    clientId = cfg.googleClientId;
  } catch {
    /* config endpoint unreachable — leave the fallback button in place */
  }

  document.querySelectorAll(".google-fallback").forEach((btn) =>
    btn.addEventListener("click", () =>
      showToast(
        clientId
          ? "Google sign-in could not load. Please try again or use your email."
          : "Google sign-in is not configured. Please use your email to sign in.",
        "error",
      ),
    ),
  );

  if (!clientId) {
    return;
  }

  // The GIS script loads async; wait until it's ready, then wire it up.
  (function whenReady(attempt = 0) {
    if (!(window.google && google.accounts && google.accounts.id)) {
      if (attempt < 50) setTimeout(() => whenReady(attempt + 1), 100);
      return;
    }
    google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential });
    renderGoogleButton("googleLoginSlot", "signin_with");
    renderGoogleButton("googleSignupSlot", "signup_with");
  })();
}

function renderGoogleButton(slotId, text) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  slot.innerHTML = ""; // replace the fallback button with Google's official one
  google.accounts.id.renderButton(slot, {
    theme: "outline",
    size: "large",
    text, // "signin_with" | "signup_with"
    shape: "rectangular",
    logo_alignment: "center",
  });
}

// Google calls this with a signed ID token; hand it to the backend, which
// verifies it and returns our own app JWT + user (find-or-create by email).
async function handleGoogleCredential(response) {
  try {
    const { token, user } = await apiFetch("/api/auth/google", {
      method: "POST",
      body: { credential: response.credential },
    });
    if (!setAuth(token, user)) return;
    updateUIForLogin();
    closeModal();
    showToast(`Signed in as ${user.name}.`, "success");
  } catch (err) {
    showToast("Google sign-in failed: " + err.message, "error");
  }
}

initGoogleSignIn();

// =========================================================================
// Orders history
// =========================================================================
async function loadOrders() {
  ordersList.innerHTML = `<p class="orders-empty">Loading…</p>`;
  try {
    const orders = await apiFetch("/api/orders", { auth: true });
    if (!orders.length) {
      ordersList.innerHTML = `<p class="orders-empty">You have no orders yet.</p>`;
      return;
    }
    ordersList.innerHTML = orders.map(renderOrder).join("");
  } catch (err) {
    ordersList.innerHTML = `<p class="orders-empty">${escapeHtml(err.message)}</p>`;
  }
}

function renderOrder(o) {
  const items = o.items
    .map((it) => `<li>${escapeHtml(it.name)} × ${Number(it.quantity)} <span>${rupee.format(Number(it.price) * Number(it.quantity))}</span></li>`)
    .join("");
  return `
    <div class="order-history-item">
      <div class="order-history-head">
        <span class="order-id">Order #${o.id}</span>
        <span class="order-status">${escapeHtml(o.status)}</span>
      </div>
      <ul class="order-history-items">${items}</ul>
      <div class="order-history-foot">
        <span>${escapeHtml(new Date(o.created_at).toLocaleString("en-IN"))}</span>
        <strong>${rupee.format(o.amount)}</strong>
      </div>
    </div>`;
}

// =========================================================================
// Payment (Razorpay — order created + verified on the backend)
// =========================================================================
document.getElementById("payBtn").addEventListener("click", async function (e) {
  e.preventDefault();
  if (this.disabled) return;

  if (cartproducts.length === 0) {
    showToast("Your cart is empty.", "error");
    return;
  }
  if (!getToken()) {
    showToast("Please sign in to place your order.", "error");
    openModal("login");
    return;
  }

  const payButton = this;
  const originalLabel = payButton.textContent;
  const resetPayButton = () => {
    payButton.disabled = false;
    payButton.textContent = originalLabel;
  };
  payButton.disabled = true;
  payButton.textContent = "Preparing checkout…";
  const items = cartproducts.map((i) => ({ id: i.id, quantity: i.quantity }));

  try {
    // 1) Ask the backend to create a Razorpay order (amount computed server-side).
    const order = await apiFetch("/api/payment/order", {
      method: "POST",
      auth: true,
      body: { items },
    });

    // 2) Open Razorpay checkout with the server-issued order id.
    const options = {
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: "FastFood",
      description: "Food order",
      order_id: order.order_id,
      handler: async function (response) {
        // 3) Verify the signature on the backend, which saves the order.
        try {
          const result = await apiFetch("/api/payment/verify", {
            method: "POST",
            auth: true,
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });
          showToast(`Payment successful! Order #${result.order_id} placed.`, "success");
          cartproducts = [];
          saveCart();
          renderCart();
          updateCartCount();
          setDrawerOpen(cartTab, false);

          // Show the freshly placed order straight away.
          if (ordersTab) {
            setDrawerOpen(ordersTab, true);
            loadOrders();
          }
        } catch (err) {
          showToast("Payment verification failed: " + err.message, "error");
        } finally {
          resetPayButton();
        }
      },
      modal: { ondismiss: resetPayButton },
      prefill: {
        name: getUser()?.name || "",
        email: getUser()?.email || "",
      },
      theme: { color: "#f59e0b" },
    };

    if (typeof window.Razorpay !== "function") {
      throw new Error("Secure checkout could not be loaded. Please try again.");
    }
    const rzp1 = new Razorpay(options);
    rzp1.on("payment.failed", (resp) =>
      {
        resetPayButton();
        showToast(
          "Payment failed: " + (resp.error?.description || "Please try again."),
          "error",
        );
      }
    );
    rzp1.open();
  } catch (err) {
    if (/not configured/i.test(err.message)) {
      showToast(
        "Payments are not set up yet.\nAdd your Razorpay TEST keys to the .env file and restart the server."
      );
    } else {
      showToast("Could not start payment: " + err.message, "error");
    }
    resetPayButton();
  }
});
