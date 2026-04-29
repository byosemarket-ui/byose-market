(function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminOrdersService;

	if (sidebar && typeof sidebar.init === "function") {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	service.init?.().catch((error) => {
		console.warn("Unable to initialize admin orders service.", error);
	});

	const elements = {
		searchInput: document.getElementById("ordersSearchInput"),
		statusFilter: document.getElementById("ordersStatusFilter"),
		sortSelect: document.getElementById("ordersSortSelect"),
		resultsText: document.getElementById("ordersResultsText"),
		tableBody: document.getElementById("ordersTableBody"),
		mobileGrid: document.getElementById("ordersMobileGrid"),
		stats: {
			total: document.getElementById("ordersTotalStat"),
			pending: document.getElementById("ordersPendingStat"),
			delivered: document.getElementById("ordersDeliveredStat"),
			revenue: document.getElementById("ordersRevenueStat")
		}
	};

	const state = {
		query: "",
		status: "all",
		sortBy: "date-desc"
	};

	function getStatusMarkup(order) {
		const tone = service.getStatusTone(order.status);
		return `<span class="order-status-pill order-status-pill--${tone}">${service.escapeHtml(order.status)}</span>`;
	}

	function createStatusSelect(order) {
		return `
			<label class="orders-inline-status">
				<span class="sr-only">Update status for ${service.escapeHtml(order.id)}</span>
				<select data-action="status" data-order-id="${service.escapeHtml(order.id)}">
					${service.STATUS_OPTIONS.map((status) => `<option value="${service.escapeHtml(status)}" ${status === order.status ? "selected" : ""}>${service.escapeHtml(status)}</option>`).join("")}
				</select>
			</label>
		`;
	}

	function createCustomerMarkup(order) {
		if (order.customerLink) {
			return `<a class="orders-inline-link" href="${order.customerLink}">${service.escapeHtml(order.customerName)}</a>`;
		}
		return `<span>${service.escapeHtml(order.customerName)}</span>`;
	}

	function createOrderRow(order) {
		return `
			<tr>
				<td>
					<div class="orders-order-id-cell">
						<strong>${service.escapeHtml(order.id)}</strong>
						<small>${order.itemsCount} item${order.itemsCount === 1 ? "" : "s"}</small>
					</div>
				</td>
				<td>
					<div class="orders-customer-cell">
						${createCustomerMarkup(order)}
						<small>${service.escapeHtml(order.customerEmail || "Guest checkout")}</small>
					</div>
				</td>
				<td>${service.escapeHtml(order.customerPhone || "No phone")}</td>
				<td>${service.formatCurrency(order.total)}</td>
				<td>
					<div class="orders-status-stack">
						${getStatusMarkup(order)}
						${createStatusSelect(order)}
					</div>
				</td>
				<td>${service.formatDate(order.date)}</td>
				<td>
					<div class="orders-actions-inline">
						<a class="orders-table-action" href="details.html?id=${encodeURIComponent(order.id)}">View details</a>
						<button class="orders-table-action orders-table-action--danger" type="button" data-action="delete" data-order-id="${service.escapeHtml(order.id)}">Delete</button>
					</div>
				</td>
			</tr>
		`;
	}

	function createOrderCard(order) {
		return `
			<article class="order-mobile-card">
				<div class="order-mobile-head">
					<div>
						<h3>${service.escapeHtml(order.id)}</h3>
						<small>${service.formatDateTime(order.date)}</small>
					</div>
					${getStatusMarkup(order)}
				</div>
				<div class="order-mobile-meta">
					<div><span>Customer</span><strong>${service.escapeHtml(order.customerName)}</strong></div>
					<div><span>Phone</span><strong>${service.escapeHtml(order.customerPhone || "No phone")}</strong></div>
					<div><span>Total</span><strong>${service.formatCurrency(order.total)}</strong></div>
					<div><span>Items</span><strong>${order.itemsCount}</strong></div>
				</div>
				${createStatusSelect(order)}
				<div class="orders-actions-inline">
					<a class="orders-secondary-link" href="details.html?id=${encodeURIComponent(order.id)}">View details</a>
					<button class="orders-table-action orders-table-action--danger" type="button" data-action="delete" data-order-id="${service.escapeHtml(order.id)}">Delete</button>
				</div>
			</article>
		`;
	}

	function renderStats() {
		const stats = service.getOrderStats();
		elements.stats.total.textContent = String(stats.totalOrders || 0);
		elements.stats.pending.textContent = String(stats.pendingOrders || 0);
		elements.stats.delivered.textContent = String(stats.deliveredOrders || 0);
		elements.stats.revenue.textContent = service.formatCurrency(stats.totalRevenue || 0);
	}

	function renderOrders() {
		const orders = service.filterOrders(state);
		elements.resultsText.textContent = `${orders.length} order${orders.length === 1 ? "" : "s"} found`;

		if (!orders.length) {
			elements.tableBody.innerHTML = '<tr><td colspan="7" class="orders-empty-row">No orders match the current filters.</td></tr>';
			elements.mobileGrid.innerHTML = '<div class="orders-empty-state">No orders match the current filters.</div>';
			return;
		}

		elements.tableBody.innerHTML = orders.map(createOrderRow).join("");
		elements.mobileGrid.innerHTML = orders.map(createOrderCard).join("");
	}

	function rerender() {
		renderStats();
		renderOrders();
	}

	async function handleDelete(orderId) {
		const order = service.getOrderById(orderId);
		if (!order) {
			rerender();
			return;
		}

		const confirmed = window.confirm(`Delete ${order.id}? This permanently removes the order from the admin order store.`);
		if (!confirmed) {
			return;
		}

		await service.deleteOrder(orderId);
		rerender();
	}

	async function handleClick(event) {
		const button = event.target.closest("[data-action='delete'][data-order-id]");
		if (!button) {
			return;
		}

		await handleDelete(button.dataset.orderId || "");
	}

	async function handleChange(event) {
		const select = event.target.closest("select[data-action='status'][data-order-id]");
		if (!select) {
			return;
		}

		await service.updateOrderStatus(select.dataset.orderId || "", select.value || "Pending");
		rerender();
	}

	elements.searchInput?.addEventListener("input", () => {
		state.query = String(elements.searchInput.value || "");
		renderOrders();
	});

	elements.statusFilter?.addEventListener("change", () => {
		state.status = String(elements.statusFilter.value || "all");
		renderOrders();
	});

	elements.sortSelect?.addEventListener("change", () => {
		state.sortBy = String(elements.sortSelect.value || "date-desc");
		renderOrders();
	});

	elements.tableBody?.addEventListener("click", handleClick);
		elements.mobileGrid?.addEventListener("click", handleClick);
		elements.tableBody?.addEventListener("change", handleChange);
		elements.mobileGrid?.addEventListener("change", handleChange);

	window.addEventListener("storage", rerender);
	window.addEventListener(service.EVENT_NAME, rerender);
	window.addEventListener("byose:orders-changed", rerender);

	rerender();
})();
