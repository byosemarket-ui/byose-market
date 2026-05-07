
(function (global) {
	"use strict";

	const STORAGE_KEYS = ["byose_market_messages", "byose_messages"];
	const EVENT_NAME = "byose:messages-changed";
	const STATUS_OPTIONS = ["New", "Reviewed", "Resolved"];
	const POLL_INTERVAL_MS = 15000;
	const cache = {
		messages: [],
		hydrated: false,
		refreshPromise: null,
		lastSyncedAt: 0,
		source: 'local',
		error: '',
		pollTimerId: 0
	};

	function safeParse(value, fallbackValue) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallbackValue;
		}
	}

	function getEndpoint(messageId) {
		const base = String(global.AdminConfig?.adminApiBaseUrl || '/api/admin').replace(/\/$/, '');
		return messageId ? `${base}/messages/${encodeURIComponent(String(messageId || '').trim())}` : `${base}/messages`;
	}

	function canUseApi() {
		return Boolean(global.AdminApiClient && typeof global.AdminApiClient.get === 'function');
	}

	function readLocalMessages() {
		const seen = new Set();
		const messages = [];

		STORAGE_KEYS.forEach((key) => {
			const raw = global.localStorage.getItem(key);
			if (!raw) {
				return;
			}

			safeParse(raw, []).forEach((message, index) => {
				const identifier = String(message?.id || message?.messageId || `${message?.email || 'message'}-${message?.createdAt || index}`).trim();
				if (!identifier || seen.has(identifier)) {
					return;
				}

				seen.add(identifier);
				messages.push(normalizeMessage(message, identifier));
			});
		});

		return messages.sort((left, right) => Number(right.createdAtValue || 0) - Number(left.createdAtValue || 0));
	}

	function writeLocalMessages(messages) {
		const serialized = JSON.stringify(Array.isArray(messages) ? messages : []);
		STORAGE_KEYS.forEach((key) => global.localStorage.setItem(key, serialized));
	}

	function dispatchChange(detail) {
		global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: detail || {} }));
		global.dispatchEvent(new CustomEvent("byose:admin-data-changed", { detail: { module: "messages", ...(detail || {}) } }));
	}

	function normalizeStatus(value) {
		const status = String(value || "new").trim().toLowerCase();
		if (status.includes("resolve") || status.includes("close")) {
			return "Resolved";
		}
		if (status.includes("read") || status.includes("review")) {
			return "Reviewed";
		}
		return "New";
	}

	function getStatusTone(value) {
		const status = normalizeStatus(value).toLowerCase();
		if (status === "resolved") {
			return "resolved";
		}
		if (status === "reviewed") {
			return "reviewed";
		}
		return "new";
	}

	function normalizeMessage(message, fallbackId) {
		const createdAtValue = normalizeTimestamp(message?.createdAt || message?.timestamp || message?.date);
		const status = normalizeStatus(message?.status);
		return {
			id: String(message?.id || message?.messageId || fallbackId || `message-${Date.now()}`),
			name: String(message?.name || "Unknown sender").trim() || "Unknown sender",
			email: String(message?.email || "").trim().toLowerCase(),
			phone: String(message?.phone || "").trim(),
			message: String(message?.message || "").trim(),
			source: String(message?.source || "contact-form").trim() || "contact-form",
			status,
			createdAt: toIsoString(createdAtValue),
			createdAtValue,
			contactLabel: String(message?.email || message?.phone || "No contact info").trim() || "No contact info"
		};
	}

	function setCache(messages, source) {
		cache.messages = Array.isArray(messages) ? messages.map((message) => normalizeMessage(message, message?.id)) : [];
		cache.hydrated = true;
		cache.lastSyncedAt = Date.now();
		cache.source = source || cache.source || 'local';
		return cache.messages.slice();
	}

	async function refresh(options) {
		if (cache.refreshPromise && !options?.force) {
			return cache.refreshPromise;
		}

		cache.refreshPromise = (async () => {
			if (canUseApi()) {
				try {
					const payload = await global.AdminApiClient.get(getEndpoint());
					const messages = Array.isArray(payload?.messages) ? payload.messages.map((message) => normalizeMessage(message, message?.id)) : [];
					writeLocalMessages(messages);
					cache.error = '';
					const next = setCache(messages, 'api');
					if (!options?.silent) {
						dispatchChange({ action: 'refresh', source: 'api', count: next.length });
					}
					return next;
				} catch (error) {
					cache.error = error?.message || 'Unable to sync admin messages from the API.';
					console.warn('Admin messages API refresh failed. Falling back to local message cache.', error);
				}
			}

			const localMessages = readLocalMessages();
			const next = setCache(localMessages, 'local');
			if (!options?.silent) {
				dispatchChange({ action: 'refresh', source: 'local', count: next.length, error: cache.error });
			}
			return next;
		})().finally(() => {
			cache.refreshPromise = null;
		});

		return cache.refreshPromise;
	}

	function init() {
		if (!cache.pollTimerId) {
			cache.pollTimerId = global.setInterval(() => {
				if (global.document?.hidden) {
					return;
				}
				refresh({ silent: true }).catch(() => {});
			}, POLL_INTERVAL_MS);

			global.addEventListener('focus', () => {
				refresh({ silent: true, force: true }).catch(() => {});
			});
		}

		if (!cache.hydrated) {
			cache.messages = readLocalMessages();
		}

		return refresh({ silent: true });
	}

	function normalizeTimestamp(value) {
		const date = new Date(value || Date.now());
		return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
	}

	function toIsoString(value) {
		const date = new Date(value || Date.now());
		return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
	}

	function formatDate(value) {
		const date = new Date(value || Date.now());
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
		const date = new Date(value || Date.now());
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

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function truncate(value, limit) {
		const text = String(value || "").trim();
		if (text.length <= limit) {
			return text || "No message preview";
		}

		return `${text.slice(0, limit - 1).trim()}...`;
	}

	function getMessagesByFilter(filters) {
		const state = filters || {};
		const query = String(state.query || "").trim().toLowerCase();
		const status = String(state.status || "all").trim().toLowerCase();
		return getMessages().filter((message) => {
			if (status !== "all" && normalizeStatus(message.status).toLowerCase() !== status) {
				return false;
			}

			if (!query) {
				return true;
			}

			const haystack = [message.id, message.name, message.email, message.phone, message.message, message.source]
				.join(" ")
				.toLowerCase();
			return haystack.includes(query);
		});
	}

	function getMessageById(messageId) {
		return getMessages().find((message) => message.id === String(messageId || "")) || null;
	}

	async function updateMessageStatus(messageId, nextStatus) {
		const id = String(messageId || '');
		if (canUseApi()) {
			const payload = await global.AdminApiClient.put(getEndpoint(id), { status: normalizeStatus(nextStatus) });
			const updated = normalizeMessage(payload?.message || { id, status: nextStatus }, id);
			const messages = getMessages().filter((message) => message.id !== id);
			messages.unshift(updated);
			writeLocalMessages(messages);
			setCache(messages, 'api');
			cache.error = '';
			dispatchChange({ action: 'update', messageId: id, source: 'api' });
			return updated;
		}

		const messages = getMessages().map((message) => message.id === id ? { ...message, status: normalizeStatus(nextStatus) } : message);
		writeLocalMessages(messages);
		setCache(messages, 'local');
		dispatchChange({ action: 'update', messageId: id, source: 'local' });
		return getMessageById(id);
	}

	async function deleteMessage(messageId) {
		const id = String(messageId || '');
		if (canUseApi()) {
			await global.AdminApiClient.delete(getEndpoint(id));
		}

		const next = getMessages().filter((message) => message.id !== id);
		writeLocalMessages(next);
		setCache(next, canUseApi() ? 'api' : 'local');
		dispatchChange({ action: 'delete', messageId: id, source: canUseApi() ? 'api' : 'local' });
	}

	function getMessages() {
		if (!cache.hydrated) {
			cache.messages = readLocalMessages();
			cache.hydrated = true;
		}

		return cache.messages.slice();
	}

	function getMessageStats() {
		const messages = getMessages();
		const reviewed = messages.filter((message) => normalizeStatus(message.status) === "Reviewed").length;
		const resolved = messages.filter((message) => normalizeStatus(message.status) === "Resolved").length;
		const latest = messages[0] || null;
		return {
			total: messages.length,
			newCount: messages.length - reviewed - resolved,
			reviewed,
			resolved,
			latestLabel: latest ? `${latest.name} • ${formatDate(latest.createdAt)}` : "No messages yet"
		};
	}

	global.AdminMessagesService = {
		EVENT_NAME,
		STATUS_OPTIONS,
		init,
		refresh,
		escapeHtml,
		formatDate,
		formatDateTime,
		truncate,
		getStatusTone,
		normalizeStatus,
		getMessages,
		filterMessages: getMessagesByFilter,
		getMessageById,
		updateMessageStatus,
		deleteMessage,
		getMessageStats
	};
})(window);
