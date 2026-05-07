// ===============================
// 🔥 NOTIFICATION SERVICE
// ===============================

// ===============================
// 📦 BASE API URL
// ===============================
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

const NOTIF_API = window.__BYOSE_NOTIFICATION_API__ || `${resolveApiOrigin()}/api/notifications`;

async function readJsonResponse(response, fallbackValue, failureMessage) {
  const contentType = String(response?.headers?.get("content-type") || "").toLowerCase();
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    throw new Error(payload?.message || failureMessage || `Notification API failed with status ${response.status}`);
  }

  return payload ?? fallbackValue;
}

// ===============================
// 📥 GET NOTIFICATIONS
// ===============================
async function getNotifications(userId) {
  if (!NOTIF_API || !userId) {
    return [];
  }

  try {
    const res = await fetch(`${NOTIF_API}/${userId}`);
    const data = await readJsonResponse(res, { notifications: [] }, 'Unable to load notifications right now.');

    return data.notifications || [];

  } catch (error) {
    console.error("Notifications Error:", error);
    return [];
  }
}

// ===============================
// 🔴 GET UNREAD COUNT
// ===============================
async function getUnreadCount(userId) {
  if (!NOTIF_API || !userId) {
    return 0;
  }

  try {
    const res = await fetch(`${NOTIF_API}/unread/${userId}`);
    const data = await readJsonResponse(res, { count: 0 }, 'Unable to load unread notification count.');

    return data.count || 0;

  } catch (error) {
    console.error("Unread Error:", error);
    return 0;
  }
}

// ===============================
// ✔ MARK AS READ
// ===============================
async function markAsRead(notificationId) {
  if (!NOTIF_API || !notificationId) {
    return { success: true, static: true };
  }

  try {
    const res = await fetch(`${NOTIF_API}/read/${notificationId}`, {
      method: "POST"
    });

    const data = await readJsonResponse(res, { success: true }, 'Unable to mark notification as read right now.');
    return data;

  } catch (error) {
    console.error("Mark Read Error:", error);
    return { success: false, message: error?.message || 'Unable to mark notification as read right now.' };
  }
}

// ===============================
// ❌ DELETE NOTIFICATION
// ===============================
async function deleteNotification(notificationId) {
  if (!NOTIF_API || !notificationId) {
    return { success: true, static: true };
  }

  try {
    const res = await fetch(`${NOTIF_API}/delete/${notificationId}`, {
      method: "POST"
    });

    const data = await readJsonResponse(res, { success: true }, 'Unable to delete notification right now.');
    return data;

  } catch (error) {
    console.error("Delete Error:", error);
    return { success: false, message: error?.message || 'Unable to delete notification right now.' };
  }
}