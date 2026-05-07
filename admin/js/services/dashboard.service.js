
(function () {
	const STORAGE_KEYS = {
		visits: 'byose_market_visitors_v1',
		messages: ['byose_market_messages', 'byose_messages']
	};
	const cache = {
		snapshot: null,
		source: 'local',
		lastSyncedAt: 0,
		error: '',
		refreshPromise: null
	};
	let remoteVisits = [];

	function safeParse(value, fallback) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallback;
		}
	}

	function readStorageArray(keys) {
		const list = Array.isArray(keys) ? keys : [keys];
		const merged = [];
		const seen = new Set();

		for (const key of list) {
			const raw = window.localStorage.getItem(key);
			if (!raw) {
				continue;
			}

			const parsed = safeParse(raw, []);
			if (!Array.isArray(parsed)) {
				continue;
			}

			parsed.forEach((entry, index) => {
				const identifier = String(
					entry?.orderId
					|| entry?.id
					|| entry?.email
					|| entry?.phone
					|| entry?.timestamp
					|| `${key}-${index}`
				).trim().toLowerCase();

				if (seen.has(identifier)) {
					return;
				}

				seen.add(identifier);
				merged.push(entry);
			});
		}

		return merged;
	}

	function readProducts() {
		const catalogService = window.ByoseProductCatalog;
		return catalogService && typeof catalogService.getStorefrontCatalog === 'function'
			? catalogService.getStorefrontCatalog()
			: Array.isArray(window.products)
				? window.products
				: [];
	}

	function normalizeTimestamp(value) {
		if (!value) {
			return null;
		}

		const parsed = new Date(value).getTime();
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}

		const numberValue = Number(value);
		return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
	}

	function readUsers() {
		return window.AdminCustomersService && typeof window.AdminCustomersService.getUsers === 'function'
			? window.AdminCustomersService.getUsers()
			: [];
	}

	function readCentralMessages() {
		return window.AdminMessagesService && typeof window.AdminMessagesService.getMessages === 'function'
			? window.AdminMessagesService.getMessages()
			: [];
	}

	function readVisits() {
		if (Array.isArray(remoteVisits) && remoteVisits.length) {
			return remoteVisits
				.filter((visit) => visit && (visit.startedAt || visit.createdAt || visit.timestamp))
				.sort((left, right) => Number(normalizeTimestamp(right.startedAt || right.createdAt || right.timestamp) || 0) - Number(normalizeTimestamp(left.startedAt || left.createdAt || left.timestamp) || 0));
		}

		return readStorageArray(STORAGE_KEYS.visits)
			.filter((visit) => visit && visit.timestamp)
			.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
	}

	function getActivityEndpoint() {
		const apiClient = window.AdminApiClient;
		if (!apiClient || typeof apiClient.getBaseUrl !== 'function') {
			return '';
		}

		return `${apiClient.getBaseUrl()}/admin/activity?eventType=visit&limit=100`;
	}

	async function refreshVisits() {
		const endpoint = getActivityEndpoint();
		if (!endpoint) {
			return [];
		}

		try {
			const response = await window.AdminApiClient.request(endpoint, { method: 'GET' });
			remoteVisits = Array.isArray(response?.activity) ? response.activity : [];
			return remoteVisits;
		} catch (error) {
			console.warn('Unable to load centralized site activity.', error);
			remoteVisits = [];
			return [];
		}
	}

	function normalizeMessage(message, index) {
		const createdAt = normalizeTimestamp(message && (message.createdAt || message.timestamp || message.date));
		const name = String(message && message.name ? message.name : `Contact ${index + 1}`).trim();
		const email = String(message && message.email ? message.email : '').trim();
		const phone = String(message && message.phone ? message.phone : '').trim();
		const content = String(message && message.message ? message.message : '').trim();

		return {
			id: String(message && message.id ? message.id : `message-${index}`),
			name,
			email,
			phone,
			message: content,
			createdAt,
			status: String(message && message.status ? message.status : 'new').trim() || 'new'
		};
	}

	function readMessages() {
		const centralized = readCentralMessages();
		if (centralized.length) {
			return centralized;
		}

		return readStorageArray(STORAGE_KEYS.messages)
			.map(normalizeMessage)
			.filter((message) => message && message.id)
			.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
	}

	function readOrders() {
		return window.AdminOrdersService && typeof window.AdminOrdersService.getOrders === 'function'
			? window.AdminOrdersService.getOrders().map((order) => ({
				id: order.id,
				status: order.status,
				total: Number(order.total || 0),
				createdAt: order.date,
				customer: order.customerName,
				itemsCount: order.itemsCount,
				items: order.products || []
			}))
			: [];
	}

	function getEndpoint() {
		const base = String(window.AdminConfig?.adminApiBaseUrl || '/api/admin').replace(/\/$/, '');
		return `${base}/dashboard`;
	}

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function mapOrderStatus(status) {
		const normalized = String(status || '').toLowerCase();
		if (normalized.includes('return')) {
			return { label: 'Returned', tone: 'cancelled' };
		}
		if (normalized.includes('cancel')) {
			return { label: 'Cancelled', tone: 'cancelled' };
		}
		if (normalized.includes('deliver') || normalized.includes('complete')) {
			return { label: 'Delivered', tone: 'completed' };
		}
		if (normalized.includes('ship')) {
			return { label: 'Shipping', tone: 'shipped' };
		}
		if (normalized.includes('confirm') || normalized.includes('process') || normalized.includes('payment')) {
			return { label: 'Confirmed', tone: 'processing' };
		}
		return { label: 'Pending', tone: 'review' };
	}

	function mapMessageStatus(status) {
		const normalized = String(status || '').toLowerCase();
		if (normalized.includes('resolved') || normalized.includes('closed')) {
			return { label: 'Resolved', tone: 'completed' };
		}
		if (normalized.includes('read')) {
			return { label: 'Reviewed', tone: 'shipped' };
		}
		return { label: 'New', tone: 'processing' };
	}

	function getRelativeTimeLabel(timestamp) {
		const value = Number(timestamp || 0);
		if (!value) {
			return 'No timestamp';
		}

		const elapsed = Date.now() - value;
		const minute = 60 * 1000;
		const hour = 60 * minute;
		const day = 24 * hour;

		if (elapsed < hour) {
			const minutes = Math.max(1, Math.round(elapsed / minute));
			return `${minutes} min ago`;
		}

		if (elapsed < day) {
			const hours = Math.max(1, Math.round(elapsed / hour));
			return `${hours} hr ago`;
		}

		const days = Math.max(1, Math.round(elapsed / day));
		return `${days} day${days === 1 ? '' : 's'} ago`;
	}

	function getRecentActivity(orders, visits, users, messages) {
		const orderActivity = orders.slice(0, 6).map((order) => {
			const status = mapOrderStatus(order.status);
			return {
				type: 'Order',
				reference: order.id,
				statusLabel: status.label,
				statusTone: status.tone,
				details: `${order.customer} • ${formatCurrency(order.total)} • ${getRelativeTimeLabel(order.createdAt)}`,
				date: order.createdAt
			};
		});

		const messageActivity = messages.slice(0, 4).map((message) => {
			const status = mapMessageStatus(message.status);
			const descriptor = message.email || message.phone || 'No contact info';
			return {
				type: 'Message',
				reference: message.name,
				statusLabel: status.label,
				statusTone: status.tone,
				details: `${descriptor} • ${truncateText(message.message, 54)} • ${getRelativeTimeLabel(message.createdAt)}`,
				date: message.createdAt
			};
		});

		const userActivity = users.slice(0, 3).map((user) => ({
			type: 'Customer',
			reference: user.id,
			statusLabel: 'Registered',
			statusTone: 'completed',
			details: `${user.name} • ${getRelativeTimeLabel(user.createdAt)}`,
			date: user.createdAt
		}));

		const visitActivity = visits.slice(0, 4).map((visit) => ({
			type: 'Visit',
			reference: visit.path || 'Site visit',
			statusLabel: 'Tracked',
			statusTone: 'shipped',
			details: `${String(visit.device || 'device').replace(/^./, (match) => match.toUpperCase())}${visit.city ? ` • ${visit.city}` : ''} • ${getRelativeTimeLabel(normalizeTimestamp(visit.timestamp))}`,
			date: normalizeTimestamp(visit.timestamp)
		}));

		return orderActivity
			.concat(messageActivity)
			.concat(userActivity)
			.concat(visitActivity)
			.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0))
			.slice(0, 6);
	}

	function truncateText(value, limit) {
		const text = String(value || '').trim();
		if (text.length <= limit) {
			return text || 'No message preview';
		}

		return `${text.slice(0, limit - 1).trim()}...`;
	}

	function formatCurrency(value) {
		return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
	}

	function countRecentUsers(users, now) {
		const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
		return users.filter((user) => Number(new Date(user.createdAt || user.joinedAt || 0).getTime()) >= weekAgo).length;
	}

	async function init() {
		await Promise.all([
			window.AdminCustomersService?.init?.() || Promise.resolve(),
			window.AdminOrdersService?.init?.() || Promise.resolve(),
			window.AdminMessagesService?.init?.() || Promise.resolve(),
			window.ByoseProductCatalog?.refreshCatalog?.({ silent: true, allowBootstrap: false }) || Promise.resolve(),
			refreshVisits()
		]);

		return refresh({ silent: true });
	}

	function buildSummary(products, orders, users, visits, messages) {
		const pendingOrders = orders.filter((order) => mapOrderStatus(order.status).label === 'Pending').length;
		const newMessages = messages.filter((message) => mapMessageStatus(message.status).label === 'New').length;
		const recentOrders = orders.filter((order) => {
			const createdAt = Number(order.createdAt || 0);
			const now = Date.now();
			return createdAt && createdAt >= now - (24 * 60 * 60 * 1000);
		}).length;

		return [
			{
				label: 'Catalog coverage',
				value: products.length ? `${products.length} live products in the shop catalog` : 'No catalog products detected'
			},
			{
				label: 'Order queue',
				value: orders.length ? `${pendingOrders} pending from ${orders.length} total orders` : 'No saved orders in checkout history'
			},
			{
				label: 'Customer base',
				value: users.length ? `${users.length} registered users • ${countRecentUsers(users, Date.now())} joined this week` : 'No registered customers found'
			},
			{
				label: 'Support inbox',
				value: messages.length ? `${newMessages} new from ${messages.length} saved contact submissions` : 'No stored contact submissions yet'
			},
			{
				label: 'Site activity',
				value: visits.length ? `${visits.length} tracked visits • ${recentOrders} orders created today` : 'No tracked visits recorded yet'
			}
		];
	}

	function buildLocalSnapshot() {
		const products = readProducts();
		const orders = readOrders();
		const users = readUsers();
		const visits = readVisits();
		const messages = readMessages();
		const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
		const pendingOrders = orders.filter((order) => mapOrderStatus(order.status).label === 'Pending').length;
		const recentUsers = countRecentUsers(users, Date.now());
		const newMessages = messages.filter((message) => mapMessageStatus(message.status).label === 'New').length;

		return {
			stats: {
				totalSales,
				ordersCount: orders.length,
				ordersNote: orders.length ? `${pendingOrders} pending orders in checkout history` : 'No saved orders yet',
				customersCount: users.length,
				customersNote: users.length ? `${recentUsers} new customers in the last 7 days` : 'No registered customers yet',
				productsCount: products.length,
				productsNote: products.length ? 'Catalog count synced from the live product system' : 'No live products found',
				salesNote: orders.length ? `${formatCurrency(totalSales)} across ${orders.length} saved orders` : 'No recorded order totals yet',
				messagesCount: messages.length,
				messagesNote: messages.length ? `${newMessages} new support messages recorded` : 'No stored support messages yet'
			},
			activity: getRecentActivity(orders, visits, users, messages),
			summary: buildSummary(products, orders, users, visits, messages),
			raw: {
				products,
				orders,
				users,
				visits,
				messages
			}
		};
	}

	async function refresh(options) {
		if (cache.refreshPromise && !options?.force) {
			return cache.refreshPromise;
		}

		cache.refreshPromise = (async () => {
			try {
				if (window.AdminApiClient && typeof window.AdminApiClient.get === 'function') {
					const payload = await window.AdminApiClient.get(getEndpoint());
					if (payload?.snapshot) {
						cache.snapshot = payload.snapshot;
						cache.source = 'api';
						cache.lastSyncedAt = Date.now();
						cache.error = '';
						return clone(cache.snapshot);
					}
				}
			} catch (error) {
				cache.error = error?.message || 'Unable to sync admin dashboard analytics from the API.';
				window.ByoseDiagnostics?.logSyncIssue?.('admin.dashboard.refresh', {
					message: cache.error,
					source: 'api'
				});
				console.warn('Admin dashboard API refresh failed. Falling back to local admin services.', error);
			}

			cache.snapshot = buildLocalSnapshot();
			cache.source = 'local';
			cache.lastSyncedAt = Date.now();
			return clone(cache.snapshot);
		})().finally(() => {
			cache.refreshPromise = null;
		});

		return cache.refreshPromise;
	}

	function createSnapshot() {
		if (cache.snapshot) {
			return clone(cache.snapshot);
		}

		cache.snapshot = buildLocalSnapshot();
		cache.source = 'local';
		return clone(cache.snapshot);
	}

	function getSyncState() {
		return {
			source: cache.source,
			lastSyncedAt: cache.lastSyncedAt,
			error: cache.error
		};
	}

	window.AdminDashboardService = {
		createSnapshot,
		formatCurrency,
		getSyncState,
		init,
		mapOrderStatus,
		mapMessageStatus,
		refresh
	};
})();
