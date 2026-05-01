(function (global) {
	"use strict";

	const ORDER_KEYS = ["byose_orders", "orders"];
	const USER_KEYS = ["bm_users", "byose_market_users"];
	const EVENT_NAME = "byose:admin-orders-changed";
	const STATUS_OPTIONS = ["Pending", "Confirmed", "Shipping", "Delivered", "Cancelled", "Returned"];
	const FALLBACK_PRODUCT_IMAGE = "../img/logo.png";
	const POLL_INTERVAL_MS = 15000;

	const cache = {
		orders: [],
		hydrated: false,
		lastSyncedAt: 0,
		source: "local",
		refreshPromise: null,
		pollTimerId: 0,
		observersBound: false
	};

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function safeParse(value, fallbackValue) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallbackValue;
		}
	}

	function normalizeText(value) {
		return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
	}

	function normalizeIdentifier(value) {
		return normalizeText(value).replace(/\s+/g, "");
	}

	function normalizePhone(value) {
		return String(value || "").replace(/\s+/g, "").trim();
	}

	function getOrderIdentifier(order, fallbackKey) {
		return String(order?.orderId || order?.id || fallbackKey || "").trim();
	}

	function readArrayFromKeys(keys) {
		const merged = [];
		const seen = new Set();

		for (const key of keys) {
			const raw = global.localStorage.getItem(key);
			if (!raw) {
				continue;
			}

			const parsed = safeParse(raw, []);
			if (!Array.isArray(parsed)) {
				continue;
			}

			parsed.forEach((entry, index) => {
				const identifier = getOrderIdentifier(entry, `${key}-${index}`).toLowerCase();
				if (!identifier || seen.has(identifier)) {
					return;
				}

				seen.add(identifier);
				merged.push(entry);
			});
		}

		return merged;
	}

	function writeOrders(orders) {
		const serialized = JSON.stringify(Array.isArray(orders) ? orders : []);
		ORDER_KEYS.forEach((key) => {
			global.localStorage.setItem(key, serialized);
		});
	}

	function dispatchChange(detail) {
		const payload = detail || {};
		global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
		global.dispatchEvent(new CustomEvent("byose:orders-changed", { detail: payload }));
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function formatCurrency(value) {
		return `RWF ${Number(value || 0).toLocaleString("en-US")}`;
	}

	function formatDate(value) {
		if (!value) {
			return "No date";
		}

		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return "No date";
		}

		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric"
		}).format(date);
	}

	function formatDateTime(value) {
		if (!value) {
			return "No timestamp";
		}

		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return "No timestamp";
		}

		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit"
		}).format(date);
	}

	function getSiteRootHref() {
		const pathname = String(global.location?.pathname || "/").replace(/\\/g, "/");
		const marker = pathname.toLowerCase().indexOf("/admin/");
		const rootPath = marker >= 0 ? pathname.slice(0, marker + 1) : "/";
		return new URL(rootPath, global.location?.origin || global.location?.href || "/").href;
	}

	function resolveStorefrontImagePath(path) {
		const value = String(path || "").trim();
		if (!value) {
			return new URL(FALLBACK_PRODUCT_IMAGE, global.location?.href || getSiteRootHref()).href;
		}

		if (/^(?:data:|blob:|https?:)/i.test(value)) {
			return value;
		}

		try {
			if (value.startsWith("/")) {
				return new URL(value, global.location.origin).href;
			}

			if (value.startsWith("./") || value.startsWith("../")) {
				const normalizedValue = value.replace(/^\.\//, "").replace(/^(\.\.\/)+/, "");
				return new URL(normalizedValue, getSiteRootHref()).href;
			}

			return new URL(value.replace(/^\/+/, ""), getSiteRootHref()).href;
		} catch (error) {
			return value || FALLBACK_PRODUCT_IMAGE;
		}
	}

	function toIsoDate(value) {
		if (!value) {
			return "";
		}

		if (typeof value === "number") {
			return new Date(value).toISOString();
		}

		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? "" : date.toISOString();
	}

	function normalizeStatus(status) {
		const normalized = normalizeText(status);
		if (normalized.includes("return")) {
			return "Returned";
		}
		if (normalized.includes("cancel")) {
			return "Cancelled";
		}
		if (normalized.includes("deliver") || normalized.includes("complete")) {
			return "Delivered";
		}
		if (normalized.includes("ship")) {
			return "Shipping";
		}
		if (normalized.includes("confirm") || normalized.includes("process") || normalized.includes("approve") || normalized.includes("payment")) {
			return "Confirmed";
		}
		return "Pending";
	}

	function getStatusTone(status) {
		const normalized = normalizeStatus(status).toLowerCase();
		if (normalized === "returned" || normalized === "cancelled") {
			return "cancelled";
		}
		if (normalized === "delivered") {
			return "delivered";
		}
		if (normalized === "shipping") {
			return "shipped";
		}
		if (normalized === "confirmed") {
			return "processing";
		}
		return "pending";
	}

	function resolveAddress(record) {
		const source = record?.address && typeof record.address === "object"
			? record.address
			: record?.shippingAddress && typeof record.shippingAddress === "object"
				? record.shippingAddress
				: record || {};

		return {
			fullName: String(source.fullName || [source.firstName, source.lastName].filter(Boolean).join(" ") || "").trim(),
			firstName: String(source.firstName || "").trim(),
			lastName: String(source.lastName || "").trim(),
			phone: normalizePhone(source.phone || record?.customerPhone || ""),
			street: String(source.street || source.streetLandmark || source.line1 || "").trim(),
			provinceCity: String(source.provinceCity || source.city || source.province || "").trim(),
			city: String(source.city || source.provinceCity || source.province || "").trim(),
			district: String(source.district || "").trim(),
			sector: String(source.sector || "").trim(),
			cell: String(source.cell || "").trim(),
			village: String(source.village || "").trim(),
			note: String(source.note || "").trim(),
			latitude: String(source.latitude || record?.gpsLocation?.latitude || "").trim(),
			longitude: String(source.longitude || record?.gpsLocation?.longitude || "").trim(),
			mapLink: String(source.mapLink || source.googleMapsLink || record?.gpsLocation?.googleMapsLink || "").trim(),
			locationAccuracy: String(source.locationAccuracy || "").trim(),
			locationCapturedAt: String(source.locationCapturedAt || "").trim()
		};
	}

	function readUsers() {
		return readArrayFromKeys(USER_KEYS)
			.filter((user) => user && typeof user === "object")
			.map((user) => ({
				id: String(user.id || "").trim(),
				name: String(user.name || "").trim(),
				email: String(user.email || "").trim().toLowerCase(),
				phone: normalizePhone(user.phone || ""),
				avatar: String(user.avatar || user.image || "").trim(),
				address: resolveAddress(user)
			}));
	}

	function buildCustomerLookup() {
		const users = readUsers();
		const lookup = new Map();

		users.forEach((user) => {
			if (user.id) {
				lookup.set(`id:${user.id.toLowerCase()}`, user);
			}
			if (user.email) {
				lookup.set(`email:${normalizeIdentifier(user.email)}`, user);
			}
			if (user.phone) {
				lookup.set(`phone:${normalizeIdentifier(user.phone)}`, user);
			}
		});

		return lookup;
	}

	function getCatalogProducts() {
		const catalogService = global.ByoseProductCatalog;
		if (catalogService && typeof catalogService.getCatalog === "function") {
			return catalogService.getCatalog();
		}
		if (catalogService && typeof catalogService.getStorefrontCatalog === "function") {
			return catalogService.getStorefrontCatalog();
		}
		return Array.isArray(global.products) ? global.products : [];
	}

	function findCatalogProduct(item, catalog) {
		const productId = String(item?.productId || item?.catalogProductId || item?.id || "").trim();
		if (productId) {
			const byId = catalog.find((product) => String(product?.id || "").trim() === productId);
			if (byId) {
				return byId;
			}
		}

		const name = normalizeText(item?.name || item?.productName || "");
		if (!name) {
			return null;
		}

		return catalog.find((product) => normalizeText(product?.name || product?.title || "") === name) || null;
	}

	function normalizeProduct(item, catalogProduct) {
		const attributes = item?.attributes && typeof item.attributes === "object" && !Array.isArray(item.attributes)
			? clone(item.attributes)
			: {};
		const image = resolveStorefrontImagePath(String(
			item?.image
			|| item?.img
			|| item?.imageUrl
			|| item?.productImage
			|| catalogProduct?.mainImage
			|| catalogProduct?.image
			|| ""
		).trim());
		const attributeSummary = Object.keys(attributes).length
			? Object.entries(attributes).map(([key, value]) => `${key}: ${value}`).join(" | ")
			: String(item?.attributeSummary || [item?.color ? `Color: ${item.color}` : "", item?.size ? `Size: ${item.size}` : ""].filter(Boolean).join(" | ") || "Standard option").trim() || "Standard option";

		return {
			id: String(catalogProduct?.id || item?.productId || item?.id || "").trim(),
			name: String(item?.name || item?.productName || catalogProduct?.name || "Product").trim() || "Product",
			price: Number(item?.price || catalogProduct?.price || 0) || 0,
			qty: Math.max(1, Number(item?.qty || item?.quantity || 1) || 1),
			image,
			attributes,
			attributeSummary,
			catalogProduct: catalogProduct ? {
				id: catalogProduct.id,
				category: catalogProduct.category,
				url: catalogProduct.url || catalogProduct.link || "",
				stock: Number(catalogProduct.stock || 0) || 0
			} : null
		};
	}

	function normalizeOrder(order, index, customerLookup, catalog) {
		const customerSeed = order?.customer && typeof order.customer === "object" ? order.customer : {};
		const lookupKeys = [
			String(order?.customerId || order?.userId || customerSeed?.id || "").trim() ? `id:${String(order?.customerId || order?.userId || customerSeed?.id || "").trim().toLowerCase()}` : "",
			String(order?.customerEmail || order?.userEmail || customerSeed?.email || "").trim() ? `email:${normalizeIdentifier(order?.customerEmail || order?.userEmail || customerSeed?.email || "")}` : "",
			String(order?.customerPhone || order?.phoneNumber || customerSeed?.phone || "").trim() ? `phone:${normalizeIdentifier(order?.customerPhone || order?.phoneNumber || customerSeed?.phone || "")}` : ""
		].filter(Boolean);

		const matchedCustomer = lookupKeys.map((key) => customerLookup.get(key)).find(Boolean) || null;
		const shippingAddress = resolveAddress(order?.shippingAddress || matchedCustomer || customerSeed);
		const customerName = String(
			order?.customerName
			|| customerSeed?.name
			|| matchedCustomer?.name
			|| [shippingAddress.firstName, shippingAddress.lastName].filter(Boolean).join(" ")
			|| shippingAddress.fullName
			|| "Guest Customer"
		).trim() || "Guest Customer";

		const productSeed = Array.isArray(order?.products) && order.products.length
			? order.products
			: Array.isArray(order?.items)
				? order.items
				: [];

		const products = productSeed.length
			? productSeed.map((item) => normalizeProduct(item, findCatalogProduct(item, catalog)))
			: [];

		const payment = order?.payment && typeof order.payment === "object" ? order.payment : {};
		const status = normalizeStatus(order?.status || order?.orderStatus);
		const paymentStatus = normalizeText(order?.paymentStatus || payment?.status || "pending") || "pending";

		return {
			...order,
			id: getOrderIdentifier(order, `ORD-${index + 1}`),
			orderId: getOrderIdentifier(order, `ORD-${index + 1}`),
			date: toIsoDate(order?.date || order?.createdAt || order?.timestamp || Date.now()),
			updatedAt: toIsoDate(order?.updatedAt || order?.date || order?.createdAt || Date.now()),
			status,
			statusTone: getStatusTone(status),
			paymentStatus,
			paymentStatusLabel: String(order?.paymentStatusLabel || payment?.status || paymentStatus).trim() || paymentStatus,
			total: Number(order?.total ?? order?.totalAmount ?? order?.totalPrice ?? order?.subtotal ?? 0) || 0,
			subtotal: Number(order?.subtotal || 0) || 0,
			shippingFee: Number(order?.shippingFee ?? order?.deliveryFee ?? 0) || 0,
			codFee: Number(order?.codFee || 0) || 0,
			customerId: String(order?.customerId || order?.userId || matchedCustomer?.id || customerSeed?.id || "").trim(),
			customerName,
			customerEmail: String(order?.customerEmail || order?.userEmail || matchedCustomer?.email || customerSeed?.email || "").trim().toLowerCase(),
			customerPhone: normalizePhone(order?.customerPhone || order?.phoneNumber || matchedCustomer?.phone || customerSeed?.phone || shippingAddress.phone || ""),
			customerImage: String(order?.customerImage || matchedCustomer?.avatar || customerSeed?.avatar || customerSeed?.image || "").trim(),
			customerLink: String(order?.customerId || order?.userId || matchedCustomer?.id || customerSeed?.id || "").trim()
				? `../customers/profile.html?id=${encodeURIComponent(String(order?.customerId || order?.userId || matchedCustomer?.id || customerSeed?.id || "").trim())}`
				: "",
			isGuest: order?.isGuest === true || !String(order?.customerId || order?.userId || matchedCustomer?.id || customerSeed?.id || "").trim(),
			shippingAddress,
			deliveryMethod: String(order?.deliveryMethod || "delivery").trim() || "delivery",
			deliveryLabel: String(order?.deliveryLabel || "Delivery to address").trim() || "Delivery to address",
			paymentType: String(order?.paymentType || payment?.type || "pay_now").trim() || "pay_now",
			paymentMethod: String(order?.paymentMethod || payment?.method || "").trim(),
			payment: {
				type: String(payment?.type || order?.paymentType || "pay_now").trim() || "pay_now",
				method: String(payment?.method || order?.paymentMethod || "").trim(),
				payerPhone: normalizePhone(payment?.payerPhone || order?.customerPhone || shippingAddress.phone || ""),
				transactionId: String(payment?.transactionId || "").trim(),
				status: paymentStatus
			},
			products,
			itemsCount: products.reduce((sum, item) => sum + Number(item.qty || 0), 0),
			searchableText: [
				order?.id,
				order?.orderId,
				customerName,
				order?.customerEmail,
				order?.customerPhone,
				status,
				paymentStatus,
				products.map((item) => item.name).join(" ")
			].map(normalizeText).join(" ")
		};
	}

	function normalizeOrders(rawOrders) {
		const customerLookup = buildCustomerLookup();
		const catalog = getCatalogProducts();
		const unique = new Map();

		(rawOrders || []).map((order, index) => normalizeOrder(order, index, customerLookup, catalog)).forEach((order) => {
			if (!unique.has(order.id)) {
				unique.set(order.id, order);
			}
		});

		return Array.from(unique.values()).sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0));
	}

	function setCacheFromRaw(rawOrders, source) {
		cache.orders = normalizeOrders(rawOrders);
		cache.hydrated = true;
		cache.lastSyncedAt = Date.now();
		cache.source = source || cache.source || "local";
		return cache.orders;
	}

	function readLocalOrders() {
		return readArrayFromKeys(ORDER_KEYS);
	}

	function hydrateCacheFromLocal() {
		return setCacheFromRaw(readLocalOrders(), "local");
	}

	function mergeRawOrders(remoteOrders, localOrders) {
		const merged = new Map();

		(remoteOrders || []).forEach((order, index) => {
			const identifier = getOrderIdentifier(order, `remote-${index}`);
			if (identifier) {
				merged.set(identifier, clone(order));
			}
		});

		(localOrders || []).forEach((order, index) => {
			const identifier = getOrderIdentifier(order, `local-${index}`);
			if (identifier && !merged.has(identifier)) {
				merged.set(identifier, clone(order));
			}
		});

		return Array.from(merged.values());
	}

	function getAdminOrdersEndpoint(orderId) {
		const base = String(global.AdminConfig?.adminApiBaseUrl || "/api/admin").replace(/\/$/, "");
		return orderId ? `${base}/orders/${encodeURIComponent(String(orderId || "").trim())}` : `${base}/orders`;
	}

	function canUseApi() {
		return Boolean(
			global.AdminApiClient
			&& typeof global.AdminApiClient.get === "function"
		);
	}

	async function fetchOrdersFromApi() {
		if (!canUseApi()) {
			return [];
		}

		const payload = await global.AdminApiClient.get(getAdminOrdersEndpoint());
		return Array.isArray(payload?.orders) ? payload.orders : [];
	}

	async function refreshOrders(options) {
		if (cache.refreshPromise) {
			return cache.refreshPromise;
		}

		cache.refreshPromise = (async () => {
			const config = options || {};
			const localOrders = readLocalOrders();
			let nextOrders = localOrders;
			let source = "local";

			if (canUseApi()) {
				try {
					const remoteOrders = await fetchOrdersFromApi();
					nextOrders = mergeRawOrders(remoteOrders, localOrders);
					writeOrders(nextOrders);
					source = "api";
				} catch (error) {
					console.warn("Admin orders API refresh failed. Using local checkout storage.", error);
				}
			}

			const normalized = setCacheFromRaw(nextOrders, source);
			if (!config.silent) {
				dispatchChange({ action: "refresh", source, count: normalized.length });
			}

			return normalized;
		})().finally(() => {
			cache.refreshPromise = null;
		});

		return cache.refreshPromise;
	}

	function ensureObservers() {
		if (cache.observersBound) {
			return;
		}

		cache.observersBound = true;

		global.addEventListener("storage", (event) => {
			if (event && event.key && !ORDER_KEYS.includes(event.key)) {
				return;
			}

			hydrateCacheFromLocal();
			dispatchChange({ action: "storage-sync", source: "local", count: cache.orders.length });
		});

		global.addEventListener("byose:orders-changed", () => {
			refreshOrders({ silent: false }).catch((error) => {
				console.warn("Admin order refresh after checkout event failed.", error);
			});
		});

		global.addEventListener("focus", () => {
			refreshOrders({ silent: false }).catch(() => {});
		});
	}

	function startPolling() {
		if (cache.pollTimerId) {
			return;
		}

		cache.pollTimerId = global.setInterval(() => {
			if (global.document && global.document.hidden) {
				return;
			}

			refreshOrders({ silent: false }).catch(() => {});
		}, POLL_INTERVAL_MS);
	}

	function init() {
		ensureObservers();
		startPolling();

		if (!cache.hydrated) {
			hydrateCacheFromLocal();
		}

		return refreshOrders({ silent: true });
	}

	function getOrders() {
		if (!cache.hydrated) {
			hydrateCacheFromLocal();
		}

		return cache.orders.slice();
	}

	function getOrderById(orderId) {
		return getOrders().find((order) => String(order.id) === String(orderId || "")) || null;
	}

	function sortOrders(orders, sortBy) {
		const list = Array.isArray(orders) ? orders.slice() : [];
		const mode = String(sortBy || "date-desc").toLowerCase();

		return list.sort((left, right) => {
			if (mode === "date-asc") {
				return new Date(left.date || 0) - new Date(right.date || 0);
			}
			if (mode === "total-desc") {
				return Number(right.total || 0) - Number(left.total || 0);
			}
			if (mode === "total-asc") {
				return Number(left.total || 0) - Number(right.total || 0);
			}
			if (mode === "status") {
				return normalizeText(left.status).localeCompare(normalizeText(right.status));
			}
			return new Date(right.date || 0) - new Date(left.date || 0);
		});
	}

	function filterOrders(options) {
		const config = options || {};
		const query = normalizeText(config.query || "");
		const statusFilter = String(config.status || "all").trim();

		const filtered = getOrders().filter((order) => {
			if (statusFilter !== "all" && normalizeStatus(statusFilter) !== order.status) {
				return false;
			}

			if (!query) {
				return true;
			}

			return order.searchableText.includes(query);
		});

		return sortOrders(filtered, config.sortBy);
	}

	function updateLocalOrder(orderId, updater) {
		const localOrders = readLocalOrders();
		const index = localOrders.findIndex((order, position) => getOrderIdentifier(order, `local-${position}`) === String(orderId || ""));
		if (index === -1) {
			return null;
		}

		const updatedOrder = updater(clone(localOrders[index]));
		localOrders.splice(index, 1, updatedOrder);
		writeOrders(localOrders);
		setCacheFromRaw(localOrders, "local");
		return getOrderById(orderId);
	}

	async function updateOrderStatus(orderId, status) {
		const normalizedStatus = normalizeStatus(status);

		if (canUseApi()) {
			try {
				const payload = await global.AdminApiClient.put(`${getAdminOrdersEndpoint(orderId)}/status`, { status: normalizedStatus });
				const remoteOrder = payload?.order;
				if (remoteOrder) {
					const merged = mergeRawOrders([remoteOrder], readLocalOrders().filter((entry) => getOrderIdentifier(entry) !== String(orderId || "")));
					writeOrders(merged);
					setCacheFromRaw(merged, "api");
					dispatchChange({ action: "update", orderId: String(orderId || ""), source: "api" });
					return getOrderById(orderId);
				}
			} catch (error) {
				console.warn("Admin order status update failed against the API. Falling back to local storage.", error);
			}
		}

		const updated = updateLocalOrder(orderId, (order) => ({
			...order,
			orderStatus: normalizedStatus.toLowerCase(),
			status: normalizedStatus,
			updatedAt: new Date().toISOString(),
			statusHistory: [
				...(Array.isArray(order?.statusHistory) ? order.statusHistory : []),
				{
					status: normalizedStatus.toLowerCase(),
					label: normalizedStatus,
					timestamp: new Date().toISOString()
				}
			]
		}));

		if (updated) {
			dispatchChange({ action: "update", orderId: String(orderId || ""), source: "local" });
		}

		return updated;
	}

	async function deleteOrder(orderId) {
		if (canUseApi()) {
			try {
				await global.AdminApiClient.delete(getAdminOrdersEndpoint(orderId));
				const nextLocalOrders = readLocalOrders().filter((entry, index) => getOrderIdentifier(entry, `local-${index}`) !== String(orderId || ""));
				writeOrders(nextLocalOrders);
				setCacheFromRaw(nextLocalOrders, "api");
				dispatchChange({ action: "delete", orderId: String(orderId || ""), source: "api" });
				return true;
			} catch (error) {
				console.warn("Admin order delete failed against the API. Falling back to local storage.", error);
			}
		}

		const orders = readLocalOrders();
		const nextOrders = orders.filter((order, index) => getOrderIdentifier(order, `local-${index}`) !== String(orderId || ""));
		if (nextOrders.length === orders.length) {
			return false;
		}

		writeOrders(nextOrders);
		setCacheFromRaw(nextOrders, "local");
		dispatchChange({ action: "delete", orderId: String(orderId || ""), source: "local" });
		return true;
	}

	function getOrderStats() {
		const orders = getOrders();
		return {
			totalOrders: orders.length,
			pendingOrders: orders.filter((order) => order.status === "Pending" || order.status === "Confirmed" || order.status === "Shipping").length,
			deliveredOrders: orders.filter((order) => order.status === "Delivered").length,
			totalRevenue: orders.reduce((sum, order) => sum + Number(order.total || 0), 0)
		};
	}

	function getSyncState() {
		return {
			hydrated: cache.hydrated,
			lastSyncedAt: cache.lastSyncedAt,
			source: cache.source,
			pollIntervalMs: POLL_INTERVAL_MS
		};
	}

	global.AdminOrdersService = {
		EVENT_NAME,
		STATUS_OPTIONS,
		deleteOrder,
		escapeHtml,
		filterOrders,
		formatCurrency,
		formatDate,
		formatDateTime,
		getOrderById,
		getOrders,
		getOrderStats,
		getStatusTone,
		getSyncState,
		init,
		refresh: refreshOrders,
		updateOrderStatus
	};
})(window);
