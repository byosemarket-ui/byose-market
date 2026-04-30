(function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminCustomersService;

	if (sidebar && typeof sidebar.init === "function") {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	service.init?.().then(rerender).catch((error) => {
		console.warn("Unable to initialize admin customers service.", error);
	});

	const searchInput = document.getElementById("customersSearchInput");
	const filterSelect = document.getElementById("customersFilterSelect");
	const sortSelect = document.getElementById("customersSortSelect");
	const tableBody = document.getElementById("customersTableBody");
	const mobileGrid = document.getElementById("customersMobileGrid");
	const resultsText = document.getElementById("customersResultsText");

	const state = {
		query: "",
		filter: "all",
		sortBy: "date"
	};

	function renderStats() {
		const stats = service.getCustomerStats();
		document.getElementById("customersTotalStat").textContent = String(stats.totalCustomers || 0);
		document.getElementById("customersActiveStat").textContent = String(stats.activeCustomers || 0);
		document.getElementById("customersBlockedStat").textContent = String(stats.blockedCustomers || 0);
		document.getElementById("customersSpendStat").textContent = service.formatCurrency(stats.totalSpent || 0);
		document.getElementById("customersTotalNote").textContent = stats.totalCustomers ? "Real users and customer snapshots are connected." : "No customer records yet.";
		document.getElementById("customersActiveNote").textContent = stats.activeCustomers ? `${stats.activeCustomers} accounts can access the website.` : "No active accounts yet.";
		document.getElementById("customersBlockedNote").textContent = stats.blockedCustomers ? `${stats.blockedCustomers} accounts are currently blocked.` : "No blocked accounts.";
		document.getElementById("customersTopNote").textContent = stats.topCustomer ? `${stats.topCustomer.name} is the highest-value customer.` : "No top customer yet.";
	}

	function getStatusMarkup(customer) {
		const statusClass = customer.status === "blocked" ? "customer-status-pill--blocked" : "customer-status-pill--active";
		const verifiedClass = customer.verified ? "customer-verified-pill--yes" : "customer-verified-pill--no";
		return `
			<div class="customer-status-stack">
				<span class="customer-status-pill ${statusClass}">${service.escapeHtml(customer.status)}</span>
				<span class="customer-verified-pill ${verifiedClass}">${customer.verified ? "Verified" : "Not verified"}</span>
			</div>
		`;
	}

	function createCustomerRow(customer) {
		const email = customer.email || "No email";
		const phone = customer.phone || "No phone";
		return `
			<tr>
				<td>
					<div class="customer-cell">
						<img class="customer-avatar" src="${service.escapeHtml(customer.avatar)}" alt="${service.escapeHtml(customer.name)}">
						<div>
							<strong>${service.escapeHtml(customer.name)}</strong>
							<small>ID ${service.escapeHtml(customer.id)}</small>
						</div>
					</div>
				</td>
				<td><span class="customer-detail-text">${service.escapeHtml(email)}</span></td>
				<td><span class="customer-detail-text">${service.escapeHtml(phone)}</span></td>
				<td>${getStatusMarkup(customer)}</td>
				<td>${service.formatDate(customer.joinedAt)}</td>
				<td>
					<div class="customer-actions-inline">
						<a class="customers-table-action" href="profile.html?id=${encodeURIComponent(customer.id)}">View</a>
						<a class="customers-table-action" href="profile.html?id=${encodeURIComponent(customer.id)}&edit=1">Edit</a>
						<button class="customers-table-action" type="button" data-action="toggle-status" data-customer-id="${service.escapeHtml(customer.id)}">${customer.status === "blocked" ? "Unblock" : "Block"}</button>
						<button class="customers-table-action customers-table-action--danger" type="button" data-action="delete" data-customer-id="${service.escapeHtml(customer.id)}">Delete</button>
					</div>
				</td>
			</tr>
		`;
	}

	function createCustomerCard(customer) {
		const email = customer.email || "No email";
		const phone = customer.phone || "No phone";
		return `
			<article class="customer-mobile-card">
				<div class="customer-mobile-head">
					<img class="customer-avatar" src="${service.escapeHtml(customer.avatar)}" alt="${service.escapeHtml(customer.name)}">
					<div>
						<h3>${service.escapeHtml(customer.name)}</h3>
						<small>ID ${service.escapeHtml(customer.id)}</small>
					</div>
				</div>
				<div class="customer-mobile-meta">
					<div><span>Email</span><strong>${service.escapeHtml(email)}</strong></div>
					<div><span>Phone</span><strong>${service.escapeHtml(phone)}</strong></div>
					<div><span>Orders</span><strong>${customer.totalOrders}</strong></div>
					<div><span>Joined</span><strong>${service.formatDate(customer.joinedAt)}</strong></div>
				</div>
				<div class="customer-mobile-spend"><span>Total spent</span><strong>${service.formatCurrency(customer.totalSpent)}</strong></div>
				<div>${getStatusMarkup(customer)}</div>
				<div class="customer-action-row">
					<a class="customers-secondary-link" href="profile.html?id=${encodeURIComponent(customer.id)}">View profile</a>
					<a class="customers-secondary-link" href="profile.html?id=${encodeURIComponent(customer.id)}&edit=1">Edit</a>
					<button class="customers-secondary-link" type="button" data-action="toggle-status" data-customer-id="${service.escapeHtml(customer.id)}">${customer.status === "blocked" ? "Unblock" : "Block"}</button>
					<button class="customers-danger-button" type="button" data-action="delete" data-customer-id="${service.escapeHtml(customer.id)}">Delete</button>
				</div>
			</article>
		`;
	}

	function renderCustomers() {
		const customers = service.filterCustomers(state);
		resultsText.textContent = `${customers.length} customer${customers.length === 1 ? "" : "s"} found`;

		if (!customers.length) {
			tableBody.innerHTML = '<tr><td colspan="6" class="customers-empty-row">No customers match the current filters.</td></tr>';
			mobileGrid.innerHTML = '<div class="customer-empty-state">No customers match the current filters.</div>';
			return;
		}

		tableBody.innerHTML = customers.map(createCustomerRow).join("");
		mobileGrid.innerHTML = customers.map(createCustomerCard).join("");
	}

	function rerender() {
		renderStats();
		renderCustomers();
	}

	async function handleAction(event) {
		const button = event.target.closest("[data-action][data-customer-id]");
		if (!button) {
			return;
		}

		const customerId = button.dataset.customerId;
		const action = button.dataset.action;
		const customer = service.getCustomerById(customerId);
		if (!customer) {
			rerender();
			return;
		}

		if (action === "toggle-status") {
			await service.setCustomerStatus(customerId, customer.status === "blocked" ? "active" : "blocked");
			rerender();
			return;
		}

		if (action === "delete") {
			const confirmed = window.confirm(`Delete ${customer.name}? This removes the account from the website users list.`);
			if (!confirmed) {
				return;
			}

			await service.deleteCustomer(customerId);
			rerender();
		}
	}

	searchInput?.addEventListener("input", () => {
		state.query = String(searchInput.value || "");
		renderCustomers();
	});

	filterSelect?.addEventListener("change", () => {
		state.filter = String(filterSelect.value || "all");
		renderCustomers();
	});

	sortSelect?.addEventListener("change", () => {
		state.sortBy = String(sortSelect.value || "date");
		renderCustomers();
	});

	tableBody?.addEventListener("click", handleAction);
	mobileGrid?.addEventListener("click", handleAction);

	window.addEventListener("storage", rerender);
	window.addEventListener(service.EVENT_NAME, rerender);
	window.addEventListener("byose:orders-changed", rerender);

	rerender();
})();// Customers list page placeholder.
