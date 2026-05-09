const products = [
	{
		id: 1,
		name: "Inkweto Pro Elite",
		category: "shoes",
		price: 18000,
		oldPrice: 25000,
		badge: "Top Pick",
		image: "img/all products   new bolonce.jpeg",
		url: "product-details1.html?id=1",
		page: "product-details1.html",
		keywords: ["inkweto", "shoes", "sneakers", "footwear", "pro", "elite"]
	},
	{
		id: 2,
		name: "Smart Watch X",
		category: "electronics",
		price: 28000,
		oldPrice: 32000,
		badge: "Smart Choice",
		image: "img/top2 isaha.jpeg",
		url: "product-details1.html?id=2",
		page: "product-details1.html",
		keywords: ["watch", "amasaha", "montre", "smartwatch", "electronics"]
	},
	{
		id: 3,
		name: "Leather Bag",
		category: "fashion",
		price: 15000,
		oldPrice: 20000,
		badge: "Trending",
		image: "img/ibikapu.jpeg",
		url: "product-details1.html?id=3",
		page: "product-details1.html",
		keywords: ["bag", "ibikapu", "sac", "leather", "fashion"]
	},
	{
		id: 4,
		name: "Android Smart TV",
		category: "electronics",
		price: 20000,
		oldPrice: 25000,
		badge: "Living Room Pick",
		image: "img/all products androidn tv.jpeg",
		url: "product-details1.html?id=4",
		page: "product-details1.html",
		keywords: ["tv", "television", "smart tv", "electronics", "android"]
	},
	{
		id: 5,
		name: "Classic T-Shirt",
		category: "fashion",
		price: 10000,
		oldPrice: 15000,
		badge: "Everyday Essential",
		image: "img/all products amashati.jpeg",
		url: "product-details1.html?id=5",
		page: "product-details1.html",
		keywords: ["t-shirt", "tshirt", "imyenda", "clothes", "shirt", "fashion"]
	},
	{
		id: 6,
		name: "Inkweto Pro Sport",
		category: "shoes",
		price: 18000,
		oldPrice: 25000,
		badge: "Sport Edit",
		image: "img/all products  ingweto.jpeg",
		url: "product-details1.html?id=6",
		page: "product-details1.html",
		keywords: ["inkweto", "shoes", "sport", "sneakers", "footwear"]
	},
	{
		id: 7,
		name: "Smart Watch X Lite",
		category: "electronics",
		price: 28000,
		oldPrice: 32000,
		badge: "Everyday Tech",
		image: "img/hiro 5 amasaha.jpg",
		url: "product-details1.html?id=7",
		page: "product-details1.html",
		keywords: ["watch", "smartwatch", "amasaha", "electronics", "lite"]
	},
	{
		id: 8,
		name: "Leather Bag Studio",
		category: "fashion",
		price: 15000,
		oldPrice: 20000,
		badge: "Statement Pick",
		image: "img/all products   ibikapu tiripo.jpeg",
		url: "product-details1.html?id=8",
		page: "product-details1.html",
		keywords: ["bag", "ibikapu", "studio", "fashion", "leather"]
	},
	{
		id: 9,
		name: "Android Smart TV Plus",
		category: "electronics",
		price: 20000,
		oldPrice: 25000,
		badge: "Home Upgrade",
		image: "img/top 4 android tv.jpeg",
		url: "product-details1.html?id=9",
		page: "product-details1.html",
		keywords: ["tv", "television", "android", "smart tv", "electronics"]
	},
	{
		id: 10,
		name: "Classic T-Shirt Studio",
		category: "fashion",
		price: 10000,
		oldPrice: 15000,
		badge: "Daily Layer",
		image: "img/all products cogo3.jpeg",
		url: "product-details1.html?id=10",
		page: "product-details1.html",
		keywords: ["t-shirt", "shirt", "fashion", "studio", "clothes"]
	},
	{
		id: 11,
		name: "Butterfly Queen Set",
		category: "fashion",
		price: 8000,
		oldPrice: 10000,
		badge: "Styled Set",
		image: "img/reduced  butterfly queen set.jpeg",
		url: "product-details1.html?id=11",
		page: "product-details1.html",
		keywords: ["butterfly", "queen", "set", "fashion", "accessories"]
	}
];

(function initializeStorefrontCatalog() {
	const catalogService = window.ByoseProductCatalog;
	let syncInFlight = null;
	let lastSyncAt = 0;
	const MIN_SYNC_INTERVAL_MS = 3000;

	function mapStorefrontProduct(product) {
		const id = Number(product && product.id) || 0;
		const image = String(product && (product.mainImage || product.image) ? (product.mainImage || product.image) : 'img/logo.png').trim();

		return {
			...product,
			id,
			image,
			mainImage: image,
			page: 'product-details1.html',
			url: `product-details1.html?id=${encodeURIComponent(String(id || ''))}`
		};
	}

	async function runSyncProducts(options = {}) {
		if (!catalogService || typeof catalogService.getStorefrontCatalog !== 'function') {
			window.products = [];
			window.dispatchEvent(new CustomEvent('byose:storefront-products-error', {
				detail: { message: 'Product catalog service is unavailable.' }
			}));
			return;
		}

		if (typeof catalogService.refreshCatalog === 'function') {
			try {
				await catalogService.refreshCatalog({ silent: false, force: Boolean(options.force) });
			} catch (error) {
				window.dispatchEvent(new CustomEvent('byose:storefront-products-error', {
					detail: { message: String(error?.message || 'Unable to load product catalog from backend.') }
				}));
			}
		}

		const source = catalogService.getStorefrontCatalog();
		window.products = Array.isArray(source) ? source.map(mapStorefrontProduct) : [];
		window.dispatchEvent(new CustomEvent('byose:storefront-products-updated', {
			detail: {
				products: window.products.slice()
			}
		}));
		lastSyncAt = Date.now();
	}

	async function syncProducts(options = {}) {
		if (syncInFlight) {
			return syncInFlight;
		}

		const now = Date.now();
		const shouldForce = Boolean(options.force);
		if (!shouldForce && now - lastSyncAt < MIN_SYNC_INTERVAL_MS) {
			return;
		}

		syncInFlight = runSyncProducts({ force: shouldForce }).finally(() => {
			syncInFlight = null;
		});

		return syncInFlight;
	}

	void syncProducts({ force: true });
	window.addEventListener('storage', (event) => {
		if (event && event.key && event.key !== 'byose_market_products_catalog_v1') {
			return;
		}
		void syncProducts();
	});
	window.addEventListener('byose:products-changed', () => { void syncProducts({ force: true }); });
})();