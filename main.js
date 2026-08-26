/* =========================================================================
 * FastFood — frontend
 * Talks to the backend API (same origin): products, auth (JWT), payment, orders.
 * ========================================================================= */

// ---- Reviews slider ----
var swiper = new Swiper(".mySwiper", {
  navigation: { nextEl: "#Next", prevEl: "#Prev" },
});

// =========================================================================
// API helpers
// =========================================================================
const API = ""; // same origin (server serves this page)

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

/** Fetch wrapper: JSON in/out, adds Bearer token when auth=true, throws on !ok. */
async function apiFetch(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = "Bearer " + t;
  }
  const res = await fetch(API + path, {
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

// =========================================================================
// Cart / Orders panel open + close
// =========================================================================
cartIcon.addEventListener("click", (e) => {
  e.preventDefault();
  cartTab.classList.add("cart-tab-active");
});
closeBtn.addEventListener("click", (e) => {
  e.preventDefault();
  cartTab.classList.remove("cart-tab-active");
});

if (ordersBtn && ordersTab) {
  ordersBtn.addEventListener("click", (e) => {
    e.preventDefault();
    ordersTab.classList.add("cart-tab-active");
    loadOrders();
  });
  ordersCloseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    ordersTab.classList.remove("cart-tab-active");
  });
}

// ---- Mobile menu toggle ----
function closeMobileMenu() {
  if (!mobileMenu) return;
  mobileMenu.classList.remove("mobile-menu-active");
  if (menuIcon) {
    menuIcon.classList.remove("fa-xmark");
    menuIcon.classList.add("fa-bars");
  }
}

if (hamburger && mobileMenu && menuIcon) {
  hamburger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    mobileMenu.classList.toggle("mobile-menu-active");
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
let cartproducts = JSON.parse(localStorage.getItem("ff_cart")) || [];

const saveCart = () => localStorage.setItem("ff_cart", JSON.stringify(cartproducts));

// currency formatter for ₹ Indian Rupee
const rupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

// ---- Render product cards from the API ----
const showCards = () => {
  cardList.innerHTML = "";
  productList.forEach((product) => {
    const orderCard = document.createElement("div");
    orderCard.classList.add("order-card");
    orderCard.innerHTML = `
        <div class="card-item">
         <img src="${product.image}" alt="${product.name}">
        </div>
        <h4>${product.name}</h4>
        <h4 class="price">${rupee.format(product.price)}</h4>
        <button type="button" class="btn card-btn">Add to Cart</button>`;
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
    existingProduct.quantity++;
  } else {
    cartproducts.push({ ...product, quantity: 1 });
  }
  saveCart();
  renderCart();
  updateCartCount();
};

// ---- Render cart ----
function renderCart() {
  cartList.innerHTML = "";
  cartproducts.forEach((item) => {
    const cardItem = document.createElement("div");
    cardItem.classList.add("cart-item");
    cardItem.innerHTML = `
      <div class="item-image ">
         <img src="${item.image}" alt="${item.name}">
      </div>
      <div class="item-details">
        <div class="item-info">
          <h4>${item.name}</h4>
          <p class="item-total"> ${rupee.format(item.price * item.quantity)}</p>
        </div>
        <div class="quantity-control">
          <button class="decrease-btn minus">-</button>
          <span class="quantity-value">${item.quantity}</span>
          <button class="increase-btn plus">+</button>
        </div>
      </div> `;

    const increaseBtn = cardItem.querySelector(".plus");
    const quantityValue = cardItem.querySelector(".quantity-value");
    const decreaseBtn = cardItem.querySelector(".minus");
    const priceEl = cardItem.querySelector(".item-total");

    increaseBtn.addEventListener("click", () => {
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
  let total = 0;
  cartproducts.forEach((item) => (total += item.price * item.quantity));
  cartTotal.textContent = rupee.format(total);
}

function updateCartCount() {
  let totalItems = 0;
  cartproducts.forEach((item) => (totalItems += item.quantity));
  cartCount.textContent = totalItems;
}

// ---- Boot: load products from the API ----
const initApp = async () => {
  try {
    productList = await apiFetch("/api/products");
    showCards();
  } catch (error) {
    console.error("Error fetching products:", error);
    cardList.innerHTML = `<p style="grid-column:1/-1">Could not load the menu. Is the server running?</p>`;
  }
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

function openModal(defaultTab = "login") {
  authModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (defaultTab === "signup") showSignup();
  else showLogin();
}
function closeModal() {
  authModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// Mobile "My Orders"
if (mobileOrdersBtn) {
  mobileOrdersBtn.addEventListener("click", (e) => {
    e.preventDefault();
    mobileMenu.classList.remove("mobile-menu-active");
    ordersTab.classList.add("cart-tab-active");
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
    setAuth(token, user);
    updateUIForLogin();
    closeModal();
    formSignup.reset();
    alert(`Welcome, ${user.name}! Your account is ready.`);
  } catch (err) {
    alert(err.message);
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
    setAuth(token, user);
    updateUIForLogin();
    closeModal();
    formLogin.reset();
    alert(`Signed in as ${user.name}.`);
  } catch (err) {
    alert(err.message);
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
    signinBtn.innerHTML = `<i class="fa-solid fa-user"></i> ${user.name}`;
    signinBtn.setAttribute("title", "Click to log out");
    if (ordersBtn) ordersBtn.classList.remove("hidden");
    if (mobileOrdersItem) mobileOrdersItem.classList.remove("hidden");
    const isAdmin = user.role === "admin";
    if (adminLink) adminLink.classList.toggle("hidden", !isAdmin);
    if (mobileAdminItem) mobileAdminItem.classList.toggle("hidden", !isAdmin);
  } else {
    signinBtn.innerHTML = `<i class="fa-solid fa-user"></i> Sign in`;
    signinBtn.setAttribute("title", "Sign in");
    signinBtn.setAttribute("data-open", "login");
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
    setAuth(getToken(), user); // refresh cached user (e.g. role changes)
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

  if (!clientId) {
    document.querySelectorAll(".google-fallback").forEach((btn) =>
      btn.addEventListener("click", () =>
        alert(
          "Google sign-in isn't set up yet.\nAdd GOOGLE_CLIENT_ID to the .env file and restart the server."
        )
      )
    );
    return;
  }

  // The GIS script loads async; wait until it's ready, then wire it up.
  (function whenReady() {
    if (!(window.google && google.accounts && google.accounts.id)) {
      return setTimeout(whenReady, 100);
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
    setAuth(token, user);
    updateUIForLogin();
    closeModal();
    alert(`Signed in as ${user.name}.`);
  } catch (err) {
    alert("Google sign-in failed: " + err.message);
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
    ordersList.innerHTML = `<p class="orders-empty">${err.message}</p>`;
  }
}

function renderOrder(o) {
  const items = o.items
    .map((it) => `<li>${it.name} × ${it.quantity} <span>${rupee.format(it.price * it.quantity)}</span></li>`)
    .join("");
  return `
    <div class="order-history-item">
      <div class="order-history-head">
        <span class="order-id">Order #${o.id}</span>
        <span class="order-status">${o.status}</span>
      </div>
      <ul class="order-history-items">${items}</ul>
      <div class="order-history-foot">
        <span>${o.created_at}</span>
        <strong>${rupee.format(o.amount)}</strong>
      </div>
    </div>`;
}

// =========================================================================
// Payment (Razorpay — order created + verified on the backend)
// =========================================================================
document.getElementById("payBtn").addEventListener("click", async function (e) {
  e.preventDefault();

  if (cartproducts.length === 0) {
    alert("Your cart is empty!");
    return;
  }
  if (!getToken()) {
    alert("Please sign in to place your order.");
    openModal("login");
    return;
  }

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
          alert(`Payment successful! Order #${result.order_id} placed.`);
          cartproducts = [];
          saveCart();
          renderCart();
          updateCartCount();
          cartTab.classList.remove("cart-tab-active");

          // Show the freshly placed order straight away.
          if (ordersTab) {
            ordersTab.classList.add("cart-tab-active");
            loadOrders();
          }
        } catch (err) {
          alert("Payment verification failed: " + err.message);
        }
      },
      prefill: {
        name: getUser()?.name || "",
        email: getUser()?.email || "",
      },
      theme: { color: "#f59e0b" },
    };

    const rzp1 = new Razorpay(options);
    rzp1.on("payment.failed", (resp) =>
      alert("Payment failed: " + (resp.error?.description || "Please try again."))
    );
    rzp1.open();
  } catch (err) {
    if (/not configured/i.test(err.message)) {
      alert(
        "Payments are not set up yet.\nAdd your Razorpay TEST keys to the .env file and restart the server."
      );
    } else {
      alert("Could not start payment: " + err.message);
    }
  }
});
