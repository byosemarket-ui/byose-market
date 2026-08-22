/* categories.js
	 Dynamically renders category cards and handles interactions.
	 - Uses the shared product catalog when available
	 - Falls back to a curated static list when the live catalog is unavailable
	 - Adds click/keyboard handlers to redirect to shop.html?category=slug
	 - Includes client-side search/filter
*/

const FALLBACK_CATEGORIES = [
	{ name: 'Shoes', slug: 'shoes', count: 124, image: 'https://images.unsplash.com/photo-1600180758890-6ffa1b3dfd30?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=1' },
	{ name: 'Bags', slug: 'bags', count: 88, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=2' },
	{ name: 'Clothes', slug: 'clothes', count: 320, image: 'https://images.unsplash.com/photo-1520975698517-2c3c3f8b2f12?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=3' },
	{ name: 'Electronics', slug: 'electronics', count: 212, image: 'https://images.unsplash.com/photo-1518779578993-ec3579fff3d1?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=4' },
	{ name: 'Smartphones', slug: 'smartphones', count: 154, image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=5' },
	{ name: 'Accessories', slug: 'accessories', count: 96, image: 'https://images.unsplash.com/photo-1509395176047-4a66953fd231?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=6' },
	{ name: 'Watches', slug: 'watches', count: 67, image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=7' },
	{ name: 'Beauty Products', slug: 'beauty-products', count: 140, image: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=8' },
	{ name: 'Home Items', slug: 'home-items', count: 185, image: 'https://images.unsplash.com/photo-1493666438817-866a91353ca9?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=9' },
	{ name: 'Sports', slug: 'sports', count: 58, image: 'https://images.unsplash.com/photo-1508609349937-5ec4ae374ebf?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=10' },
	{ name: 'Kids', slug: 'kids', count: 74, image: 'https://images.unsplash.com/photo-1542204165-3d1a47f38b35?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=11' },
	{ name: 'Gaming', slug: 'gaming', count: 43, image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1200&auto=format&fit=crop&ixlib=rb-4.0.3&s=12' }
];

const CATEGORY_ALIASES = {
	apparel: 'fashion',
	bag: 'bags',
	bags: 'bags',
	clothes: 'fashion',
	clothing: 'fashion',
	fashion: 'fashion',
	footwear: 'shoes',
	phone: 'phones',
	phones: 'phones',
	shoe: 'shoes',
	shoes: 'shoes',
	smartphone: 'phones',
	smartphones: 'phones',
	watch: 'watches',
	watches: 'watches'
};

const CATEGORY_IMAGE_FALLBACKS = FALLBACK_CATEGORIES.reduce((result, category) => {
	result[category.slug] = category.image;
	return result;
}, {});

let categories = FALLBACK_CATEGORIES.slice();
let catalogServicePromise = null;

const grid = document.getElementById('categoriesGrid');
const searchInput = document.getElementById('categorySearch');

function normalizeText(value) {
	return String(value || '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function normalizeCategorySlug(value) {
	const normalized = normalizeText(value).replace(/\s+/g, '-');
	return CATEGORY_ALIASES[normalized] || normalized || 'general';
}

function toCategoryLabel(slug) {
	return String(slug || 'general')
		.replace(/-/g, ' ')
		.replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}

function normalizeVisibility(value) {
	const normalized = normalizeText(value).replace(/\s+/g, '-');
	if (normalized === 'home' || normalized === 'shop' || normalized === 'both') {
		return normalized;
	}

	if (normalized === 'all') {
		return 'both';
	}

	return 'both';
}

function getProductImage(product, slug) {
	const candidate = String(product?.mainImage || product?.image || '').trim();
	if (candidate) {
		return candidate;
	}

	return CATEGORY_IMAGE_FALLBACKS[slug] || 'img/logo.png';
}

function buildLiveCategories(products) {
	const grouped = new Map();

	(products || [])
		.filter((product) => {
			const visibility = normalizeVisibility(product?.visibility);
			return visibility === 'shop' || visibility === 'both';
		})
		.forEach((product) => {
			const slug = normalizeCategorySlug(product?.category);
			const current = grouped.get(slug) || {
				name: toCategoryLabel(slug),
				slug,
				count: 0,
				image: getProductImage(product, slug)
			};

			current.count += 1;
			if (!current.image || current.image === CATEGORY_IMAGE_FALLBACKS[slug]) {
				current.image = getProductImage(product, slug);
			}

			grouped.set(slug, current);
		});

	const liveCategories = Array.from(grouped.values()).sort((left, right) => left.name.localeCompare(right.name));
	return liveCategories.length ? liveCategories : FALLBACK_CATEGORIES.slice();
}

function loadCatalogService() {
	if (!catalogServicePromise) {
		catalogServicePromise = import('./services/centralized-products.service.js')
			.then((module) => module.default || module)
			.catch(() => null);
	}

	return catalogServicePromise;
}

/** createCard - builds DOM for a single category */
const createCard = (cat, index) => {
	const card = document.createElement('article');
	card.className = 'category-card animate';
	card.setAttribute('role', 'button');
	card.setAttribute('tabindex', '0');
	card.setAttribute('aria-label', `${cat.name} category with ${cat.count} products`);

	// Set staggered animation delay for nice entrance
	card.style.animationDelay = `${index * 60}ms`;

	card.innerHTML = `
		<div class="category-media">
			<img src="${cat.image}" alt="${cat.name}" loading="lazy">
		</div>
		<div class="category-content">
			<h3 class="category-title">${cat.name}</h3>
			<div class="category-count">${cat.count} Products</div>
		</div>
		<div class="category-overlay"></div>
		<div class="category-badge">${cat.count}</div>
	`;

	// click handler - navigate with category query param
	const navigate = () => {
		const q = encodeURIComponent(cat.slug);
		window.location.href = `shop.html?category=${q}`;
	};

	card.addEventListener('click', navigate);
	card.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); }
	});

	return card;
};

/** render - places category cards in the grid */
const render = (items) => {
	if (!grid) {
		return;
	}

	grid.innerHTML = '';
	items.forEach((c, i) => grid.appendChild(createCard(c, i)));
};

function filterCategories(query) {
	const normalizedQuery = String(query || '').trim().toLowerCase();
	if (!normalizedQuery) {
		return categories.slice();
	}

	return categories.filter((category) => category.name.toLowerCase().includes(normalizedQuery) || category.slug.toLowerCase().includes(normalizedQuery));
}

async function syncCategories() {
	render(categories);

	const service = await loadCatalogService();
	if (!service || typeof service.getProductsWithRetry !== 'function') {
		return;
	}

	try {
		const products = await service.getProductsWithRetry();
		categories = buildLiveCategories(products);
		render(filterCategories(searchInput?.value || ''));
	} catch (_error) {
		const cached = typeof service.getCachedProducts === 'function' ? service.getCachedProducts() : [];
		categories = buildLiveCategories(cached);
		render(filterCategories(searchInput?.value || ''));
	}

	if (typeof window !== 'undefined' && service.GLOBAL_SYNC_EVENT) {
		if (typeof service.ensureProductLiveSync === 'function') {
			service.ensureProductLiveSync();
		}
		window.addEventListener(service.GLOBAL_SYNC_EVENT, (event) => {
			categories = buildLiveCategories(event?.detail?.products || []);
			render(filterCategories(searchInput?.value || ''));
		});
	}
}

// initial render
render(categories);
void syncCategories();

// set current year in footer
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// search/filter behavior
if (searchInput) {
	searchInput.addEventListener('input', (e) => {
		render(filterCategories(e.target.value));
	});
}

// Expose for potential future use (e.g., dynamic loading)
window.appCategories = {
	categories,
	render
};

