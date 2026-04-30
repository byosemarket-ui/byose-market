(function (global) {
	"use strict";

	const EVENT_NAME = "byose:customers-changed";
	const cache = {
		customers: [],
		hydrated: false,
		refreshPromise: null,
		lastSyncedAt: 0
	};

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function normalizeText(value) {
		return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
	}

	function normalizeIdentifier(value) {
		return normalizeText(value).replace(/\s+/g, "");
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
		if (!value) return "No date";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "No date";
		return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
	}

	function formatDateTime(value) {
		if (!value) return "No timestamp";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return "No timestamp";
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit"
		}).format(date);
	}

	function normalizeCustomer(customer) {
		return {
			...customer,
			id: String(customer?.id || "").trim(),
			name: String(customer?.name || "Unnamed Customer").trim() || "Unnamed Customer",
			email: String(customer?.email || "").trim().toLowerCase(),
			phone: String(customer?.phone || "").trim(),
			avatar: String(customer?.avatar || "").trim(),
			status: String(customer?.status || "active").trim().toLowerCase() === "blocked" ? "blocked" : "active",
			verified: Boolean(customer?.verified),
			joinedAt: customer?.joinedAt || customer?.createdAt || "",
			address: customer?.address && typeof customer.address === "object" ? customer.address : {},
			totalOrders: Number(customer?.totalOrders || 0) || 0,
			totalSpent: Number(customer?.totalSpent || 0) || 0,
			lastOrderDate: customer?.lastOrderDate || "",
			orders: Array.isArray(customer?.orders) ? customer.orders : []
		};
	}

	function dispatchChange(detail) {
		global.dispatchEvent(new CustomEvent(EVENT_NAME, {
			detail: {
				customers: clone(cache.customers),
				...(detail || {})
			}
		}));
	}

	function getEndpoint(customerId) {
		const base = String(global.AdminConfig?.adminApiBaseUrl || "/api/admin").replace(/\/$/, "");
		return customerId ? `${base}/customers/${encodeURIComponent(String(customerId || "").trim())}` : `${base}/customers`;
	}

	function canUseApi() {
		return Boolean(global.AdminApiClient && typeof global.AdminApiClient.get === "function");
	}

	async function refresh(options) {
		if (!canUseApi()) {
			cache.hydrated = true;
			return cache.customers.slice();
		}

		if (cache.refreshPromise && !options?.force) {
			return cache.refreshPromise;
		}

		cache.refreshPromise = (async () => {
			const payload = await global.AdminApiClient.get(getEndpoint());
			cache.customers = Array.isArray(payload?.customers) ? payload.customers.map(normalizeCustomer) : [];
			cache.hydrated = true;
			cache.lastSyncedAt = Date.now();
			if (!options?.silent) {
				dispatchChange({ action: "refresh", count: cache.customers.length });
			}
			return cache.customers.slice();
		})().finally(() => {
			cache.refreshPromise = null;
		});

		return cache.refreshPromise;
	}

	function init() {
		if (!cache.hydrated) {
			return refresh({ silent: true });
		}
		return Promise.resolve(cache.customers.slice());
	}

	function getCustomers() {
		return cache.customers.slice();
	}

	function getCustomerById(customerId) {
		const normalizedId = String(customerId || "").trim().toLowerCase();
		return getCustomers().find((customer) => String(customer.id).toLowerCase() === normalizedId || normalizeIdentifier(customer.email) === normalizedId || normalizeIdentifier(customer.phone) === normalizedId) || null;
	}

	function getUsers() {
		return getCustomers().map((customer) => ({
			id: customer.id,
			name: customer.name,
			email: customer.email,
			phone: customer.phone,
			avatar: customer.avatar,
			status: customer.status,
			verified: customer.verified,
			createdAt: customer.joinedAt,
			address: customer.address
		}));
	}

	function getOrders() {
		return getCustomers().flatMap((customer) => customer.orders || []);
	}

	function matchesFilter(customer, filter) {
		if (filter === "active") return customer.status === "active";
		if (filter === "new") return new Date(customer.joinedAt || 0).getTime() >= Date.now() - (1000 * 60 * 60 * 24 * 30);
		if (filter === "top") return Number(customer.totalSpent || 0) > 0 || Number(customer.totalOrders || 0) >= 2;
		return true;
	}

	function sortCustomers(customers, sortBy) {
		const list = Array.isArray(customers) ? customers.slice() : [];
		return list.sort((left, right) => {
			if (sortBy === "orders") return Number(right.totalOrders || 0) - Number(left.totalOrders || 0);
			if (sortBy === "spending") return Number(right.totalSpent || 0) - Number(left.totalSpent || 0);
			return new Date(right.joinedAt || 0) - new Date(left.joinedAt || 0);
		});
	}

	function filterCustomers(options) {
		const config = options || {};
		const query = normalizeText(config.query || "");
		const filter = String(config.filter || "all").toLowerCase();
		const sortBy = String(config.sortBy || "date").toLowerCase();

		const filtered = getCustomers().filter((customer) => {
			if (!matchesFilter(customer, filter)) return false;
			if (!query) return true;
			const haystack = [customer.name, customer.email, customer.phone, customer.id].map(normalizeText).join(" ");
			return haystack.includes(query);
		});

		return sortCustomers(filtered, sortBy);
	}

	async function updateCustomer(customerId, updates) {
		const payload = await global.AdminApiClient.put(getEndpoint(customerId), updates || {});
		const customer = normalizeCustomer(payload?.customer || {});
		cache.customers = cache.customers.map((entry) => String(entry.id) === String(customer.id) ? customer : entry);
		dispatchChange({ action: "update", customerId: customer.id });
		return clone(customer);
	}

	async function setCustomerStatus(customerId, status) {
		return updateCustomer(customerId, { status });
	}

	async function deleteCustomer(customerId) {
		await global.AdminApiClient.delete(getEndpoint(customerId));
		cache.customers = cache.customers.filter((customer) => String(customer.id) !== String(customerId || ""));
		dispatchChange({ action: "delete", customerId: String(customerId || "") });
		return true;
	}

	function getCustomerStats() {
		const customers = getCustomers();
		const activeCustomers = customers.filter((customer) => customer.status === "active").length;
		const blockedCustomers = customers.filter((customer) => customer.status === "blocked").length;
		const totalSpent = customers.reduce((sum, customer) => sum + Number(customer.totalSpent || 0), 0);
		const topCustomer = sortCustomers(customers, "spending")[0] || null;

		return {
			totalCustomers: customers.length,
			activeCustomers,
			blockedCustomers,
			totalSpent,
			topCustomer,
			lastSyncedAt: cache.lastSyncedAt
		};
	}

	global.AdminCustomersService = {
		EVENT_NAME,
		deleteCustomer,
		escapeHtml,
		filterCustomers,
		formatCurrency,
		formatDate,
		formatDateTime,
		getCustomerById,
		getCustomerStats,
		getCustomers,
		getOrders,
		getUsers,
		init,
		refresh,
		setCustomerStatus,
		updateCustomer
	};
})(window);
