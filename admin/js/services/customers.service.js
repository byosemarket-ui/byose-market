(function (global) {
	"use strict";

	const USER_KEYS = ["bm_users", "byose_market_users"];
	const ORDER_KEYS = ["byose_orders", "orders"];
	const CURRENT_USER_KEYS = ["bm_current_user", "bm_user", "byose_market_user"];
	const EVENT_NAME = "byose:customers-changed";

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

	function readArrayFromKeys(keys) {
		const merged = [];
		const seen = new Map();

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
				const identifier = String(
					entry?.id
					|| entry?.orderId
					|| entry?.email
					|| entry?.phone
					|| `${key}-${index}`
				).trim().toLowerCase();

				if (seen.has(identifier)) {
					const existingIndex = seen.get(identifier);
					merged[existingIndex] = {
						...merged[existingIndex],
						...entry
					};
					return;
				}

				seen.set(identifier, merged.length);
				merged.push(entry);
			});
		}

		return merged;
	}

	function writeUsers(users) {
		const serialized = JSON.stringify(Array.isArray(users) ? users : []);
		USER_KEYS.forEach((key) => {
			global.localStorage.setItem(key, serialized);
		});
	}

	function readCurrentUser() {
		for (const key of CURRENT_USER_KEYS) {
			const raw = global.localStorage.getItem(key);
			if (!raw) {
				continue;
			}

			const parsed = safeParse(raw, null);
			if (parsed && typeof parsed === "object") {
				return parsed;
			}
		}

		return null;
	}

	function writeCurrentUser(user) {
		const serialized = JSON.stringify(user || {});
		CURRENT_USER_KEYS.forEach((key) => {
			if (user) {
				global.localStorage.setItem(key, serialized);
			} else {
				global.localStorage.removeItem(key);
			}
		});

		if (user) {
			global.localStorage.setItem("bm_logged_in", "true");
		} else {
			global.localStorage.removeItem("bm_logged_in");
		}
	}

	function normalizeText(value) {
		return String(value || "")
			.toLowerCase()
			.trim()
			.replace(/\s+/g, " ");
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

	function createLetterAvatar(name) {
		const letter = (String(name || "U").trim()[0] || "U").toUpperCase();
		const hue = (letter.charCodeAt(0) * 29) % 360;
		const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='100%' height='100%' rx='28' fill='hsl(${hue} 58% 48%)'/><text x='50%' y='50%' fill='white' font-family='Manrope, Arial, sans-serif' font-size='72' font-weight='700' dominant-baseline='middle' text-anchor='middle'>${letter}</text></svg>`;
		return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
	}

	function normalizePhone(value) {
		return String(value || "").replace(/\s+/g, "").trim();
	}

	function normalizeIdentifier(value) {
		return normalizeText(value).replace(/\s+/g, "");
	}

	function resolveCustomerName(record) {
		return String(
			record?.name
			|| record?.fullName
			|| [record?.firstName, record?.lastName].filter(Boolean).join(" ")
			|| record?.customerName
			|| "Unnamed Customer"
		).trim() || "Unnamed Customer";
	}

	function resolveAddress(record) {
		if (record?.address && typeof record.address === "object") {
			return {
				line1: String(record.address.line1 || record.address.street || "").trim(),
				city: String(record.address.city || "").trim(),
				district: String(record.address.district || "").trim(),
				sector: String(record.address.sector || "").trim(),
				cell: String(record.address.cell || "").trim(),
				village: String(record.address.village || "").trim()
			};
		}

		return {
			line1: String(record?.street || record?.addressLine1 || "").trim(),
			city: String(record?.city || "").trim(),
			district: String(record?.district || "").trim(),
			sector: String(record?.sector || "").trim(),
			cell: String(record?.cell || "").trim(),
			village: String(record?.village || "").trim()
		};
	}

	function resolveBestContact(record) {
		return String(record?.email || record?.phone || record?.customerEmail || record?.customerPhone || "").trim();
	}

	function normalizeUserRecord(user) {
		const name = resolveCustomerName(user);
		const email = String(user?.email || "").trim().toLowerCase();
		const phone = normalizePhone(user?.phone || "");
		const joinedAt = toIsoDate(user?.createdAt || user?.joinedAt || user?.dateJoined || Date.now());
		return {
			...user,
			id: String(user?.id || `${email || phone || name}`),
			name,
			email,
			phone,
			avatar: String(user?.avatar || user?.profileImage || user?.image || createLetterAvatar(name)).trim(),
			status: String(user?.status || "active").toLowerCase() === "blocked" ? "blocked" : "active",
			verified: Boolean(user?.verified),
			joinedAt,
			address: resolveAddress(user)
		};
	}

	function normalizeOrder(order, index) {
		const products = Array.isArray(order?.products)
			? order.products.map((item) => ({
				id: Number(item?.productId || item?.id || 0) || 0,
				name: String(item?.name || "Product").trim() || "Product",
				price: Number(item?.price || 0) || 0,
				qty: Math.max(1, Number(item?.qty || 1) || 1),
				image: String(item?.image || item?.img || "").trim(),
				attributes: item?.attributes && typeof item.attributes === "object" ? clone(item.attributes) : {}
			}))
			: [];

		const customer = order?.customer && typeof order.customer === "object" ? order.customer : {};
		const firstName = String(order?.shippingAddress?.firstName || customer?.firstName || "").trim();
		const lastName = String(order?.shippingAddress?.lastName || customer?.lastName || "").trim();
		const customerName = String(
			customer?.name
			|| order?.customerName
			|| [firstName, lastName].filter(Boolean).join(" ")
			|| "Guest Customer"
		).trim();

		return {
			...order,
			id: String(order?.id || `ORD-${index + 1}`),
			date: toIsoDate(order?.date || order?.createdAt || Date.now()),
			total: Number(order?.total || 0) || 0,
			status: String(order?.status || "Pending").trim() || "Pending",
			customerId: String(order?.customerId || customer?.id || "").trim(),
			customerName,
			customerEmail: String(order?.customerEmail || customer?.email || "").trim().toLowerCase(),
			customerPhone: normalizePhone(order?.customerPhone || customer?.phone || order?.shippingAddress?.phone || ""),
			customerImage: String(order?.customerImage || customer?.avatar || customer?.image || "").trim(),
			shippingAddress: {
				firstName,
				lastName,
				phone: normalizePhone(order?.shippingAddress?.phone || customer?.phone || ""),
				city: String(order?.shippingAddress?.city || "").trim(),
				district: String(order?.shippingAddress?.district || "").trim(),
				sector: String(order?.shippingAddress?.sector || "").trim(),
				cell: String(order?.shippingAddress?.cell || "").trim(),
				village: String(order?.shippingAddress?.village || "").trim()
			},
			products
		};
	}

	function buildLookupKeys(record) {
		const keys = new Set();
		if (record?.id) {
			keys.add(`id:${String(record.id).trim().toLowerCase()}`);
		}
		if (record?.email) {
			keys.add(`email:${normalizeIdentifier(record.email)}`);
		}
		if (record?.phone) {
			keys.add(`phone:${normalizeIdentifier(record.phone)}`);
		}
		return Array.from(keys);
	}

	function dispatchChange(detail) {
		global.dispatchEvent(new CustomEvent(EVENT_NAME, {
			detail: detail || {}
		}));
	}

	function getUsers() {
		return readArrayFromKeys(USER_KEYS).map(normalizeUserRecord);
	}

	function getOrders() {
		return readArrayFromKeys(ORDER_KEYS).map(normalizeOrder);
	}

	function buildCustomerCatalog() {
		const users = getUsers();
		const orders = getOrders();
		const customerMap = new Map();

		function ensureCustomer(seed) {
			const lookupKeys = buildLookupKeys(seed);
			let existing = null;

			for (const key of lookupKeys) {
				if (customerMap.has(key)) {
					existing = customerMap.get(key);
					break;
				}
			}

			if (!existing) {
				existing = {
					id: String(seed?.id || `guest:${lookupKeys[0] || Date.now()}`),
					name: resolveCustomerName(seed),
					email: String(seed?.email || "").trim().toLowerCase(),
					phone: normalizePhone(seed?.phone || ""),
					avatar: String(seed?.avatar || seed?.customerImage || createLetterAvatar(resolveCustomerName(seed))).trim(),
					status: String(seed?.status || "active").toLowerCase() === "blocked" ? "blocked" : "active",
					verified: Boolean(seed?.verified),
					joinedAt: toIsoDate(seed?.joinedAt || seed?.date || Date.now()),
					address: resolveAddress(seed),
					orders: [],
					totalOrders: 0,
					totalSpent: 0,
					lastOrderDate: "",
					productsPurchased: []
				};
			}

			existing.name = resolveCustomerName({ ...existing, ...seed });
			existing.email = String(seed?.email || existing.email || "").trim().toLowerCase();
			existing.phone = normalizePhone(seed?.phone || existing.phone || "");
			existing.avatar = String(seed?.avatar || seed?.customerImage || existing.avatar || createLetterAvatar(existing.name)).trim();
			existing.status = String(seed?.status || existing.status || "active").toLowerCase() === "blocked" ? "blocked" : "active";
			existing.verified = Boolean(seed?.verified ?? existing.verified);
			existing.joinedAt = toIsoDate(seed?.joinedAt || existing.joinedAt || seed?.date || Date.now());
			existing.address = { ...existing.address, ...resolveAddress(seed) };

			buildLookupKeys(existing).forEach((key) => customerMap.set(key, existing));
			return existing;
		}

		users.forEach((user) => {
			ensureCustomer(user);
		});

		orders.forEach((order) => {
			const orderKeys = buildLookupKeys({
				id: order.customerId || undefined,
				email: order.customerEmail,
				phone: order.customerPhone
			});
			const customer = orderKeys.map((key) => customerMap.get(key)).find(Boolean) || null;
			if (!customer) {
				return;
			}

			customer.orders.push(order);
			customer.totalOrders += 1;
			customer.totalSpent += Number(order.total || 0) || 0;
			if (!customer.lastOrderDate || new Date(order.date).getTime() > new Date(customer.lastOrderDate).getTime()) {
				customer.lastOrderDate = order.date;
			}
			customer.address = {
				...customer.address,
				...resolveAddress(order.shippingAddress || {})
			};
			order.products.forEach((product) => {
				customer.productsPurchased.push({
					orderId: order.id,
					orderDate: order.date,
					...product
				});
			});
		});

		return Array.from(new Set(Array.from(customerMap.values())))
			.map((customer) => ({
				...customer,
				orders: customer.orders.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0)),
				productsPurchased: customer.productsPurchased.sort((left, right) => new Date(right.orderDate || 0) - new Date(left.orderDate || 0))
			}))
			.sort((left, right) => new Date(right.joinedAt || 0) - new Date(left.joinedAt || 0));
	}

	function getCustomers() {
		return clone(buildCustomerCatalog());
	}

	function getCustomerById(customerId) {
		const normalizedId = String(customerId || "").trim().toLowerCase();
		if (!normalizedId) {
			return null;
		}

		return getCustomers().find((customer) => {
			return String(customer.id) === String(customerId)
				|| normalizeIdentifier(customer.email) === normalizedId
				|| normalizeIdentifier(customer.phone) === normalizedId;
		}) || null;
	}

	function matchesFilter(customer, filter) {
		if (filter === "active") {
			return customer.status === "active";
		}
		if (filter === "new") {
			const joinedTime = new Date(customer.joinedAt || 0).getTime();
			return joinedTime >= Date.now() - (1000 * 60 * 60 * 24 * 30);
		}
		if (filter === "top") {
			return Number(customer.totalSpent || 0) > 0 || Number(customer.totalOrders || 0) >= 2;
		}
		return true;
	}

	function sortCustomers(customers, sortBy) {
		const list = Array.isArray(customers) ? customers.slice() : [];
		return list.sort((left, right) => {
			if (sortBy === "orders") {
				return Number(right.totalOrders || 0) - Number(left.totalOrders || 0);
			}
			if (sortBy === "spending") {
				return Number(right.totalSpent || 0) - Number(left.totalSpent || 0);
			}
			return new Date(right.joinedAt || 0) - new Date(left.joinedAt || 0);
		});
	}

	function filterCustomers(options) {
		const config = options || {};
		const query = normalizeText(config.query || "");
		const filter = String(config.filter || "all").toLowerCase();
		const sortBy = String(config.sortBy || "date").toLowerCase();

		const filtered = getCustomers().filter((customer) => {
			if (!matchesFilter(customer, filter)) {
				return false;
			}

			if (!query) {
				return true;
			}

			const haystack = [
				customer.name,
				customer.email,
				customer.phone,
				customer.id
			].map(normalizeText).join(" ");

			return haystack.includes(query);
		});

		return sortCustomers(filtered, sortBy);
	}

	function updateStoredUser(customerId, updater) {
		const users = getUsers();
		const normalizedCustomerId = String(customerId || "").trim().toLowerCase();
		const index = users.findIndex((user) => {
			return String(user.id) === String(customerId)
				|| normalizeIdentifier(user.email) === normalizedCustomerId
				|| normalizeIdentifier(user.phone) === normalizedCustomerId;
		});
		if (index === -1) {
			return null;
		}

		const nextUser = normalizeUserRecord(updater(clone(users[index])));
		users.splice(index, 1, nextUser);
		writeUsers(users);

		const currentUser = readCurrentUser();
		if (currentUser && String(currentUser.id) === String(customerId)) {
			writeCurrentUser(nextUser);
		}

		dispatchChange({ action: "update", customerId: nextUser.id });
		return clone(nextUser);
	}

	function updateCustomer(customerId, updates) {
		return updateStoredUser(customerId, (user) => ({
			...user,
			...updates,
			name: resolveCustomerName({ ...user, ...updates }),
			email: String(updates?.email ?? user.email ?? "").trim().toLowerCase(),
			phone: normalizePhone(updates?.phone ?? user.phone ?? ""),
			avatar: String(updates?.avatar || user.avatar || createLetterAvatar(resolveCustomerName({ ...user, ...updates }))).trim(),
			address: {
				...resolveAddress(user),
				...resolveAddress(updates || {})
			}
		}));
	}

	function setCustomerStatus(customerId, status) {
		return updateCustomer(customerId, {
			status: String(status || "active").toLowerCase() === "blocked" ? "blocked" : "active"
		});
	}

	function deleteCustomer(customerId) {
		const users = getUsers();
		const nextUsers = users.filter((user) => String(user.id) !== String(customerId));
		if (nextUsers.length === users.length) {
			return false;
		}

		writeUsers(nextUsers);
		const currentUser = readCurrentUser();
		if (currentUser && String(currentUser.id) === String(customerId)) {
			writeCurrentUser(null);
		}

		dispatchChange({ action: "delete", customerId: String(customerId) });
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
			topCustomer
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
		setCustomerStatus,
		updateCustomer
	};
})(window);// Customers service placeholder.
