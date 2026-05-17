(function initializeStorefrontCatalog() {
	"use strict";

	const STOREFRONT_PRODUCTS_UPDATED_EVENT = 'byose:storefront-products-updated';
	const STOREFRONT_PRODUCTS_ERROR_EVENT = 'byose:storefront-products-error';
	const DEFAULT_DETAIL_PAGE = 'product-details1.html';
	const FALLBACK_IMAGE = window.location.pathname.includes('/details/') ? '../img/logo.png' : 'img/logo.png';
	let syncInFlight = null;
	let servicePromise = null;

	function loadService() {
		if (!servicePromise) {
			servicePromise = import('../services/centralized-products.service.js').then((module) => module.default || module);
		}

		return servicePromise;
	}

	function mapStorefrontProduct(product) {
		const id = String(product && (product.id || product.catalogId) ? (product.id || product.catalogId) : '').trim();
		const image = String(product && (product.mainImage || product.image) ? (product.mainImage || product.image) : FALLBACK_IMAGE).trim() || FALLBACK_IMAGE;

		return {
			...product,
			id,
			catalogId: String(product && (product.catalogId || product.id) ? (product.catalogId || product.id) : id).trim() || id,
			image,
			mainImage: image,
			page: DEFAULT_DETAIL_PAGE,
			url: `${DEFAULT_DETAIL_PAGE}?id=${encodeURIComponent(String(id || ''))}`
		};
	}

	function publishProducts(products) {
		window.products = Array.isArray(products) ? products.map(mapStorefrontProduct) : [];
		window.dispatchEvent(new CustomEvent(STOREFRONT_PRODUCTS_UPDATED_EVENT, {
			detail: {
				products: window.products.slice()
			}
		}));
	}

	function publishError(error) {
		window.dispatchEvent(new CustomEvent(STOREFRONT_PRODUCTS_ERROR_EVENT, {
			detail: {
				message: String(error?.message || 'Unable to load product catalog from backend.')
			}
		}));
	}

	async function syncProducts(options = {}) {
		if (syncInFlight) {
			return syncInFlight;
		}

		syncInFlight = (async () => {
			try {
				const service = await loadService();
				const source = options.force && typeof service.forceRefreshProducts === 'function'
					? await service.forceRefreshProducts()
					: await service.getProductsWithRetry();

				publishProducts(source);
			} catch (error) {
				publishError(error);
			}
		})().finally(() => {
			syncInFlight = null;
		});

		return syncInFlight;
	}

	void syncProducts({ force: true });
	window.addEventListener('byose:products-synchronized', (event) => {
		publishProducts(event?.detail?.products || []);
	});
	window.addEventListener('byose:products-changed', () => {
		void syncProducts({ force: true });
	});
})();