(function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminCustomersService;

	if (sidebar && typeof sidebar.init === "function") {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	const params = new URLSearchParams(window.location.search);
	const customerId = params.get("id") || "";
	const initialEditMode = params.get("edit") === "1";

	const hero = document.getElementById("customerProfileHero");
	const grid = document.getElementById("customerProfileGrid");
	const form = document.getElementById("customerProfileForm");
	const profileStatus = document.getElementById("customerProfileStatus");
	const editButton = document.getElementById("editCustomerButton");
	const cancelButton = document.getElementById("cancelEditCustomerButton");
	const toggleStatusButton = document.getElementById("toggleCustomerStatusButton");
	const deleteButton = document.getElementById("deleteCustomerButton");
	const ordersList = document.getElementById("customerOrdersList");

	const formFields = {
		name: document.getElementById("customerNameInput"),
		email: document.getElementById("customerEmailInput"),
		phone: document.getElementById("customerPhoneInput"),
		avatar: document.getElementById("customerAvatarInput"),
		line1: document.getElementById("customerAddressLineInput"),
		city: document.getElementById("customerCityInput"),
		district: document.getElementById("customerDistrictInput"),
		sector: document.getElementById("customerSectorInput"),
		cell: document.getElementById("customerCellInput"),
		village: document.getElementById("customerVillageInput"),
		status: document.getElementById("customerStatusInput"),
		verified: document.getElementById("customerVerifiedInput")
	};

	const state = {
		customer: null,
		editMode: initialEditMode
	};

	function renderNotFound() {
		hero.innerHTML = `
			<p class="dashboard-eyebrow">Customer Profile</p>
			<h2>Customer not found</h2>
			<p>The requested customer record could not be found in the real website data.</p>
			<div class="customer-action-row">
				<a class="customers-secondary-link" href="index.html">Back to customer list</a>
			</div>
		`;
		grid.hidden = true;
	}

	function setEditMode(editMode) {
		state.editMode = Boolean(editMode);
		form.classList.toggle("is-readonly", !state.editMode);
		Object.values(formFields).forEach((field) => {
			if (!field) {
				return;
			}
			field.disabled = !state.editMode;
		});
		cancelButton.hidden = !state.editMode;
		profileStatus.textContent = state.editMode ? "Edit mode enabled. Save changes when you are done." : "Profile is up to date.";
		editButton.textContent = state.editMode ? "Editing profile" : "Edit customer";
	}

	function populateForm(customer) {
		formFields.name.value = customer.name || "";
		formFields.email.value = customer.email || "";
		formFields.phone.value = customer.phone || "";
		formFields.avatar.value = customer.avatar || "";
		formFields.line1.value = customer.address?.line1 || "";
		formFields.city.value = customer.address?.city || "";
		formFields.district.value = customer.address?.district || "";
		formFields.sector.value = customer.address?.sector || "";
		formFields.cell.value = customer.address?.cell || "";
		formFields.village.value = customer.address?.village || "";
		formFields.status.value = customer.status || "active";
		formFields.verified.value = customer.verified ? "true" : "false";
	}

	function renderOrders(customer) {
		if (!customer.orders.length) {
			ordersList.innerHTML = '<div class="customer-empty-state">This customer has not placed any orders yet.</div>';
			return;
		}

		ordersList.innerHTML = customer.orders.map((order) => `
			<article class="customer-order-card">
				<div class="customer-order-topline">
					<div>
						<h3>${service.escapeHtml(order.id)}</h3>
						<small>${service.formatDateTime(order.date)}</small>
					</div>
					<span class="customer-status-pill ${String(order.status || '').toLowerCase().includes('pending') ? 'customer-status-pill--blocked' : 'customer-status-pill--active'}">${service.escapeHtml(order.status)}</span>
				</div>
				<div class="customer-order-summary">
					<strong>${service.formatCurrency(order.total)}</strong>
					<small>${order.products.length} product${order.products.length === 1 ? '' : 's'}</small>
				</div>
				<div class="customer-order-products">
					${order.products.map((product) => `
						<div class="customer-product-line">
							<strong>${service.escapeHtml(product.name)}</strong>
							<small>Qty ${product.qty} • ${service.formatCurrency(product.price)}</small>
							${Object.keys(product.attributes || {}).length ? `
								<div class="customer-product-tags">
									${Object.entries(product.attributes || {}).map(([key, value]) => `<span class="customer-product-tag">${service.escapeHtml(key)}: ${service.escapeHtml(value)}</span>`).join('')}
								</div>
							` : ''}
						</div>
					`).join('')}
				</div>
			</article>
		`).join("");
	}

	function renderCustomer(customer) {
		state.customer = customer;
		document.title = `${customer.name} | Customer Profile | Byose Market Admin`;
		hero.innerHTML = `
			<p class="dashboard-eyebrow">Customer Profile</p>
			<h2>${service.escapeHtml(customer.name)}</h2>
			<p>${service.escapeHtml(customer.email || customer.phone || 'No contact available')} • ${customer.totalOrders} order${customer.totalOrders === 1 ? '' : 's'} • ${service.formatCurrency(customer.totalSpent)}</p>
		`;
		grid.hidden = false;
		document.getElementById("customerAvatar").src = customer.avatar;
		document.getElementById("customerNameHeading").textContent = customer.name;
		document.getElementById("customerContactText").textContent = customer.email || customer.phone || "No contact available";
		document.getElementById("customerIdLabel").textContent = customer.id || "-";
		document.getElementById("customerEmailLabel").textContent = customer.email || "No email";
		document.getElementById("customerPhoneLabel").textContent = customer.phone || "No phone";
		document.getElementById("customerLastOrderLabel").textContent = customer.lastOrderDate ? service.formatDateTime(customer.lastOrderDate) : "No orders yet";
		document.getElementById("customerStatusLabel").textContent = customer.status === "blocked" ? "Blocked" : "Active";
		document.getElementById("customerVerifiedLabel").textContent = customer.verified ? "Verified" : "Not verified";
		document.getElementById("customerJoinedLabel").textContent = service.formatDate(customer.joinedAt);
		document.getElementById("customerOrdersStat").textContent = String(customer.totalOrders || 0);
		document.getElementById("customerSpentStat").textContent = service.formatCurrency(customer.totalSpent || 0);
		document.getElementById("customerLastOrderStat").textContent = customer.lastOrderDate ? service.formatDateTime(customer.lastOrderDate) : "No orders yet";
		toggleStatusButton.textContent = customer.status === "blocked" ? "Unblock customer" : "Block customer";
		populateForm(customer);
		renderOrders(customer);
		setEditMode(state.editMode);
	}

	function reloadCustomer() {
		const customer = service.getCustomerById(customerId);
		if (!customer) {
			renderNotFound();
			return;
		}

		renderCustomer(customer);
	}

	function readFormPayload() {
		return {
			name: String(formFields.name.value || "").trim(),
			email: String(formFields.email.value || "").trim().toLowerCase(),
			phone: String(formFields.phone.value || "").trim(),
			avatar: String(formFields.avatar.value || "").trim(),
			status: formFields.status.value,
			verified: formFields.verified.value === "true",
			address: {
				line1: String(formFields.line1.value || "").trim(),
				city: String(formFields.city.value || "").trim(),
				district: String(formFields.district.value || "").trim(),
				sector: String(formFields.sector.value || "").trim(),
				cell: String(formFields.cell.value || "").trim(),
				village: String(formFields.village.value || "").trim()
			}
		};
	}

	editButton?.addEventListener("click", () => {
		setEditMode(true);
	});

	cancelButton?.addEventListener("click", () => {
		if (!state.customer) {
			return;
		}
		populateForm(state.customer);
		setEditMode(false);
	});

	toggleStatusButton?.addEventListener("click", () => {
		if (!state.customer) {
			return;
		}
		service.setCustomerStatus(state.customer.id, state.customer.status === "blocked" ? "active" : "blocked");
		reloadCustomer();
	});

	deleteButton?.addEventListener("click", () => {
		if (!state.customer) {
			return;
		}
		const confirmed = window.confirm(`Delete ${state.customer.name}? This removes the account from the website users list.`);
		if (!confirmed) {
			return;
		}
		service.deleteCustomer(state.customer.id);
		window.location.href = "index.html";
	});

	form?.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!state.customer) {
			return;
		}

		const updated = service.updateCustomer(state.customer.id, readFormPayload());
		if (!updated) {
			profileStatus.textContent = "The customer could not be saved.";
			return;
		}

		profileStatus.textContent = `${updated.name} was updated successfully.`;
		setEditMode(false);
		reloadCustomer();
	});

	window.addEventListener("storage", reloadCustomer);
	window.addEventListener(service.EVENT_NAME, reloadCustomer);
	window.addEventListener("byose:orders-changed", reloadCustomer);

	reloadCustomer();
})();// Customer profile page placeholder.
