/**
 * Client-side notification preference helpers (browser + sound).
 * Settings are loaded from the API; secrets never live here.
 */

const PREFS_EVENT = "admin:notification-settings-changed";

const DEFAULT_PREFS = Object.freeze({
  browserNotificationsEnabled: true,
  soundNotificationsEnabled: false,
  notificationSoundId: "soft",
  eventChannelPreferences: {}
});

let cachedPrefs = { ...DEFAULT_PREFS };
let prefsReady = false;
let audioCtx = null;

export function areNotificationPrefsReady() {
  return prefsReady;
}

export function getCachedNotificationPrefs() {
  return {
    ...cachedPrefs,
    eventChannelPreferences: { ...(cachedPrefs.eventChannelPreferences || {}) },
    ready: prefsReady
  };
}

export function setCachedNotificationPrefs(next = {}) {
  cachedPrefs = {
    browserNotificationsEnabled: next.browserNotificationsEnabled !== false,
    soundNotificationsEnabled: Boolean(next.soundNotificationsEnabled),
    notificationSoundId: String(next.notificationSoundId || "soft").toLowerCase() || "soft",
    eventChannelPreferences: next.eventChannelPreferences && typeof next.eventChannelPreferences === "object"
      ? next.eventChannelPreferences
      : {}
  };
  prefsReady = true;
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: getCachedNotificationPrefs() }));
  return getCachedNotificationPrefs();
}

function ensureAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playToneSequence(sequence = []) {
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  const now = ctx.currentTime;
  sequence.forEach((tone) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type || "sine";
    osc.frequency.value = tone.frequency || 880;
    gain.gain.setValueAtTime(0.0001, now + (tone.start || 0));
    gain.gain.exponentialRampToValueAtTime(tone.volume || 0.05, now + (tone.start || 0) + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (tone.start || 0) + (tone.duration || 0.18));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + (tone.start || 0));
    osc.stop(now + (tone.start || 0) + (tone.duration || 0.18) + 0.02);
  });
  return true;
}

export function playNotificationSound(soundId = cachedPrefs.notificationSoundId) {
  const id = String(soundId || "soft").toLowerCase();
  if (id === "chime") {
    return playToneSequence([
      { frequency: 784, start: 0, duration: 0.14, volume: 0.045 },
      { frequency: 988, start: 0.12, duration: 0.18, volume: 0.04 }
    ]);
  }
  if (id === "alert") {
    return playToneSequence([
      { frequency: 620, start: 0, duration: 0.12, volume: 0.05, type: "triangle" },
      { frequency: 520, start: 0.14, duration: 0.12, volume: 0.045, type: "triangle" },
      { frequency: 720, start: 0.28, duration: 0.16, volume: 0.04, type: "triangle" }
    ]);
  }
  return playToneSequence([
    { frequency: 660, start: 0, duration: 0.16, volume: 0.035 }
  ]);
}

export async function requestBrowserNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch (_error) {
    return Notification.permission || "default";
  }
}

export function showBrowserNotification(title, options = {}) {
  if (!cachedPrefs.browserNotificationsEnabled) return false;
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  if (document.visibilityState === "visible") return false;

  try {
    const note = new Notification(String(title || "BYOSE Market"), {
      body: String(options.body || ""),
      tag: String(options.tag || "byose-admin-notification"),
      renotify: true
    });
    note.onclick = () => {
      window.focus();
      if (options.href) {
        window.location.hash = options.href;
      }
      note.close();
    };
    return true;
  } catch (_error) {
    return false;
  }
}

export function announceIncomingNotification(notification = {}) {
  // Avoid firing browser/sound with defaults before settings hydrate.
  if (!prefsReady) return;

  const eventKey = String(notification?.metadata?.eventKey || notification?.eventKey || "").toUpperCase();
  const eventPrefs = eventKey && cachedPrefs.eventChannelPreferences
    ? cachedPrefs.eventChannelPreferences[eventKey]
    : null;

  const soundAllowed = cachedPrefs.soundNotificationsEnabled
    && (eventPrefs == null || eventPrefs.sound !== false);
  const browserAllowed = cachedPrefs.browserNotificationsEnabled !== false
    && (eventPrefs == null || eventPrefs.browser !== false);

  if (soundAllowed) {
    playNotificationSound(cachedPrefs.notificationSoundId);
  }
  if (browserAllowed) {
    showBrowserNotification(notification.title || "New notification", {
      body: notification.message || "",
      tag: notification.id || "byose-admin-notification",
      href: "#/notifications"
    });
  }
}

export { PREFS_EVENT };
