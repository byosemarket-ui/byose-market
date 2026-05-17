import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadString
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";
import { db, getFirebaseAnalytics, storage } from "../firebase.js";

const PRODUCTS_COLLECTION = "products";
const GLOBAL_SYNC_EVENT = "byose:products-synchronized";
const PRODUCT_CHANGED_EVENT = "byose:products-changed";
const DEFAULT_DETAIL_PAGE = "product-details1.html";
const FALLBACK_IMAGE = "img/logo.png";

let cachedProducts = [];
let lastSnapshotAt = 0;
let sharedSnapshotStop = null;
let sharedSnapshotPromise = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoString(value) {
  if (!value) {
    return "";
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeVisibility(value) {
  const normalized = normalizeText(value, "both").toLowerCase();
  if (normalized === "all") {
    return "both";
  }

  return ["home", "shop", "both"].includes(normalized) ? normalized : "both";
}

function normalizePriority(value) {
  return normalizeText(value, "normal").toLowerCase() === "top" ? "top" : "normal";
}

function normalizeStorageRefs(record) {
  return {
    mainImageStoragePath: normalizeText(record?.mainImageStoragePath),
    galleryStoragePaths: asArray(record?.galleryStoragePaths).map((entry) => normalizeText(entry)).filter(Boolean)
  };
}

function buildKeywords(product) {
  const keywords = new Set();
  [product?.name, product?.title, product?.category, ...(asArray(product?.highlights)), ...(asArray(product?.trust))]
    .join(" ")
    .split(/\s+/)
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean)
    .forEach((entry) => keywords.add(entry));
  return Array.from(keywords);
}

function normalizeProductRecord(record, documentId = "") {
  const id = normalizeText(record?.id || record?.catalogId || documentId);
  const name = normalizeText(record?.name || record?.title, "Untitled product");
  const mainImage = normalizeText(record?.mainImage || record?.image, FALLBACK_IMAGE);
  const gallery = asArray(record?.gallery).map((entry) => normalizeText(entry)).filter(Boolean);
  const createdAt = toIsoString(record?.createdAt) || new Date().toISOString();
  const updatedAt = toIsoString(record?.updatedAt) || createdAt;
  const visibility = normalizeVisibility(record?.visibility);
  const price = toNumber(record?.price, 0);
  const oldPrice = toNumber(record?.oldPrice, 0);

  return {
    ...(record && typeof record === "object" ? record : {}),
    id,
    catalogId: id,
    name,
    title: name,
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    stock: Math.max(0, Math.floor(toNumber(record?.stock ?? record?.availableStock ?? record?.inventory?.available, 0))),
    availableStock: Math.max(0, Math.floor(toNumber(record?.availableStock ?? record?.stock ?? record?.inventory?.available, 0))),
    category: normalizeText(record?.category, "general").toLowerCase(),
    visibility,
    priority: normalizePriority(record?.priority),
    orderIndex: Math.max(0, Math.floor(toNumber(record?.orderIndex, 0))),
    status: normalizeText(record?.status, "active"),
    sku: normalizeText(record?.sku, id),
    badge: normalizeText(record?.badge),
    shortDescription: normalizeText(record?.shortDescription),
    description: normalizeText(record?.description),
    mainImage,
    image: mainImage,
    gallery,
    page: DEFAULT_DETAIL_PAGE,
    url: `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(id)}`,
    keywords: asArray(record?.keywords).length ? asArray(record?.keywords) : buildKeywords(record),
    highlightTag: normalizeText(record?.highlightTag).toLowerCase(),
    createdAt,
    updatedAt,
    ...normalizeStorageRefs(record)
  };
}

function sortProducts(products) {
  return products.slice().sort((left, right) => {
    const leftPriority = String(left?.priority || "").toLowerCase() === "top" ? 1 : 0;
    const rightPriority = String(right?.priority || "").toLowerCase() === "top" ? 1 : 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const rightOrder = toNumber(right?.orderIndex, 0);
    const leftOrder = toNumber(left?.orderIndex, 0);
    if (leftOrder !== rightOrder) {
      return rightOrder - leftOrder;
    }

    return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
  });
}

function publishProducts(products, source = "firebase") {
  const normalizedProducts = sortProducts(asArray(products).map((product) => normalizeProductRecord(product, product?.id || product?.catalogId)));
  cachedProducts = normalizedProducts;
  lastSnapshotAt = Date.now();

  if (typeof window !== "undefined" && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(GLOBAL_SYNC_EVENT, {
      detail: {
        products: normalizedProducts.slice(),
        syncedAt: new Date().toISOString(),
        source
      }
    }));

    window.dispatchEvent(new CustomEvent(PRODUCT_CHANGED_EVENT, {
      detail: {
        products: normalizedProducts.slice(),
        syncedAt: new Date().toISOString(),
        source
      }
    }));
  }

  return normalizedProducts;
}

async function uploadDataUrl(path, dataUrl) {
  const storageRef = ref(storage, path);
  await uploadString(storageRef, dataUrl, "data_url");
  const url = await getDownloadURL(storageRef);
  return {
    path,
    url
  };
}

async function safeDeleteStoragePath(path) {
  const normalizedPath = normalizeText(path);
  if (!normalizedPath) {
    return;
  }

  try {
    await deleteObject(ref(storage, normalizedPath));
  } catch (error) {
    const code = String(error?.code || "");
    if (code !== "storage/object-not-found") {
      console.warn("[Firebase Products] Failed to delete storage object:", normalizedPath, error);
    }
  }
}

function isDataUrl(value) {
  return /^data:/i.test(String(value || "").trim());
}

function isFirebaseStorageUrl(value) {
  return /firebasestorage\.googleapis\.com|storage\.googleapis\.com|googleusercontent\.com/i.test(String(value || ""));
}

async function resolveHeroImage(productId, nextImage, previousProduct) {
  const incomingImage = normalizeText(nextImage || previousProduct?.mainImage || previousProduct?.image);
  if (!incomingImage) {
    if (previousProduct?.mainImageStoragePath) {
      await safeDeleteStoragePath(previousProduct.mainImageStoragePath);
    }
    return {
      image: "",
      storagePath: ""
    };
  }

  if (isDataUrl(incomingImage)) {
    if (previousProduct?.mainImageStoragePath) {
      await safeDeleteStoragePath(previousProduct.mainImageStoragePath);
    }

    const uploadResult = await uploadDataUrl(`products/${productId}/hero-${Date.now()}.jpg`, incomingImage);
    return {
      image: uploadResult.url,
      storagePath: uploadResult.path
    };
  }

  return {
    image: incomingImage,
    storagePath: isFirebaseStorageUrl(incomingImage) ? normalizeText(previousProduct?.mainImageStoragePath) : ""
  };
}

async function resolveGalleryImages(productId, nextGallery, previousProduct) {
  const gallery = asArray(nextGallery);
  const previousPaths = new Set(asArray(previousProduct?.galleryStoragePaths).map((entry) => normalizeText(entry)).filter(Boolean));
  const keptPaths = new Set();
  const nextUrls = [];
  const nextPaths = [];

  for (let index = 0; index < gallery.length; index += 1) {
    const entry = normalizeText(gallery[index]);
    if (!entry) {
      continue;
    }

    if (isDataUrl(entry)) {
      const uploadResult = await uploadDataUrl(`products/${productId}/gallery-${index + 1}-${Date.now()}.jpg`, entry);
      nextUrls.push(uploadResult.url);
      nextPaths.push(uploadResult.path);
      continue;
    }

    nextUrls.push(entry);

    if (isFirebaseStorageUrl(entry)) {
      const matchedPath = asArray(previousProduct?.galleryStoragePaths).find((_path, pathIndex) => normalizeText(previousProduct?.gallery?.[pathIndex]) === entry);
      if (matchedPath) {
        const normalizedPath = normalizeText(matchedPath);
        keptPaths.add(normalizedPath);
        nextPaths.push(normalizedPath);
      }
    }
  }

  await Promise.all(Array.from(previousPaths).filter((path) => !keptPaths.has(path) && !nextPaths.includes(path)).map((path) => safeDeleteStoragePath(path)));

  return {
    gallery: nextUrls,
    galleryStoragePaths: nextPaths
  };
}

function buildProductPayload(productId, productData, assets, previousProduct = {}) {
  const normalized = normalizeProductRecord({
    ...previousProduct,
    ...productData,
    id: productId,
    catalogId: productId,
    mainImage: assets.image || productData?.mainImage || productData?.image || previousProduct?.mainImage || previousProduct?.image,
    image: assets.image || productData?.mainImage || productData?.image || previousProduct?.mainImage || previousProduct?.image,
    gallery: assets.gallery,
    mainImageStoragePath: assets.storagePath,
    galleryStoragePaths: assets.galleryStoragePaths,
    createdAt: previousProduct?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  }, productId);

  return {
    ...normalized,
    mainImageStoragePath: assets.storagePath,
    galleryStoragePaths: assets.galleryStoragePaths,
    createdAt: previousProduct?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

async function fetchProductDocuments() {
  const productsQuery = query(collection(db, PRODUCTS_COLLECTION), orderBy("updatedAt", "desc"));
  const snapshot = await getDocs(productsQuery);
  const products = snapshot.docs.map((snapshotDoc) => normalizeProductRecord(snapshotDoc.data(), snapshotDoc.id));
  return publishProducts(products, "firebase-fetch");
}

export async function getProducts() {
  if (cachedProducts.length) {
    return cachedProducts.slice();
  }

  return fetchProductDocuments();
}

export async function forceRefreshProducts() {
  cachedProducts = [];
  return fetchProductDocuments();
}

export function getCachedProducts() {
  return cachedProducts.slice();
}

export function getLastSnapshotAt() {
  return lastSnapshotAt;
}

export function subscribeToProducts(onProducts, onError) {
  const productsQuery = query(collection(db, PRODUCTS_COLLECTION), orderBy("updatedAt", "desc"));
  return onSnapshot(productsQuery, (snapshot) => {
    const products = snapshot.docs.map((snapshotDoc) => normalizeProductRecord(snapshotDoc.data(), snapshotDoc.id));
    const published = publishProducts(products);
    if (typeof onProducts === "function") {
      onProducts(published.slice());
    }
  }, (error) => {
    console.error("[Firebase Products] Live sync failed:", error);
    if (typeof onError === "function") {
      onError(error);
    }
  });
}

export function ensureProductLiveSync() {
  if (sharedSnapshotStop) {
    return sharedSnapshotPromise;
  }

  sharedSnapshotPromise = Promise.resolve().then(() => {
    sharedSnapshotStop = subscribeToProducts();
    return sharedSnapshotStop;
  });

  return sharedSnapshotPromise;
}

export function stopProductLiveSync() {
  if (typeof sharedSnapshotStop === "function") {
    sharedSnapshotStop();
  }
  sharedSnapshotStop = null;
  sharedSnapshotPromise = null;
}

export async function createProduct(productData = {}) {
  const docRef = doc(collection(db, PRODUCTS_COLLECTION));
  const productId = docRef.id;
  const heroImage = await resolveHeroImage(productId, productData?.mainImage || productData?.image, null);
  const galleryAssets = await resolveGalleryImages(productId, productData?.gallery, null);
  const payload = buildProductPayload(productId, productData, {
    ...heroImage,
    ...galleryAssets
  });

  await setDoc(docRef, payload);
  await getFirebaseAnalytics();
  return forceRefreshProducts().then((products) => products.find((product) => product.id === productId) || normalizeProductRecord(payload, productId));
}

export async function updateProduct(productId, productData = {}) {
  const id = normalizeText(productId);
  if (!id) {
    throw new Error("Product id is required.");
  }

  const previousProduct = (await getProducts()).find((product) => product.id === id || product.catalogId === id) || {};
  const heroImage = await resolveHeroImage(id, productData?.mainImage || productData?.image, previousProduct);
  const galleryAssets = await resolveGalleryImages(id, Object.prototype.hasOwnProperty.call(productData, "gallery") ? productData.gallery : previousProduct?.gallery, previousProduct);
  const payload = buildProductPayload(id, productData, {
    ...heroImage,
    ...galleryAssets
  }, previousProduct);

  await setDoc(doc(db, PRODUCTS_COLLECTION, id), payload, { merge: true });
  return forceRefreshProducts().then((products) => products.find((product) => product.id === id) || normalizeProductRecord(payload, id));
}

export async function deleteProduct(productId) {
  const id = normalizeText(productId);
  if (!id) {
    throw new Error("Product id is required.");
  }

  const existingProduct = (await getProducts()).find((product) => product.id === id || product.catalogId === id) || {};
  await Promise.all([
    safeDeleteStoragePath(existingProduct?.mainImageStoragePath),
    ...asArray(existingProduct?.galleryStoragePaths).map((path) => safeDeleteStoragePath(path))
  ]);
  await deleteDoc(doc(db, PRODUCTS_COLLECTION, id));
  const products = await forceRefreshProducts();
  return {
    id,
    products
  };
}

export default {
  PRODUCTS_COLLECTION,
  GLOBAL_SYNC_EVENT,
  PRODUCT_CHANGED_EVENT,
  getProducts,
  getCachedProducts,
  getLastSnapshotAt,
  forceRefreshProducts,
  subscribeToProducts,
  ensureProductLiveSync,
  stopProductLiveSync,
  createProduct,
  updateProduct,
  deleteProduct
};
