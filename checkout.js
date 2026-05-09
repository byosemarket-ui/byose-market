/* ===============================
   GLOBAL VARIABLES
================================= */
let cart = [];
let shippingFee = 0;
let codFee = 0;
let capturedLocation = null;
let selectedPaymentType = "pay_now";
const PRODUCTION_API_ORIGIN = "https://byosesemarket4.onrender.com";

function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function shouldUseProductionApi(hostname) {
  return /(^|\.)(github\.io|byosemarket\.com)$/i.test(String(hostname || ""));
}

function resolveApiOrigin() {
  const explicit = normalizeBase(window.BYOSE_API_BASE_URL || window.__BYOSE_API_BASE__ || "");
  if (explicit) {
    return explicit;
  }

  const protocol = String(window.location?.protocol || "").toLowerCase();
  const hostname = String(window.location?.hostname || "").trim();

  if (protocol === "file:" || isLocalHost(hostname)) {
    return `http://${hostname || "localhost"}:5000`;
  }

  if (shouldUseProductionApi(hostname)) {
    return PRODUCTION_API_ORIGIN;
  }

  return normalizeBase(window.location?.origin || "");
}

function getOrdersApiUrl() {
  const configuredBase = resolveApiOrigin();
  if (configuredBase) {
    return configuredBase.endsWith("/api") ? `${configuredBase}/orders` : `${configuredBase}/api/orders`;
  }

  if (/^https?:$/i.test(String(window.location.protocol || ""))) {
    return `${window.location.origin}/api/orders`;
  }

  return "";
}

function getAuthToken() {
  try {
    if (window.authService && typeof window.authService.getToken === "function") {
      return String(window.authService.getToken() || "").trim();
    }
  } catch (error) {
    console.error(error);
  }

  try {
    return String(localStorage.getItem("bm_auth_token") || "").trim();
  } catch (error) {
    return "";
  }
}

function readItemAttributes(item) {
  if (item && item.attributes && typeof item.attributes === "object" && !Array.isArray(item.attributes)) {
    return Object.entries(item.attributes).filter(([, value]) => value !== undefined && value !== null && value !== "");
  }

  const attributes = [];
  if (item?.size) attributes.push(["Size", item.size]);
  if (item?.color) attributes.push(["Color", item.color]);
  return attributes;
}

function formatItemAttributes(item) {
  const attributes = readItemAttributes(item);
  if (!attributes.length) {
    return `Qty: ${item.qty}`;
  }

  return `Qty: ${item.qty} | ${attributes.map(([key, value]) => `${key}: ${value}`).join(" | ")}`;
}

/* ===============================
   INIT
================================= */
document.addEventListener("DOMContentLoaded", () => {
  loadCart();
  renderProducts();
  updateSummary();
  setupPaymentSelection();
  setupAddressSystem();
  setupScreenshotPreview();
  setupCityLogic();
  setupPlaceOrderButtons();
});

/* ===============================
   LOAD CART
================================= */
function loadCart() {
  try {
    const directItem = window.ByoseStorefrontSync?.readStateByKey?.("byose_direct_checkout") || null;

    if (directItem) {
      cart = [directItem];
      window.ByoseStorefrontSync?.removeStateByKey?.("byose_direct_checkout");

      return;
    }

    cart = window.ByoseStorefrontSync?.readStateByKey?.("byose_market_cart_v1") || [];

  } catch {
    cart = [];
  }

  if (cart.length === 0) {
    document.querySelector(".checkout-container").innerHTML = `
      <div style="padding:40px;text-align:center;">
        <h2>Your cart is empty</h2>
        <a href="shop.html">Go back to shop</a>
      </div>
    `;
  }
}

/* ===============================
   RENDER PRODUCTS
================================= */
function renderProducts() {
  const container = document.getElementById("checkoutProducts");
  if (!container) return;

  container.innerHTML = cart.map(item => `
    <div class="checkout-product">
      <img src="${item.img || item.image || 'https://via.placeholder.com/80'}">
      <div class="product-info">
        <h4>${item.name}</h4>
        <div class="product-attributes">
          ${formatItemAttributes(item)}
        </div>
        <div class="product-price">
          RWF ${(item.price * item.qty).toLocaleString()}
        </div>
      </div>
    </div>
  `).join("");
}

/* ===============================
   SUMMARY
================================= */
function calculateSubtotal() {
  return cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
}

function updateSummary() {
  const subtotal = calculateSubtotal();
  const total = subtotal + shippingFee + codFee;

  document.getElementById("summarySubtotal").textContent =
    `RWF ${subtotal.toLocaleString()}`;

  document.getElementById("summaryShipping").textContent =
    `RWF ${shippingFee.toLocaleString()}`;

  document.getElementById("summaryTotal").textContent =
    `RWF ${total.toLocaleString()}`;

  document.getElementById("mobileTotal").textContent =
    `RWF ${total.toLocaleString()}`;

  const codRow = document.getElementById("codFeeRow");
  if (codFee > 0) {
    codRow.classList.remove("hidden");
  } else {
    codRow.classList.add("hidden");
  }
}

/* ===============================
   CITY LOGIC (KIGALI CHECK)
================================= */
function setupCityLogic() {
  const cityInput = document.getElementById("city");
  const paymentTypeSection = document.getElementById("paymentTypeSection");
  const payNowSection = document.getElementById("payNowSection");
  const codMessage = document.getElementById("codMessage");

  if (!cityInput) return;

  cityInput.addEventListener("input", function () {
    const cityValue = this.value.trim().toLowerCase();

    if (cityValue === "kigali") {
      paymentTypeSection.classList.remove("hidden");
    } else {
      paymentTypeSection.classList.add("hidden");
      codFee = 0;
      selectedPaymentType = "pay_now";
      codMessage.classList.add("hidden");
      payNowSection.classList.remove("hidden");
      updateSummary();
    }
  });

  document.querySelectorAll("input[name='paymentType']").forEach(option => {
    option.addEventListener("change", function () {
      selectedPaymentType = this.value;

      if (this.value === "cod") {
        codFee = 2000;
        document.getElementById("payNowSection").classList.add("hidden");
        document.getElementById("codMessage").classList.remove("hidden");
      } else {
        codFee = 0;
        document.getElementById("payNowSection").classList.remove("hidden");
        document.getElementById("codMessage").classList.add("hidden");
      }

      updateSummary();
    });
  });
}

/* ===============================
   PAYMENT SELECTION
================================= */
function setupPaymentSelection() {
  document.querySelectorAll(".payment-option").forEach(option => {
    option.addEventListener("click", () => {
      document.querySelectorAll(".payment-option")
        .forEach(el => el.classList.remove("active"));

      option.classList.add("active");
      option.querySelector("input").checked = true;
    });
  });
}

/* ===============================
   COPY FUNCTION
================================= */
function copyText(id) {
  const text = document.getElementById(id).innerText;
  navigator.clipboard.writeText(text);
  alert("Copied: " + text);
}

/* ===============================
   SCREENSHOT PREVIEW
================================= */
function setupScreenshotPreview() {
  const input = document.getElementById("paymentScreenshot");
  const preview = document.getElementById("screenshotPreview");

  if (!input) return;

  input.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      preview.src = e.target.result;
      preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });
}

/* ===============================
   ADDRESS SYSTEM
================================= */
function setupAddressSystem() {
  document.getElementById("saveAddressBtn")
    .addEventListener("click", saveAddress);

  document.getElementById("editAddressBtn")
    .addEventListener("click", editAddress);

  document.getElementById("gpsBtn")
    .addEventListener("click", captureLocation);
}

function saveAddress() {
  const requiredFields = [
    "firstName", "lastName", "phone",
    "city", "district", "sector",
    "cell", "village"
  ];

  for (let id of requiredFields) {
    if (!document.getElementById(id).value.trim()) {
      alert("Please complete all required address fields.");
      return;
    }
  }

  if (!document.getElementById("confirmLocation").checked) {
    alert("Please confirm your location.");
    return;
  }

  document.getElementById("shippingForm").classList.add("hidden");
  document.getElementById("shippingDisplay").classList.remove("hidden");
  document.getElementById("editAddressBtn").style.display = "inline-block";
}

function readCurrentCustomer() {
  try {
    if (window.authService && typeof window.authService.getCurrentUser === "function") {
      return window.authService.getCurrentUser() || null;
    }
  } catch (error) {
    console.error(error);
  }

  try {
    return JSON.parse(localStorage.getItem("bm_current_user") || localStorage.getItem("bm_user") || "null");
  } catch (error) {
    return null;
  }
}

function readShippingAddress() {
  return {
    firstName: (document.getElementById("firstName")?.value || "").trim(),
    lastName: (document.getElementById("lastName")?.value || "").trim(),
    phone: (document.getElementById("phone")?.value || "").trim(),
    city: (document.getElementById("city")?.value || "").trim(),
    district: (document.getElementById("district")?.value || "").trim(),
    sector: (document.getElementById("sector")?.value || "").trim(),
    cell: (document.getElementById("cell")?.value || "").trim(),
    village: (document.getElementById("village")?.value || "").trim()
  };
}

function editAddress() {
  document.getElementById("shippingForm").classList.remove("hidden");
  document.getElementById("shippingDisplay").classList.add("hidden");
  document.getElementById("editAddressBtn").style.display = "none";
}

/* ===============================
   GPS LOCATION
================================= */
function captureLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(position => {
    capturedLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    alert("Location captured successfully!");
  });
}

/* ===============================
   PLACE ORDER BUTTONS
================================= */
function setupPlaceOrderButtons() {
  document.getElementById("desktopPlaceOrder")
    .addEventListener("click", placeOrder);

  document.getElementById("mobilePlaceOrder")
    .addEventListener("click", placeOrder);
}

/* ===============================
   PLACE ORDER
================================= */
function placeOrder() {

  if (cart.length === 0) {
    alert("Cart is empty");
    return;
  }

  // Validate address
  if (!document.getElementById("shippingDisplay") ||
      document.getElementById("shippingDisplay").classList.contains("hidden")) {
    alert("Please save your shipping address.");
    return;
  }

  // Validate payment
  if (selectedPaymentType === "pay_now") {
    const paymentMethod = document.querySelector("input[name='payment']:checked");
    if (!paymentMethod) {
      alert("Select payment method");
      return;
    }

    const screenshot = document.getElementById("paymentScreenshot").files[0];
    if (!screenshot) {
      alert("Upload payment screenshot");
      return;
    }
  }

  // SHOW LOADING
  document.getElementById("loadingOverlay").classList.remove("hidden");

  setTimeout(async () => {

    const subtotal = calculateSubtotal();
    const total = subtotal + shippingFee + codFee;
      const currentCustomer = readCurrentCustomer();
      const shippingAddress = readShippingAddress();
      const customerName = [shippingAddress.firstName, shippingAddress.lastName].filter(Boolean).join(" ") || currentCustomer?.name || "Guest Customer";

    const orderData = {
      id: "ORD-" + Date.now(),
      date: new Date().toISOString(),
      products: cart,
        customerId: currentCustomer?.id || "",
        customerName,
        customerEmail: currentCustomer?.email || "",
        customerPhone: shippingAddress.phone || currentCustomer?.phone || "",
        customerImage: currentCustomer?.avatar || "",
        customer: {
          id: currentCustomer?.id || "",
          name: customerName,
          email: currentCustomer?.email || "",
          phone: shippingAddress.phone || currentCustomer?.phone || "",
          avatar: currentCustomer?.avatar || ""
        },
        shippingAddress,
      subtotal,
      shippingFee,
      codFee,
      total,
      paymentType: selectedPaymentType,
      status: selectedPaymentType === "cod"
        ? "Pending Delivery (COD)"
        : "Pending Payment Verification"
    };

    try {
      await saveOrder(orderData);
      window.ByoseStorefrontSync?.writeStateByKey?.("byose_market_cart_v1", []);

      // HIDE LOADING
      document.getElementById("loadingOverlay").classList.add("hidden");

      // SHOW SUCCESS MODAL
      document.getElementById("successModal").classList.remove("hidden");
    } catch (error) {
      document.getElementById("loadingOverlay").classList.add("hidden");
      alert(error.message || "Unable to save your order to the central system. Please try again.");
    }

  }, 1500);
}
/* ===============================
   DOMContentLoaded
================================= */
document.getElementById("continueBtn")
  .addEventListener("click", () => {
    window.location.href = "shop.html";
  });
/* ===============================
   SAVE ORDER
================================= */
async function saveOrder(order) {
  const endpoint = getOrdersApiUrl();
  if (!endpoint) {
    throw new Error("Order API is not available from this page.");
  }

  const token = getAuthToken();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(order)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error((payload && payload.message) || `Order API request failed with status ${response.status}`);
  }

  const savedOrder = payload.order || order;
	window.dispatchEvent(new CustomEvent("byose:orders-changed", { detail: { order: savedOrder, source: "api" } }));
	return savedOrder;
}
