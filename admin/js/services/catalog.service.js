(function (global) {
	"use strict";

	const STORAGE_KEY = "byose_market_products_catalog_v1";
	const STORAGE_META_KEY = "byose_market_products_catalog_meta_v1";
	const EVENT_NAME = "byose:products-changed";
	const PRODUCTS_API_PATH = "/products";
	const FALLBACK_IMAGE = "img/logo.png";
	const DEFAULT_DETAIL_PAGE = "product-details1.html";
	const REMOTE_POLL_INTERVAL = 15000;
	const CATEGORY_ALIASES = {
		apparel: "fashion",
		bag: "fashion",
		bags: "fashion",
		clothes: "fashion",
		clothing: "fashion",
		footwear: "shoes",
		phone: "electronics",
		phones: "electronics",
		shoe: "shoes",
		sneakers: "shoes",
		smartwatch: "electronics",
		smartwatches: "electronics",
		watch: "electronics",
		watches: "electronics"
	};

	let inMemoryCatalog = [];
	let remoteSyncPromise = null;
	let pollingStarted = false;
	let refreshTimerId = 0;

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function canUseStorage() {
		try {
			return Boolean(global.localStorage);
		} catch (error) {
			return false;
		}
	}

	function canUseFetch() {
		return typeof global.fetch === "function";
	}

	function safeParse(value, fallbackValue) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallbackValue;
		}
	}

	function normalizeText(value) {
		return String(value || "")
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	}

	function normalizeCategory(value) {
		const normalized = normalizeText(value);
		if (!normalized) {
			return "general";
		}

		return CATEGORY_ALIASES[normalized] || normalized.replace(/\s+/g, "-");
	}

	function normalizeVisibility(value) {
		const normalized = normalizeText(value).replace(/\s+/g, "-");
		if (normalized === "home" || normalized === "shop" || normalized === "both") {
			return normalized;
		}

		if (normalized === "home-only") {
			return "home";
		}

		if (normalized === "shop-only") {
			return "shop";
		}

		return "both";
	}

	function normalizePriority(value) {
		if (typeof value === "number" && Number.isFinite(value)) {
			const normalized = Math.floor(value);
			return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
		}

		const normalizedText = normalizeText(value);
		if (!normalizedText || normalizedText === "normal") {
			return 0;
		}

		if (normalizedText === "top") {
			return 1;
		}

		if (normalizedText === "featured") {
			return 2;
		}

		const parsed = Number(normalizedText);
		if (Number.isFinite(parsed)) {
			const normalized = Math.floor(parsed);
			return normalized === 2 ? 2 : normalized === 1 ? 1 : 0;
		}

		return 0;
	}

	function normalizeHighlightTag(value) {
		const normalized = normalizeText(value).replace(/\s+/g, "-");
		return normalized === "featured" || normalized === "trending" || normalized === "new"
			? normalized
			: "";
	}

	function toNonNegativeNumber(value, fallbackValue) {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}

		return fallbackValue;
	}

	function toTrimmedString(value, fallbackValue) {
		const result = String(value || "").trim();
		return result || String(fallbackValue || "").trim();
	}

	function toStringArray(value) {
		if (!Array.isArray(value)) {
			return [];
		}

		return value.map((entry) => String(entry || "").trim()).filter(Boolean);
	}

	function uniqueStrings(values) {
		return Array.from(new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean)));
	}

	function isSafePath(value) {
		const path = String(value || "").trim();
		return Boolean(path) && !/^javascript:/i.test(path);
	}

	function createProductUrl(productId) {
		return `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(productId))}`;
	}

	function getApiBaseUrl() {
		const explicit = String(global.BYOSE_API_BASE_URL || global.__BYOSE_API_BASE__ || "").trim().replace(/\/+$/, "");
		if (explicit) {
			return explicit.endsWith("/api") ? explicit : `${explicit}/api`;
		}

		const configured = String(global.AdminConfig?.apiBaseUrl || "").trim().replace(/\/+$/, "");
		if (configured) {
			return configured;
		}

		const protocol = String(global.location?.protocol || "").toLowerCase();
		const origin = String(global.location?.origin || "").trim().replace(/\/+$/, "");
		const hostname = String(global.location?.hostname || "").trim().toLowerCase();

		if (protocol === "file:" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
			return `http://${hostname || "localhost"}:5000/api`;
		}

		if (/(^|\.)github\.io$/i.test(hostname)) {
			return "https://byosesemarket4.onrender.com/api";
		}

		return origin ? `${origin}/api` : "/api";
	}

	function getProductsApiUrl(pathSuffix) {
		const suffix = String(pathSuffix || "").replace(/^\/+/, "");
		return `${getApiBaseUrl()}${PRODUCTS_API_PATH}${suffix ? `/${suffix}` : ""}`;
	}

	function getAuthToken() {
		try {
			return String(global.localStorage.getItem("adminToken") || "").trim();
		} catch (error) {
			return "";
		}
	}
function normalizeSpecs(specs) {
		if (!Array.isArray(specs)) {
			return [];
		}

		return specs
			.map((entry) => {
				if (Array.isArray(entry) && entry.length >= 2) {
					return [toTrimmedString(entry[0], "Detail"), toTrimmedString(entry[1], "Available")];
				}

				if (entry && typeof entry === "object") {
					return [toTrimmedString(entry.label || entry.name, "Detail"), toTrimmedString(entry.value, "Available")];
				}

				return null;
			})
			.filter(Boolean);
	}

	function normalizeAttributes(attributes) {
		if (!Array.isArray(attributes)) {
			return [];
		}

		return attributes
			.map((attribute) => {
				if (!attribute || typeof attribute !== "object") {
					return null;
				}

				const options = Array.isArray(attribute.options)
					? attribute.options
						.map((option) => {
							if (!option || typeof option !== "object") {
								return null;
							}

							const normalizedOption = {
								value: toTrimmedString(option.value, "Option"),
								stock: toNonNegativeNumber(option.stock, 0)
							};

							if (isSafePath(option.image)) {
								normalizedOption.image = String(option.image).trim();
							}

							return normalizedOption.value || normalizedOption.image ? normalizedOption : null;
						})
						.filter(Boolean)
					: [];

				return options.length
					? {
						name: toTrimmedString(attribute.name, "Option"),
						type: toTrimmedString(attribute.type, "text") === "image" ? "image" : "text",
						options
					}
					: null;
			})
			.filter(Boolean);
	}

	function collectKeywords(product) {
		const keywords = toStringArray(product.keywords);
		const tokens = [
			...keywords,
			...normalizeText(product.name).split(/\s+/),
			normalizeCategory(product.category),
			normalizeText(product.badge)
		];

		return uniqueStrings(tokens);
	}

	function normalizeProduct(product, index, usedIds) {
		const rawProduct = product && typeof product === "object" ? product : {};
		const name = toTrimmedString(rawProduct.name || rawProduct.title, `Product ${index + 1}`);
		const category = normalizeCategory(rawProduct.category);
		let id = Number(rawProduct.id || rawProduct.catalogId);

		if (!Number.isFinite(id) || id <= 0 || usedIds.has(id)) {
			id = 1;
			while (usedIds.has(id)) {
				id += 1;
			}
		}

		usedIds.add(id);

		const price = toNonNegativeNumber(rawProduct.price, 0);
		const oldPrice = toNonNegativeNumber(rawProduct.oldPrice, 0);
		const stock = toNonNegativeNumber(rawProduct.stock, 0);
		const badge = toTrimmedString(rawProduct.badge, "");
		const visibility = normalizeVisibility(rawProduct.visibility);
		const priority = normalizePriority(rawProduct.priority);
		const orderIndex = toNonNegativeNumber(rawProduct.orderIndex, 0);
		const highlightTag = normalizeHighlightTag(rawProduct.highlightTag);
		const mainImage = isSafePath(rawProduct.mainImage)
			? String(rawProduct.mainImage).trim()
			: isSafePath(rawProduct.image)
				? String(rawProduct.image).trim()
				: FALLBACK_IMAGE;

		const gallery = uniqueStrings([mainImage, ...toStringArray(rawProduct.gallery)]);
		const shortDescription = toTrimmedString(
			rawProduct.shortDescription || rawProduct.description,
			`${name} is available in the Byose Market catalog.`
		);
		const longDescription = toStringArray(rawProduct.longDescription);
		const highlights = toStringArray(rawProduct.highlights);
		const trust = toStringArray(rawProduct.trust);
		const now = new Date().toISOString();

		const normalized = {
			...rawProduct,
			id,
			catalogId: id,
			name,
			title: name,
			category,
			badge,
			visibility,
			priority,
			orderIndex,
			highlightTag,
			price,
			oldPrice: oldPrice > price ? oldPrice : 0,
			stock,
			mainImage,
			image: mainImage,
			gallery,
			shortDescription,
			description: toTrimmedString(rawProduct.description, shortDescription),
			longDescription: longDescription.length ? longDescription : [shortDescription],
			highlights,
			trust,
			specs: normalizeSpecs(rawProduct.specs),
			attributes: normalizeAttributes(rawProduct.attributes),
			keywords: [],
			page: DEFAULT_DETAIL_PAGE,
			url: createProductUrl(id),
			status: toTrimmedString(rawProduct.status, "active"),
			createdAt: rawProduct.createdAt || now,
			updatedAt: rawProduct.updatedAt || now
		};

		normalized.keywords = collectKeywords(normalized);
		return normalized;
	}

	function normalizeCatalog(items) {
		const source = Array.isArray(items) ? items : [];
		const usedIds = new Set();
		return source.map((item, index) => normalizeProduct(item, index, usedIds));
	}

	function readPersistedCatalog() {
		if (!canUseStorage()) {
			return [];
		}

		const metadata = safeParse(global.localStorage.getItem(STORAGE_META_KEY) || "{}", {});
		if (metadata?.source !== "backend") {
			return [];
		}

		return safeParse(global.localStorage.getItem(STORAGE_KEY) || "[]", []);
	}

	function dispatchChange(detail) {
		const eventDetail = {
			catalog: clone(inMemoryCatalog),
			...detail
		};

		global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: eventDetail }));
		if (global.document && typeof global.document.dispatchEvent === "function") {
			global.document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: eventDetail }));
		}
	}

	function persistCatalog(catalog, metadata) {
		inMemoryCatalog = normalizeCatalog(catalog);

		if (canUseStorage()) {
			try {
				global.localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryCatalog));
				global.localStorage.setItem(STORAGE_META_KEY, JSON.stringify({
					source: "backend",
					updatedAt: new Date().toISOString()
				}));
			} catch (_error) {
				// Ignore storage failures.
			}
		}

		if (!metadata?.silent) {
			dispatchChange(metadata || {});
		}

		return clone(inMemoryCatalog);
	}

	async function requestRemote(pathSuffix, options) {
		if (!canUseFetch()) {
			throw new Error("Product sync is not available in this browser.");
		}

		const authToken = getAuthToken();
		const response = await global.fetch(getProductsApiUrl(pathSuffix), {
			method: options?.method || "GET",
			headers: {
				...(options?.body ? { "Content-Type": "application/json" } : {}),
				Accept: "application/json",
				...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
				...(options?.headers || {})
			},
			body: options?.body ? JSON.stringify(options.body) : undefined
		});

		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				if (global.AdminSecurity && typeof global.AdminSecurity.handleUnauthorized === "function") {
					global.AdminSecurity.handleUnauthorized();
				}
			}

			throw new Error((payload && payload.message) || "Unable to sync products with the server.");
		}

		return payload;
	}

	async function refreshCatalog(options) {
		const config = options || {};
		if (!canUseFetch()) {
			throw new Error('Product sync is not available in this browser.');
		}

		if (remoteSyncPromise && !config.force) {
			return remoteSyncPromise;
		}

		remoteSyncPromise = (async () => {
			try {
				const payload = await requestRemote("", { method: "GET" });
				const remoteProducts = Array.isArray(payload?.products) ? payload.products : [];

				if (remoteProducts.length) {
					persistCatalog(remoteProducts, { action: config.action || "refresh" });
					return clone(inMemoryCatalog);
				}

				persistCatalog([], { action: config.action || "refresh-empty", silent: true });
				return clone(inMemoryCatalog);
			} catch (error) {
				if (!config.silent) {
					dispatchChange({ action: "refresh-error", error: error.message });
				}
				if (config.allowCacheFallback === true) {
					return clone(inMemoryCatalog);
				}
				throw error;
			} finally {
				remoteSyncPromise = null;
			}
		})();

		return remoteSyncPromise;
	}

	function queueRefresh(options) {
		global.clearTimeout(refreshTimerId);
		refreshTimerId = global.setTimeout(() => {
			refreshCatalog(options).catch(() => {});
		}, 40);
	}

	function startPolling() {
		if (pollingStarted || !canUseFetch()) {
			return;
		}

		pollingStarted = true;
		global.setInterval(() => {
			if (global.document?.hidden) {
				return;
			}

			refreshCatalog({ silent: true }).catch(() => {});
		}, REMOTE_POLL_INTERVAL);

		global.addEventListener("focus", () => {
			queueRefresh({ silent: true, force: true });
		});

		global.document?.addEventListener?.("visibilitychange", () => {
			if (!global.document.hidden) {
				queueRefresh({ silent: true, force: true });
			}
		});
	}

	function ensureInitialized() {
		const persisted = readPersistedCatalog();
		if (persisted.length) {
			inMemoryCatalog = normalizeCatalog(persisted);
		}

	}

	function getCatalog() {
		ensureInitialized();
		const persisted = readPersistedCatalog();
		if (persisted.length) {
			inMemoryCatalog = normalizeCatalog(persisted);
			return clone(inMemoryCatalog);
		}

		return clone(inMemoryCatalog);
	}

	function registerSeed(seedItems) {
		const _ignored = seedItems;
		queueRefresh({ silent: true, allowCacheFallback: true });
		return getCatalog();
	}

	function getProductById(productId) {
		return getCatalog().find((item) => Number(item.id) === Number(productId)) || null;
	}

	async function createProduct(payload) {
		ensureInitialized();
		const response = await requestRemote("", {
			method: "POST",
			body: payload || {}
		});

		const createdProduct = normalizeCatalog([response?.product || payload])[0] || null;
		if (!createdProduct) {
			throw new Error("The product could not be created.");
		}

		const catalog = getCatalog().filter((item) => Number(item.id) !== Number(createdProduct.id));
		catalog.push(createdProduct);
		persistCatalog(catalog, { action: "create", productId: createdProduct.id });
		return clone(createdProduct);
	}

	async function updateProduct(productId, updates) {
		ensureInitialized();
		const response = await requestRemote(String(productId || ""), {
			method: "PUT",
			body: {
				...(updates || {}),
				id: Number(productId)
			}
		});

		const updatedProduct = normalizeCatalog([response?.product || { ...(updates || {}), id: Number(productId) }])[0] || null;
		if (!updatedProduct) {
			throw new Error("The product could not be saved.");
		}

		const catalog = getCatalog().filter((item) => Number(item.id) !== Number(updatedProduct.id));
		catalog.push(updatedProduct);
		persistCatalog(catalog, {
			action: response?.created ? "create" : "update",
			productId: updatedProduct.id
		});
		return clone(updatedProduct);
	}

	async function deleteProduct(productId) {
		ensureInitialized();
		await requestRemote(String(productId || ""), {
			method: "DELETE"
		});

		const nextCatalog = getCatalog().filter((item) => Number(item.id) !== Number(productId));
		persistCatalog(nextCatalog, { action: "delete", productId: Number(productId) });
		return true;
	}

	function getStorefrontCatalog() {
		return getCatalog().map((item) => ({
			...item,
			image: item.mainImage || item.image || FALLBACK_IMAGE,
			page: DEFAULT_DETAIL_PAGE,
			url: createProductUrl(item.id)
		}));
	}

	function formatPrice(value) {
		return `RWF ${Number(value || 0).toLocaleString("en-US")}`;
	}

	global.ByoseProductCatalog = {
		EVENT_NAME,
		STORAGE_KEY,
		createProduct,
		createProductUrl,
		deleteProduct,
		formatPrice,
		getCatalog,
		getProductById,
		getStorefrontCatalog,
		refreshCatalog,
		registerSeed,
		updateProduct
	};

	ensureInitialized();
})(window);
