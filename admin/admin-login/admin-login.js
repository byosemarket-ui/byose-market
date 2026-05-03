const BASE_URL =
window.location.hostname === "localhost"
? "http://localhost:5000"
: "https://byosemarket-api.onrender.com";

const API_URL = `${BASE_URL}/api/admin/login`;

// 🎯 Get DOM elements
const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitButton = form.querySelector('button[type="submit"]');
const btnText = submitButton.querySelector('.btn-text');
const btnLoader = submitButton.querySelector('.btn-loader');

// 🧠 Check if already logged in (redirect to dashboard if true)
function checkAuthState() {
  const authToken = localStorage.getItem("adminAuth");
  const authTime = localStorage.getItem("adminLoginTime");
  
  if (authToken && authTime) {
    window.location.href = "../dashboard.html";
  }
}

// Run check on page load
checkAuthState();

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
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    const data = await parseJsonSafe(res);

    // ✔ SUCCESS (200)
    if (res.status === 200 && data.success) {
      // Store auth state
      localStorage.setItem("adminAuth", "true");
      localStorage.setItem("adminLoginTime", new Date().toISOString());
      localStorage.setItem("adminEmail", email);

      showMessage("✔ Login successful! Redirecting...", "success");

      // Redirect to dashboard after 1 second
      setTimeout(() => {
        window.location.href = "../dashboard.html";
      }, 1000);

    } 
    // ❌ WRONG CREDENTIALS (401)
    else if (res.status === 401) {
      showMessage("Invalid email or password. Please try again.", "error");
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
      console.error("Server error:", data);
      setFormLoading(false);
    }
    else if (res.status === 404) {
      showMessage("Login service is not available right now. Please try again shortly.", "error");
      console.error("Admin login endpoint not found.", data);
      setFormLoading(false);
    }
    else if (res.status === 403) {
      showMessage(data.message || "This origin is not allowed by the server.", "error");
      setFormLoading(false);
    }
    // ❌ OTHER ERROR
    else {
      showMessage(data.message || "An unexpected error occurred", "error");
      setFormLoading(false);
    }

  } catch (error) {
    const unreachableMessage = getNetworkErrorMessage(error);

    showMessage(unreachableMessage, "error");
    console.error("Admin login request failed:", error);
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

  if (window.location.hostname === "localhost") {
    return "Cannot reach server. Please make sure backend is running on port 5000.";
  }

  if (detail.includes("failed to fetch") || detail.includes("networkerror") || detail.includes("load failed")) {
    return "Cannot reach server. Please try again in a moment.";
  }

  return "Login could not be completed right now. Please try again in a moment.";
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
