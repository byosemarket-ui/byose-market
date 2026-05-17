import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAnalytics, isSupported as isAnalyticsSupported } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

// Firebase configuration for the BYOSE Market production project.
const firebaseConfig = {
  apiKey: "AIzaSyAdBhsn-k_VjzA9nJgh_T0iKh3sZbxl3_Q",
  authDomain: "byose-market-240af.firebaseapp.com",
  projectId: "byose-market-240af",
  storageBucket: "byose-market-240af.firebasestorage.app",
  messagingSenderId: "674298127437",
  appId: "1:674298127437:web:7bf92e89821488e359a804",
  measurementId: "G-QE4DPD4VQL"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

let analyticsPromise = null;

export async function getFirebaseAnalytics() {
  if (analyticsPromise) {
    return analyticsPromise;
  }

  analyticsPromise = (async () => {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      const supported = await isAnalyticsSupported();
      return supported ? getAnalytics(app) : null;
    } catch (_error) {
      return null;
    }
  })();

  return analyticsPromise;
}

export default app;
