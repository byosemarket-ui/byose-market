import API_BASE_URL from "./js/config.js";

const API_URL = `${API_BASE_URL}/api/admin/login`;
const LOGIN_REQUEST_TIMEOUT_MS = 12000;

// 🎯 Get DOM elements
const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitButton = form.querySelector('button[type="submit"]');
const btnText = submitButton.querySelector('.btn-text');
const btnLoader = submitButton.querySelector('.btn-loader');

function persistAdminSession(payload) {
  if (!window.AdminSecurity || typeof window.AdminSecurity.persistSession !== "function") {
    return false;
  }

  return window.AdminSecurity.persistSession(payload, {
    apiBaseUrl: `${API_BASE_URL}/api`,
    loginEmail: String(payload?.admin?.email || emailInput.value.trim() || "")
  });
}

async function validateSessionAfterLogin() {
  if (!window.AdminSecurity || typeof window.AdminSecurity.validateSession !== "function") {
    return true;
  }

  return window.AdminSecurity.validateSession(true, {
    source: "login-submit",
    preferredApiBaseUrl: `${API_BASE_URL}/api`
  });
}

function redirectToDashboard() {
  if (window.AdminSecurity && typeof window.AdminSecurity.redirectToDashboard === "function") {
    window.AdminSecurity.redirectToDashboard();
    return;
  }

  window.location.href = "../dashboard.html";
}

// 🎯 Form submit handler
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Fata inputs
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  // 🛑 Validation
  if (!email || !password) {
    showMessage("Please fill in all fields", "error");
    return;
  }

  // Email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showMessage("Please enter a valid email address", "error");
    return;
  }

  // 🔒 Disable form during request
  setFormLoading(true);

  try {
    const requestController = new AbortController();
    const timeoutId = window.setTimeout(() => requestController.abort(), LOGIN_REQUEST_TIMEOUT_MS);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password }),
      signal: requestController.signal
    }).finally(() => {
      window.clearTimeout(timeoutId);
    });
    const data = await parseJsonSafe(res);

    // ✔ SUCCESS (200)
    if (res.status === 200 && data.success) {
      const persisted = persistAdminSession(data);
      if (!persisted) {
        showMessage("Login succeeded but the admin session could not be stored.", "error");
        setFormLoading(false);
        return;
      }

      const sessionIsValid = await validateSessionAfterLogin();
      if (!sessionIsValid) {
        showMessage("Login succeeded but session validation failed. Please try again.", "error");
        setFormLoading(false);
        return;
      }

      showMessage("Login successful. Redirecting...", "success");

      // Redirect after validation confirms the persisted session is usable.
      setTimeout(() => {
        redirectToDashboard();
      }, 300);

    } 
    // ❌ WRONG CREDENTIALS (401)
    else if (res.status === 401) {
      showMessage("Invalid email or password", "error");
      setFormLoading(false);
    } 
    // ❌ BAD INPUT (400)
    else if (res.status === 400) {
      showMessage(data.message || "Please check your input", "error");
      setFormLoading(false);
    } 
    // ❌ SERVER ERROR (500)
    else if (res.status === 500) {
      showMessage(data.message || "Server error. Please try again later.", "error");
      setFormLoading(false);
    }
    else if (res.status === 404) {
      showMessage("Login endpoint not found. Contact support.", "error");
      setFormLoading(false);
    }
    else if (res.status === 403) {
      showMessage(data.message || "Access denied.", "error");
      setFormLoading(false);
    }
    // ❌ OTHER ERROR
    else {
      showMessage(data.message || "An unexpected error occurred. Please try again.", "error");
      setFormLoading(false);
    }

  } catch (error) {
    const unreachableMessage = getNetworkErrorMessage(error);

    showMessage(unreachableMessage, "error");
    setFormLoading(false);
  }
});

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

function getNetworkErrorMessage(error) {
  const detail = String(error && error.message ? error.message : "").toLowerCase();

  if (String(error?.name || "") === "AbortError") {
    return "Login request timed out. Please try again.";
  }

  if (detail.includes("failed to fetch") || detail.includes("networkerror") || detail.includes("load failed")) {
    return "Unable to connect to server. Check your internet connection and try again.";
  }

  return "Connection error. Please try again.";
}

// 🔒 Form loading state manager
function setFormLoading(isLoading) {
  submitButton.disabled = isLoading;
  emailInput.disabled = isLoading;
  passwordInput.disabled = isLoading;

  if (isLoading) {
    btnText.style.display = "none";
    btnLoader.style.display = "flex";
    submitButton.setAttribute("aria-busy", "true");
  } else {
    btnText.style.display = "inline";
    btnLoader.style.display = "none";
    submitButton.setAttribute("aria-busy", "false");
  }
}

// 🧠 Message handler
function showMessage(text, type = "error") {
  message.innerText = text;
  message.className = `form__message ${type}`;
}

// 🧠 Clear message on input
emailInput.addEventListener("input", () => {
  if (message.innerText) {
    message.innerText = "";
  }
});

passwordInput.addEventListener("input", () => {
  if (message.innerText) {
    message.innerText = "";
  }
});
