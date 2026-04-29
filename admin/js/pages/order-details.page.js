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

	const params = new URLSearchParams(window.location.search);
	const orderId = params.get("id") || "";

	const elements = {
		hero: document.getElementById("orderDetailsHero"),
		grid: document.getElementById("orderDetailsGrid"),
		statusMessage: document.getElementById("orderDetailsStatusMessage"),
		statusSelect: document.getElementById("orderStatusSelect"),
		deleteButton: document.getElementById("deleteOrderButton"),
		customerPanel: document.getElementById("orderCustomerPanel"),
		paymentPanel: document.getElementById("orderPaymentPanel"),
		summaryPanel: document.getElementById("orderSummaryPanel"),
		productsList: document.getElementById("orderProductsList")
	};
	const FALLBACK_PRODUCT_IMAGE = "../img/logo.png";

	function getStatusMarkup(order) {
		return `<span class="order-status-pill order-status-pill--${service.getStatusTone(order.status)}">${service.escapeHtml(order.status)}</span>`;
	}

	function renderAddress(address) {
		const rows = [
			["Customer", address?.fullName || [address?.firstName, address?.lastName].filter(Boolean).join(" ")],
			["Phone", address?.phone],
			["Province / City", address?.provinceCity || address?.city],
			["District", address?.district],
			["Sector", address?.sector],
			["Cell", address?.cell],
			["Village", address?.village],
			["Street / Landmark", address?.street],
			["Optional note", address?.note],
			["GPS coordinates", address?.latitude && address?.longitude ? `${address.latitude}, ${address.longitude}` : ""],
			["Location accuracy", address?.locationAccuracy ? `${address.locationAccuracy} m` : ""],
			["Captured at", address?.locationCapturedAt ? new Date(address.locationCapturedAt).toLocaleString() : ""]
		].filter(([, value]) => Boolean(value));

		if (!rows.length && !address?.mapLink) {
			return '<p class="orders-empty-state">No delivery address recorded.</p>';
		}

		return `
			<div class="orders-review-grid">
				${rows.map(([label, value]) => `
					<div><span>${service.escapeHtml(label)}</span><strong>${service.escapeHtml(value)}</strong></div>
				`).join("")}
			</div>
			${address?.mapLink ? `<p><a class="orders-secondary-link" href="${service.escapeHtml(address.mapLink)}" target="_blank" rel="noreferrer noopener">Open Google Maps location</a></p>` : ""}
		`;
	}

	function renderProducts(order) {
		if (!order.products.length) {
			elements.productsList.innerHTML = '<div class="orders-empty-state">No products were recorded for this order.</div>';
			return;
		}

		elements.productsList.innerHTML = order.products.map((product) => `
			<article class="order-product-card">
				<img src="${service.escapeHtml(product.image || FALLBACK_PRODUCT_IMAGE)}" alt="${service.escapeHtml(product.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${FALLBACK_PRODUCT_IMAGE}';">
				<div class="order-product-copy">
					<div class="order-product-heading">
						<div>
							<h3>${service.escapeHtml(product.name)}</h3>
							<p>${service.escapeHtml(product.attributeSummary || "Standard option")}</p>
						</div>
						<strong>${service.formatCurrency(product.price)}</strong>
					</div>
					<div class="order-product-meta">
						<div><span>Quantity</span><strong>${product.qty}</strong></div>
						<div><span>Line total</span><strong>${service.formatCurrency(Number(product.price || 0) * Number(product.qty || 0))}</strong></div>
						<div><span>Product ID</span><strong>${service.escapeHtml(product.id || "Unknown")}</strong></div>
					</div>
				</div>
			</article>
		`).join("");
	}

	function renderOrder(order) {
		document.title = `${order.id} | Order Details | Byose Market Admin`;
		elements.grid.hidden = false;
		elements.hero.innerHTML = `
			<p class="dashboard-eyebrow">Order Details</p>
			<h2>${service.escapeHtml(order.id)}</h2>
			<p>${service.escapeHtml(order.customerName)} • ${service.formatDateTime(order.date)} • ${service.formatCurrency(order.total)}</p>
			<div class="orders-hero-status-row">
				${getStatusMarkup(order)}
				${order.customerLink ? `<a class="orders-secondary-link" href="${order.customerLink}">Open customer profile</a>` : ""}
			</div>
		`;

		elements.statusSelect.innerHTML = service.STATUS_OPTIONS.map((status) => `<option value="${service.escapeHtml(status)}" ${status === order.status ? "selected" : ""}>${service.escapeHtml(status)}</option>`).join("");
		elements.statusMessage.textContent = `Current status: ${order.status}`;

		elements.customerPanel.innerHTML = `
			<div class="orders-panel-headline">
				<p class="dashboard-eyebrow">Customer</p>
				<h3>${service.escapeHtml(order.customerName)}</h3>
			</div>
			<div class="orders-info-grid">
				<div><span>Checkout type</span><strong>${service.escapeHtml(order.isGuest ? "Guest order" : "Account order")}</strong></div>
				<div><span>Phone</span><strong>${service.escapeHtml(order.customerPhone || "No phone")}</strong></div>
				<div><span>Email</span><strong>${service.escapeHtml(order.customerEmail || "Guest checkout")}</strong></div>
				<div><span>Customer ID</span><strong>${service.escapeHtml(order.customerId || "Guest")}</strong></div>
				<div><span>Linked profile</span><strong>${order.customerLink ? "Available" : "Not linked"}</strong></div>
			</div>
		`;

		elements.paymentPanel.innerHTML = `
			<div class="orders-panel-headline">
				<p class="dashboard-eyebrow">Payment & Delivery</p>
				<h3>Operational details</h3>
			</div>
			<div class="orders-info-grid">
				<div><span>Payment type</span><strong>${service.escapeHtml(order.paymentType || "pay_now")}</strong></div>
				<div><span>Payment method</span><strong>${service.escapeHtml(order.paymentMethod || "Not set")}</strong></div>
				<div><span>Payment status</span><strong>${service.escapeHtml(order.paymentStatusLabel || order.paymentStatus || "pending")}</strong></div>
				<div><span>Payer phone</span><strong>${service.escapeHtml(order.payment?.payerPhone || order.customerPhone || "Not set")}</strong></div>
				<div><span>Transaction ID</span><strong>${service.escapeHtml(order.payment?.transactionId || "Not provided")}</strong></div>
			</div>
			<div class="orders-address-block">
				<h4>Delivery info</h4>
				<p><strong>Method:</strong> ${service.escapeHtml(order.deliveryLabel || "Delivery to address")}</p>
				${renderAddress(order.shippingAddress)}
			</div>
		`;

		elements.summaryPanel.innerHTML = `
			<div class="orders-panel-headline">
				<p class="dashboard-eyebrow">Totals</p>
				<h3>Order summary</h3>
			</div>
			<div class="orders-summary-lines">
				<div class="orders-summary-line"><span>Subtotal</span><strong>${service.formatCurrency(order.subtotal)}</strong></div>
				<div class="orders-summary-line"><span>Shipping</span><strong>${service.formatCurrency(order.shippingFee)}</strong></div>
				${order.codFee ? `<div class="orders-summary-line"><span>COD fee</span><strong>${service.formatCurrency(order.codFee)}</strong></div>` : ""}
				<div class="orders-summary-line orders-summary-line--total"><span>Total</span><strong>${service.formatCurrency(order.total)}</strong></div>
				<div class="orders-summary-line"><span>Date</span><strong>${service.formatDateTime(order.date)}</strong></div>
			</div>
		`;

		renderProducts(order);
	}

	function renderNotFound() {
		elements.hero.innerHTML = `
			<p class="dashboard-eyebrow">Order Details</p>
			<h2>Order not found</h2>
			<p>The requested order could not be found in the live checkout storage.</p>
			<a class="orders-secondary-link" href="index.html">Back to orders list</a>
		`;
		elements.grid.hidden = true;
	}

	function reloadOrder() {
		const order = service.getOrderById(orderId);
		if (!order) {
			renderNotFound();
			return;
		}

		renderOrder(order);
	}

	elements.statusSelect?.addEventListener("change", async () => {
		const updated = await service.updateOrderStatus(orderId, elements.statusSelect.value || "Pending");
		if (!updated) {
			elements.statusMessage.textContent = "The order status could not be updated.";
			return;
		}

		elements.statusMessage.textContent = `${updated.id} updated to ${updated.status}.`;
		reloadOrder();
	});

	elements.deleteButton?.addEventListener("click", async () => {
		const order = service.getOrderById(orderId);
		if (!order) {
			renderNotFound();
			return;
		}

		const confirmed = window.confirm(`Delete ${order.id}? This permanently removes the order from the admin order store.`);
		if (!confirmed) {
			return;
		}

		await service.deleteOrder(orderId);
		window.location.href = "index.html";
	});

	window.addEventListener("storage", reloadOrder);
	window.addEventListener(service.EVENT_NAME, reloadOrder);
	window.addEventListener("byose:orders-changed", reloadOrder);

	reloadOrder();
})();
