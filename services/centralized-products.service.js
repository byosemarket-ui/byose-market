/**
 * Firebase-backed centralized product catalog.
 *
 * The public API stays aligned with the previous service so existing
 * storefront modules can keep importing this file without larger rewrites.
 */

import firebaseProductsService from "./firebase-products.service.js";

const GLOBAL_SYNC_EVENT = firebaseProductsService.GLOBAL_SYNC_EVENT;
const PRODUCT_CHANGED_EVENT = firebaseProductsService.PRODUCT_CHANGED_EVENT;
const STALE_THRESHOLD_MS = 45000;

export async function fetchProductsFromBackend() {
  return firebaseProductsService.getProducts();
}

export async function getProductsWithRetry() {
  return firebaseProductsService.getProducts();
}

export function getCachedProducts() {
  return firebaseProductsService.getCachedProducts();
}

export function isCacheStale() {
  const lastSnapshotAt = Number(firebaseProductsService.getLastSnapshotAt() || 0);
  return !lastSnapshotAt || Date.now() - lastSnapshotAt > STALE_THRESHOLD_MS;
}

export function startBackgroundSync() {
  return firebaseProductsService.ensureProductLiveSync();
}

export function stopBackgroundSync() {
  firebaseProductsService.stopProductLiveSync();
}

export async function forceRefreshProducts() {
  return firebaseProductsService.forceRefreshProducts();
}

export async function handleAdminProductUpdate() {
  return forceRefreshProducts();
}

if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    startBackgroundSync();
  });

  window.addEventListener(PRODUCT_CHANGED_EVENT, () => {
    firebaseProductsService.ensureProductLiveSync();
  });

  window.addEventListener("beforeunload", () => {
    stopBackgroundSync();
  });
}

export default {
  fetchProductsFromBackend,
  getProductsWithRetry,
  getCachedProducts,
  isCacheStale,
  startBackgroundSync,
  stopBackgroundSync,
  forceRefreshProducts,
  handleAdminProductUpdate,
  GLOBAL_SYNC_EVENT,
  PRODUCT_CHANGED_EVENT
};
