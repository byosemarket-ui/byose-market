(function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminProductsService;

	if (sidebar && typeof sidebar.init === 'function') {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	const productId = service.getProductIdFromLocation();
	const product = service.getProductById(productId);
	const mount = document.getElementById('productViewMount');
	const title = document.getElementById('productViewTitle');
	const subtitle = document.getElementById('productViewSubtitle');
	const editButton = document.getElementById('productEditButton');
	const deleteButton = document.getElementById('productDeleteButton');

	if (!product) {
		title.textContent = 'Product not found';
		subtitle.textContent = 'The selected catalog item is not available.';
		mount.innerHTML = '<div class="product-view-empty">This product was removed from the shared catalog.</div>';
		deleteButton.hidden = true;
		return;
	}

	title.textContent = product.name;
	subtitle.textContent = `Product ID ${product.id} synced to home, shop, search, details, and dashboard.`;
	if (editButton) {
		editButton.href = `edit.html?id=${encodeURIComponent(product.id)}`;
	}

	mount.innerHTML = `
		<section class="product-view-grid">
			<article class="dashboard-panel product-view-card">
				<img class="product-view-image" src="${service.escapeHtml(service.resolveStorefrontImagePath(product.mainImage || product.image || ''))}" alt="${service.escapeHtml(product.name)}">
				<div class="product-view-copy">
					<p class="product-view-eyebrow">${service.escapeHtml(service.normalizeCategoryLabel(product.category))}</p>
					<h2>${service.escapeHtml(product.name)}</h2>
					<p>${service.escapeHtml(product.shortDescription || product.description || '')}</p>
					<div class="product-view-price-row">
						<strong>${service.formatCurrency(product.price)}</strong>
						<span>${Number(product.stock || 0).toLocaleString('en-US')} in stock</span>
					</div>
					<div class="product-view-links">
						<a class="view-link-pill" href="../../product-details1.html?id=${encodeURIComponent(product.id)}" target="_blank" rel="noreferrer">Open storefront details</a>
						<a class="view-link-pill" href="../../shop.html">Open shop page</a>
					</div>
				</div>
			</article>

			<article class="dashboard-panel product-view-card">
				<h3>Catalog metadata</h3>
				<ul class="product-view-list">
					<li><span>Badge</span><strong>${service.escapeHtml(product.badge || 'Catalog item')}</strong></li>
					<li><span>Updated</span><strong>${service.escapeHtml(service.formatDate(product.updatedAt))}</strong></li>
					<li><span>Keywords</span><strong>${service.escapeHtml(Array.isArray(product.keywords) ? product.keywords.join(', ') : '')}</strong></li>
				</ul>
				<h3>Highlights</h3>
				<ul class="product-view-bullets">
					${(Array.isArray(product.highlights) ? product.highlights : []).map((entry) => `<li>${service.escapeHtml(entry)}</li>`).join('') || '<li>No highlights provided.</li>'}
				</ul>
				<h3>Specifications</h3>
				<ul class="product-view-bullets">
					${(Array.isArray(product.specs) ? product.specs : []).map((entry) => `<li><strong>${service.escapeHtml(entry[0])}:</strong> ${service.escapeHtml(entry[1])}</li>`).join('') || '<li>No specifications provided.</li>'}
				</ul>
			</article>
		</section>
	`;

	deleteButton.addEventListener('click', async () => {
		const confirmed = window.confirm(`Delete ${product.name} from the shared website catalog?`);
		if (!confirmed) {
			return;
		}

		deleteButton.disabled = true;
		try {
			await service.deleteProduct(product.id);
			window.location.href = 'index.html';
		} catch (error) {
			subtitle.textContent = error?.message || 'The product could not be deleted right now.';
			deleteButton.disabled = false;
		}
	});
})();
