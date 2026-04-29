(function (global) {
	"use strict";

	const STORAGE_KEY = "byose_admin_homepage_v1";
	const EVENT_NAME = "byose:homepage-changed";
	const DEFAULT_STATE = {
		visibility: {
			hero: true,
			featured: true,
			banner: true
		},
		hero: {
			title: "Byose Market Rwanda | Kugura Online Byoroshye",
			slides: [
				{
					id: "hero-slide-1",
					image: "img/hiro1 inketo.jpg",
					alt: "Inkweto promotions",
					title: "Discover everyday deals",
					subtitle: "Browse fashion, shoes, and essentials selected for fast shopping in Rwanda.",
					buttonText: "Shop now",
					buttonLink: "shop.html",
					active: true,
					order: 1
				},
				{
					id: "hero-slide-2",
					image: "img/hiro 2 ibikapu.jpg",
					alt: "Ibikapu promotions",
					title: "Fresh arrivals for every day",
					subtitle: "New bags, accessories, and compact picks curated for quick checkout.",
					buttonText: "View arrivals",
					buttonLink: "shop.html?filter=bags",
					active: true,
					order: 2
				},
				{
					id: "hero-slide-3",
					image: "img/hiro 3 imyenda.jpg",
					alt: "Imyenda promotions",
					title: "Style picks for the week",
					subtitle: "Find trending fashion and clothing from the latest store highlights.",
					buttonText: "Explore fashion",
					buttonLink: "shop.html?filter=fashion",
					active: true,
					order: 3
				},
				{
					id: "hero-slide-4",
					image: "img/hiro  4 electronics.jpg",
					alt: "Electronics promotions",
					title: "Popular electronics in one place",
					subtitle: "See devices and accessories with fast-moving demand on the homepage.",
					buttonText: "Shop electronics",
					buttonLink: "shop.html?filter=electronics",
					active: true,
					order: 4
				}
			]
		},
		featured: {
			heading: "Top deals kuri Home",
			subheading: "Explore products",
			filters: ["all", "fashion", "electronics", "shoes", "bags", "watches", "phones"]
		},
		banner: {
			title: "Dense layout, products nyinshi, no wasted space.",
			text: "Home ni iyo kureba no guhitamo. Cart ibikorwa bisigaye kuri product details na cart page.",
			tags: ["Top rated", "Fast moving", "New arrivals", "Best value"]
		}
	};

	function safeParse(value, fallbackValue) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallbackValue;
		}
	}

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function normalizeVisibility(visibility) {
		return {
			hero: visibility?.hero !== false,
			featured: visibility?.featured !== false,
			banner: visibility?.banner !== false
		};
	}

	function createSlideId() {
		return `hero-slide-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
	}

	function normalizeHeroSlides(slides) {
		const source = Array.isArray(slides) ? slides : clone(DEFAULT_STATE.hero.slides);

		return source
			.map((slide, index) => {
				const image = String(slide?.image || "").trim();
				if (!image) {
					return null;
				}

				const title = String(slide?.title || slide?.headline || slide?.alt || `Hero slide ${index + 1}`).trim();
				const subtitle = String(slide?.subtitle || slide?.description || "").trim();
				const buttonText = String(slide?.buttonText || slide?.ctaText || "Shop now").trim();
				const buttonLink = String(slide?.buttonLink || slide?.href || "shop.html").trim();
				const rawOrder = Number(slide?.order);

				return {
					id: String(slide?.id || "").trim() || `hero-slide-${index + 1}`,
					image,
					alt: String(slide?.alt || title || `Homepage slide ${index + 1}`).trim(),
					title,
					subtitle,
					buttonText,
					buttonLink,
					active: slide?.active !== false && String(slide?.status || "active").toLowerCase() !== "inactive",
					order: Number.isFinite(rawOrder) ? rawOrder : index + 1
				};
			})
			.filter(Boolean)
			.sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
			.map((slide, index) => ({
				...slide,
				order: index + 1
			}));
	}

	function getContent() {
		const stored = safeParse(global.localStorage.getItem(STORAGE_KEY), {});
		return {
			visibility: normalizeVisibility(stored.visibility),
			hero: {
				...clone(DEFAULT_STATE.hero),
				...stored.hero,
				slides: normalizeHeroSlides(Array.isArray(stored?.hero?.slides) ? stored.hero.slides : DEFAULT_STATE.hero.slides)
			},
			featured: {
				...clone(DEFAULT_STATE.featured),
				...stored.featured,
				filters: Array.isArray(stored?.featured?.filters) && stored.featured.filters.length ? stored.featured.filters : clone(DEFAULT_STATE.featured.filters)
			},
			banner: {
				...clone(DEFAULT_STATE.banner),
				...stored.banner,
				tags: Array.isArray(stored?.banner?.tags) && stored.banner.tags.length ? stored.banner.tags : clone(DEFAULT_STATE.banner.tags)
			}
		};
	}

	function getOverview() {
		const content = getContent();
		const activeHeroSlides = content.hero.slides.filter((slide) => slide.active).length;
		return {
			sections: [
				{
					key: "hero",
					label: "Hero Section",
					enabled: content.visibility.hero,
					status: content.visibility.hero ? "Active" : "Inactive",
					count: Array.isArray(content.hero.slides) ? content.hero.slides.length : 0,
					countLabel: `${activeHeroSlides} active hero slides`
				},
				{
					key: "featured",
					label: "Featured Section",
					enabled: content.visibility.featured,
					status: content.visibility.featured ? "Active" : "Inactive",
					count: 1,
					countLabel: "Featured sections"
				},
				{
					key: "banner",
					label: "Banner Blocks",
					enabled: content.visibility.banner,
					status: content.visibility.banner ? "Active" : "Inactive",
					count: 1,
					countLabel: "Banners"
				}
			]
		};
	}

	function saveSection(section, payload) {
		const current = getContent();
		const sectionKey = String(section || "").trim();
		const nextSection = {
			...current[sectionKey],
			...payload
		};

		if (sectionKey === "hero") {
			nextSection.slides = normalizeHeroSlides(nextSection.slides);
		}

		current[sectionKey] = nextSection;
		global.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
		global.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { section: sectionKey } }));
		return current;
	}

	function saveVisibility(section, enabled) {
		const current = getContent();
		const sectionKey = String(section || "").trim();
		if (!Object.prototype.hasOwnProperty.call(current.visibility, sectionKey)) {
			return current;
		}

		current.visibility = {
			...current.visibility,
			[sectionKey]: Boolean(enabled)
		};
		global.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
		global.dispatchEvent(new CustomEvent(EVENT_NAME, {
			detail: {
				section: sectionKey,
				type: "visibility"
			}
		}));
		return current;
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	global.AdminHomepageService = {
		EVENT_NAME,
		createSlideId,
		escapeHtml,
		getContent,
		getOverview,
		normalizeHeroSlides,
		saveSection,
		saveVisibility
	};
})(window);
