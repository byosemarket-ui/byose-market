(function (global) {
	"use strict";

	const STORAGE_KEY = "byose_market_products_catalog_v1";
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
	let registeredSeedCatalog = [];
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
		return normalizeText(value) === "top" ? "top" : "normal";
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
		return String(global.AdminConfig?.apiBaseUrl || "/api").replace(/\/$/, "");
	}

	function getProductsApiUrl(pathSuffix) {
		const suffix = String(pathSuffix || "").replace(/^\/+/, "");
		return `${getApiBaseUrl()}${PRODUCTS_API_PATH}${suffix ? `/${suffix}` : ""}`;
	}

	function getAuthToken() {
		return String(global.AdminAuthService?.getToken?.() || "").trim();
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

	function mergeCatalogWithSeed(items, seedItems) {
		const catalog = normalizeCatalog(items);
		const seedCatalog = normalizeCatalog(seedItems);
		if (!seedCatalog.length) {
			return catalog;
		}

		const seedById = new Map(seedCatalog.map((item) => [Number(item.id), item]));
		return normalizeCatalog((catalog.length ? catalog : seedCatalog).map((item) => {
			const seed = seedById.get(Number(item.id)) || {};
			return {
				...seed,
				...item,
				mainImage: item.mainImage || item.image || seed.mainImage || seed.image,
				image: item.image || item.mainImage || seed.image || seed.mainImage,
				gallery: Array.isArray(item.gallery) && item.gallery.length ? item.gallery : seed.gallery,
				keywords: Array.isArray(item.keywords) && item.keywords.length ? item.keywords : seed.keywords,
				longDescription: Array.isArray(item.longDescription) && item.longDescription.length ? item.longDescription : seed.longDescription,
				highlights: Array.isArray(item.highlights) && item.highlights.length ? item.highlights : seed.highlights,
				trust: Array.isArray(item.trust) && item.trust.length ? item.trust : seed.trust,
				specs: Array.isArray(item.specs) && item.specs.length ? item.specs : seed.specs,
				attributes: Array.isArray(item.attributes) && item.attributes.length ? item.attributes : seed.attributes
			};
		}));
	}

	function readPersistedCatalog() {
		if (!canUseStorage()) {
			return [];
		}

		const raw = global.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return [];
		}

		const parsed = safeParse(raw, []);
		const catalog = Array.isArray(parsed)
			? parsed
			: parsed && Array.isArray(parsed.catalog)
				? parsed.catalog
				: [];

		return normalizeCatalog(catalog);
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
		inMemoryCatalog = mergeCatalogWithSeed(catalog, registeredSeedCatalog);

		if (canUseStorage()) {
			global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
				updatedAt: new Date().toISOString(),
				catalog: inMemoryCatalog
			}));
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
				...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
				...(options?.headers || {})
			},
			body: options?.body ? JSON.stringify(options.body) : undefined
		});

		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error((payload && payload.message) || "Unable to sync products with the server.");
		}

		return payload;
	}

	function hydrateLocalFallbackFromSeed() {
		if (!inMemoryCatalog.length && registeredSeedCatalog.length) {
			persistCatalog(registeredSeedCatalog, { action: "seed", silent: true });
		}
	}

	async function bootstrapRemoteCatalog() {
		if (!registeredSeedCatalog.length || !getAuthToken()) {
			return [];
		}

		const payload = await requestRemote("bootstrap", {
			method: "POST",
			body: {
				products: registeredSeedCatalog
			}
		});

		const remoteProducts = Array.isArray(payload?.products) ? payload.products : [];
		if (remoteProducts.length) {
			persistCatalog(remoteProducts, { action: "bootstrap" });
		}

		return remoteProducts;
	}

	async function refreshCatalog(options) {
		const config = options || {};
		if (!canUseFetch()) {
			hydrateLocalFallbackFromSeed();
			return clone(inMemoryCatalog);
		}

		if (remoteSyncPromise && !config.force) {
			return remoteSyncPromise;
		}

		remoteSyncPromise = (async () => {
			try {
				const payload = await requestRemote("", { method: "GET" });
				let remoteProducts = Array.isArray(payload?.products) ? payload.products : [];

				if (!remoteProducts.length && config.allowBootstrap !== false && registeredSeedCatalog.length && getAuthToken()) {
					remoteProducts = await bootstrapRemoteCatalog();
				}

				if (remoteProducts.length) {
					persistCatalog(remoteProducts, { action: config.action || "refresh" });
					return clone(inMemoryCatalog);
				}

				hydrateLocalFallbackFromSeed();
				return clone(inMemoryCatalog);
			} catch (error) {
				hydrateLocalFallbackFromSeed();
				if (!config.silent) {
					dispatchChange({ action: "refresh-error", error: error.message });
				}
				return clone(inMemoryCatalog);
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

			refreshCatalog({ silent: true, allowBootstrap: false }).catch(() => {});
		}, REMOTE_POLL_INTERVAL);

		global.addEventListener("focus", () => {
			queueRefresh({ silent: true, allowBootstrap: false, force: true });
		});

		global.document?.addEventListener?.("visibilitychange", () => {
			if (!global.document.hidden) {
				queueRefresh({ silent: true, allowBootstrap: false, force: true });
			}
		});
	}

	function ensureInitialized() {
		const persisted = readPersistedCatalog();
		if (persisted.length) {
			inMemoryCatalog = mergeCatalogWithSeed(persisted, registeredSeedCatalog);
		}

		startPolling();
	}

	function getCatalog() {
		ensureInitialized();
		const persisted = readPersistedCatalog();
		if (persisted.length) {
			inMemoryCatalog = mergeCatalogWithSeed(persisted, registeredSeedCatalog);
			return clone(inMemoryCatalog);
		}

		hydrateLocalFallbackFromSeed();
		return clone(inMemoryCatalog);
	}

	function registerSeed(seedItems) {
		const normalizedSeed = normalizeCatalog(seedItems);
		registeredSeedCatalog = mergeCatalogWithSeed(normalizedSeed, registeredSeedCatalog);
		if (!normalizedSeed.length) {
			queueRefresh({ silent: true, allowBootstrap: false });
			return getCatalog();
		}

		const currentCatalog = getCatalog();
		if (!currentCatalog.length) {
			persistCatalog(registeredSeedCatalog, { action: "seed", silent: true });
		} else {
			inMemoryCatalog = mergeCatalogWithSeed(currentCatalog, registeredSeedCatalog);
		}

		queueRefresh({ silent: true, allowBootstrap: true });
		return clone(inMemoryCatalog);
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
