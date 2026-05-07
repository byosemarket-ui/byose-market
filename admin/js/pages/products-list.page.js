(async function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminProductsService;

	if (sidebar && typeof sidebar.init === 'function') {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	try {
		elements.status.textContent = 'Loading live catalog from the backend...';
		await service.init?.();
	} catch (error) {
		elements.status.textContent = error?.message || 'Unable to load the centralized catalog right now.';
	}

	const elements = {
		searchInput: document.getElementById('productSearchInput'),
		categoryFilter: document.getElementById('productCategoryFilter'),
		status: document.getElementById('productListStatus'),
		tableBody: document.getElementById('productTableBody'),
		cardGrid: document.getElementById('productCardGrid'),
		stats: {
			totalProducts: document.getElementById('productsTotalCount'),
			totalStock: document.getElementById('productsTotalStock'),
			lowStock: document.getElementById('productsLowStock'),
			totalValue: document.getElementById('productsTotalValue')
		}
	};

	function getStockMarkup(product) {
		const stock = Number(product.stock);
		if (!Number.isFinite(stock)) {
			return '<span class="stock-pill stock-pill--unknown">N/A</span>';
		}

		if (stock <= 0) {
			return '<span class="stock-pill stock-pill--empty">Out</span>';
		}

		if (stock <= 5) {
			return `<span class="stock-pill stock-pill--low">${stock}</span>`;
		}

		return `<span class="stock-pill stock-pill--healthy">${stock}</span>`;
	}

	function createActionButtons(product) {
		return `
			<a class="table-action-icon" href="edit.html?id=${encodeURIComponent(product.id)}" aria-label="Edit ${service.escapeHtml(product.name)}" title="Edit product">
				<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
			</a>
			<button class="table-action-icon table-action-icon--danger" type="button" data-delete-id="${service.escapeHtml(product.id)}" aria-label="Delete ${service.escapeHtml(product.name)}" title="Delete product">
				<i class="fa-solid fa-trash" aria-hidden="true"></i>
			</button>
		`;
	}

	function getProductImageSrc(product) {
		return service.resolveStorefrontImagePath(product.mainImage || product.image || '');
	}

	function renderStats(products) {
		const stats = service.getStats(products);
		elements.stats.totalProducts.textContent = Number(stats.totalProducts || 0).toLocaleString('en-US');
		elements.stats.totalStock.textContent = Number(stats.totalStock || 0).toLocaleString('en-US');
		elements.stats.lowStock.textContent = Number(stats.lowStock || 0).toLocaleString('en-US');
		elements.stats.totalValue.textContent = service.formatCurrency(stats.totalValue || 0);
	}

	function renderRows(products) {
		if (!Array.isArray(products) || !products.length) {
			elements.tableBody.innerHTML = '<tr><td colspan="5" class="products-empty-row">No products match the current filters.</td></tr>';
			return;
		}

		elements.tableBody.innerHTML = products.map((product) => `
			<tr>
				<td>
					<div class="product-cell product-cell--name">
						<img src="${service.escapeHtml(getProductImageSrc(product))}" alt="${service.escapeHtml(product.name)}">
						<div>
							<strong>${service.escapeHtml(product.name)}</strong>
							<small>ID ${service.escapeHtml(product.id)}</small>
						</div>
					</div>
				</td>
				<td>${service.escapeHtml(service.normalizeCategoryLabel(product.category))}</td>
				<td>${service.formatCurrency(product.price)}</td>
				<td>${getStockMarkup(product)}</td>
				<td>
					<div class="product-actions-inline">
						${createActionButtons(product)}
					</div>
				</td>
			</tr>
		`).join('');
	}

	function renderCards(products) {
		if (!elements.cardGrid) {
			return;
		}

		if (!Array.isArray(products) || !products.length) {
			elements.cardGrid.innerHTML = '<div class="products-empty-card">No products match the current filters.</div>';
			return;
		}

		elements.cardGrid.innerHTML = products.map((product) => `
			<article class="product-list-card">
				<div class="product-list-card__media">
					<img src="${service.escapeHtml(getProductImageSrc(product))}" alt="${service.escapeHtml(product.name)}">
				</div>
				<div class="product-list-card__body">
					<div class="product-list-card__heading">
						<div>
							<p class="product-list-card__category">${service.escapeHtml(service.normalizeCategoryLabel(product.category))}</p>
							<h3>${service.escapeHtml(product.name)}</h3>
						</div>
						<div class="product-list-card__actions">
							${createActionButtons(product)}
						</div>
					</div>
					<div class="product-list-card__meta">
						<div>
							<span class="product-list-card__label">Price</span>
							<strong>${service.formatCurrency(product.price)}</strong>
						</div>
						<div>
							<span class="product-list-card__label">Stock</span>
							${getStockMarkup(product)}
						</div>
					</div>
				</div>
			</article>
		`).join('');
	}

	function updateStatus(products) {
		const query = String(elements.searchInput.value || '').trim();
		const category = String(elements.categoryFilter.value || 'all');
		const categoryLabel = category === 'all' ? 'All categories' : service.normalizeCategoryLabel(category);
		elements.status.textContent = `${products.length} products • ${categoryLabel}${query ? ` • Search: ${query}` : ''}`;
	}

	function render() {
		const products = service.filterProducts({
			query: elements.searchInput.value,
			category: elements.categoryFilter.value
		});

		renderStats(products);
		renderRows(products);
		renderCards(products);
		updateStatus(products);
	}

	elements.searchInput.addEventListener('input', render);
	elements.categoryFilter.addEventListener('change', render);
	elements.tableBody.addEventListener('click', async (event) => {
		const button = event.target.closest('[data-delete-id]');
		if (!button) {
			return;
		}

		const productId = Number(button.dataset.deleteId || 0);
		const product = service.getProductById(productId);
		if (!product) {
			render();
			return;
		}

		const confirmed = window.confirm(`Delete ${product.name} from the shared website catalog?`);
		if (!confirmed) {
			return;
		}

		button.disabled = true;
		try {
			await service.deleteProduct(productId);
			render();
		} catch (error) {
			window.alert(error?.message || 'The product could not be deleted right now.');
		} finally {
			button.disabled = false;
		}
	});

	window.addEventListener('storage', render);
	window.addEventListener('byose:products-changed', render);
	render();
})();
