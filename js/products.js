(function initializeStorefrontCatalog() {
	"use strict";

	const STOREFRONT_PRODUCTS_UPDATED_EVENT = 'byose:storefront-products-updated';
	const STOREFRONT_PRODUCTS_ERROR_EVENT = 'byose:storefront-products-error';
	const DEFAULT_DETAIL_PAGE = 'details/product-details1.html';
	let syncInFlight = null;
	let servicePromise = null;

	function loadService() {
		if (!servicePromise) {
			servicePromise = import('../services/centralized-products.service.js').then((module) => module.default || module);
		}

		return servicePromise;
	}

	function resolveProductImage(product) {
		const gallery = Array.isArray(product && product.gallery) ? product.gallery : [];
		const galleryStoragePaths = Array.isArray(product && product.galleryStoragePaths) ? product.galleryStoragePaths : [];
		const candidates = [
			product && product.mainImage,
			product && product.image,
			product && product.thumbnail,
			...gallery,
			product && product.mainImageStoragePath,
			product && product.imageStoragePath,
			...galleryStoragePaths
		];

		for (const candidate of candidates) {
			const value = String(candidate || '').trim();
			if (!value || /^javascript:/i.test(value)) {
				continue;
			}

			const lowered = value.replace(/\\/g, '/').toLowerCase();
			if (/(?:^|\/)img\/logo\.png(?:\?|#|$)/.test(lowered) || lowered.endsWith('/img/logo.png')) {
				continue;
			}

			if (/^https?:\/\//i.test(value)) {
				return value;
			}

			const origin = String(window.location && window.location.origin || 'https://byosemarket.com').replace(/\/+$/, '');
			if (value.startsWith('/uploads/') || value.startsWith('/img/')) {
				return origin + value;
			}

			if (value.startsWith('uploads/')) {
				return origin + '/' + value.replace(/^\/+/, '');
			}

			if (/^(?:products|categories|users|reviews|temp)\//i.test(value)) {
				return origin + '/uploads/' + value.replace(/^\/+/, '');
			}

			if (value.startsWith('img/')) {
				return origin + '/' + value;
			}

			if (value.startsWith('/')) {
				return origin + value;
			}
		}

		return '';
	}

	function resolveDiscountFields(product) {
		const price = Number(product?.price ?? product?.salePrice ?? 0) || 0;
		const candidates = [
			product?.oldPrice,
			product?.compareAtPrice,
			product?.originalPrice,
			product?.metadata?.originalPrice
		];
		let oldPrice = 0;
		for (const candidate of candidates) {
			const parsed = Number(candidate) || 0;
			if (parsed > price) {
				oldPrice = parsed;
				break;
			}
		}
		const hasDiscount = oldPrice > price && price > 0;
		const storedPercent = Number(product?.discountPercent ?? product?.metadata?.discountPercent ?? 0);
		const discountPercent = hasDiscount
			? (storedPercent > 0 ? Math.round(storedPercent) : Math.round(((oldPrice - price) / oldPrice) * 100))
			: 0;

		return {
			price,
			salePrice: price,
			oldPrice: hasDiscount ? oldPrice : 0,
			originalPrice: hasDiscount ? oldPrice : 0,
			compareAtPrice: hasDiscount ? oldPrice : 0,
			discountPercent
		};
	}

	function mapStorefrontProduct(product) {
		const id = String(product && (product.id || product.catalogId) ? (product.id || product.catalogId) : '').trim();
		const image = resolveProductImage(product);
		const pricing = resolveDiscountFields(product);

		return {
			...product,
			...pricing,
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
				const cached = typeof service.getCachedProducts === 'function' ? service.getCachedProducts() : [];
				if (cached.length) {
					publishProducts(cached);
				}

				if (options.force && typeof service.forceRefreshProducts === 'function') {
					await service.forceRefreshProducts();
					publishProducts(typeof service.getCachedProducts === 'function'
						? service.getCachedProducts()
						: []);
				} else {
					publishProducts(await service.getProducts());
				}
			} catch (error) {
				publishError(error);
			}
		})().finally(() => {
			syncInFlight = null;
		});

		return syncInFlight;
	}

	void syncProducts({ force: false });
	window.addEventListener('byose:products-synchronized', (event) => {
		publishProducts(event?.detail?.products || []);
	});
	window.addEventListener('byose:products-changed', (event) => {
		const source = String(event?.detail?.source || '');
		if (source === 'api-create' || source === 'api-update' || source === 'api-delete' || source === 'admin' || source === 'admin-update') {
			void syncProducts({ force: true });
			return;
		}

		if (Array.isArray(event?.detail?.products)) {
			publishProducts(event.detail.products);
		}
	});
})();
