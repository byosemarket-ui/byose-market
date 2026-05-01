// ===============================
// 🔥 WALLET SERVICE
// ===============================

// ===============================
// 📦 BASE API URL
// ===============================
const PRODUCTION_API_ORIGIN = "https://byosemarket-admin-api.onrender.com";

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

const WALLET_API = window.__BYOSE_WALLET_API__ || `${resolveApiOrigin()}/api/wallet`;

// ===============================
// 💰 GET BALANCE
// ===============================
async function getBalance(userId) {
  if (!WALLET_API) {
    return 0;
  }

  try {
    const res = await fetch(`${WALLET_API}/balance/${userId}`);
    const data = await res.json();

    return data.balance || 0;

  } catch (error) {
    console.error("Balance Error:", error);
    return 0;
  }
}

// ===============================
// 📜 GET TRANSACTIONS
// ===============================
async function getTransactions(userId) {
  if (!WALLET_API) {
    return [];
  }

  try {
    const res = await fetch(`${WALLET_API}/transactions/${userId}`);
    const data = await res.json();

    return data.transactions || [];

  } catch (error) {
    console.error("Transaction Error:", error);
    return [];
  }
}

// ===============================
// ➕ TOP UP
// ===============================
async function topUp(userId, amount) {
  if (!WALLET_API) {
    return { success: false, message: 'Static hosting mode: wallet API unavailable.' };
  }

  try {
    const res = await fetch(`${WALLET_API}/topup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId, amount })
    });

    const data = await res.json();
    return data;

  } catch (error) {
    console.error("TopUp Error:", error);
  }
}

// ===============================
// ➖ WITHDRAW
// ===============================
async function withdraw(userId, amount) {
  if (!WALLET_API) {
    return { success: false, message: 'Static hosting mode: wallet API unavailable.' };
  }

  try {
    const res = await fetch(`${WALLET_API}/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId, amount })
    });

    const data = await res.json();
    return data;

  } catch (error) {
    console.error("Withdraw Error:", error);
  }
}