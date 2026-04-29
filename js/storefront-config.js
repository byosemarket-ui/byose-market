(function () {
	"use strict";

	const SETTINGS_KEY = "byose_admin_settings_v1";
	const HOMEPAGE_KEY = "byose_admin_homepage_v1";

	function safeParse(value, fallbackValue) {
		try {
			return JSON.parse(value);
		} catch (error) {
			return fallbackValue;
		}
	}

	function getSitePrefix() {
		const path = String(window.location?.pathname || "");
		if (path.indexOf("/account/settings/") !== -1) {
			return "../../";
		}
		if (
			path.indexOf("/account/") !== -1 ||
			path.indexOf("/logout/") !== -1 ||
			path.indexOf("/components/") !== -1 ||
			path.indexOf("/details/") !== -1 ||
			path.indexOf("/shop/") !== -1 ||
			path.indexOf("/auth/") !== -1
		) {
			return "../";
		}
		return "";
	}

	function resolveAsset(path) {
		const value = String(path || "").trim();
		if (!value) {
			return value;
		}
		if (/^(?:https?:|data:|blob:)/i.test(value)) {
			return value;
		}
		if (value.startsWith("/")) {
			return value;
		}
		return getSitePrefix() + value.replace(/^\.\//, "");
	}

	function setMeta(selector, attribute, value) {
		const node = document.querySelector(selector);
		if (node && value) {
			node.setAttribute(attribute, value);
		}
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function isSafeLink(value) {
		const link = String(value || "").trim();
		return Boolean(link) && !/^javascript:/i.test(link);
	}

	function renderHeroSlides(hero) {
		const slides = Array.isArray(hero?.slides)
			? hero.slides.filter((slide) => slide?.image && slide?.active !== false && String(slide?.status || "active").toLowerCase() !== "inactive")
			: [];

		return slides.map((slide, index) => {
			const buttonMarkup = slide?.buttonText && isSafeLink(slide?.buttonLink)
				? `<a class="primary-cta hero-slide-cta" href="${escapeHtml(slide.buttonLink)}">${escapeHtml(slide.buttonText)}</a>`
				: "";

			return `
				<div class="hero-slide${index === 0 ? ' active' : ''}" data-slide-id="${escapeHtml(slide.id || `hero-slide-${index + 1}`)}" aria-hidden="${index === 0 ? 'false' : 'true'}">
					<img src="${escapeHtml(resolveAsset(slide.image))}" alt="${escapeHtml(slide.alt || slide.title || 'Homepage slide')}" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async">
					<div class="hero-slide-copy">
						<span class="hero-slide-eyebrow">${escapeHtml(hero?.title || 'Byose Market')}</span>
						<h1>${escapeHtml(slide.title || 'Homepage spotlight')}</h1>
						<p>${escapeHtml(slide.subtitle || '')}</p>
						${buttonMarkup}
					</div>
				</div>
			`;
		}).join('');
	}

	function setSectionVisibility(target, enabled) {
		if (!target) {
			return;
		}

		target.hidden = enabled === false;
		target.setAttribute('aria-hidden', enabled === false ? 'true' : 'false');
	}

	function applySettings() {
		const settings = safeParse(localStorage.getItem(SETTINGS_KEY), null);
		if (!settings || typeof settings !== "object") {
			return;
		}

		const branding = settings.branding || {};
		const general = settings.general || {};
		const seo = settings.seo || {};

		document.querySelectorAll(".brand-logo").forEach((image) => {
			if (branding.logo) {
				image.src = resolveAsset(branding.logo);
				image.alt = `${general.siteName || "Byose Market"} logo`;
			}
		});

		if (branding.accentColor) {
			document.documentElement.style.setProperty("--store-admin-accent", branding.accentColor);
		}

		setMeta('meta[name="theme-color"]', 'content', branding.themeColor || "");

		if (document.body.classList.contains("home-page")) {
			if (seo.title) {
				document.title = seo.title;
			}
			setMeta('meta[name="description"]', 'content', seo.description || "");
			setMeta('meta[name="keywords"]', 'content', seo.keywords || "");
			setMeta('meta[name="robots"]', 'content', seo.robots || "");
			setMeta('meta[property="og:image"]', 'content', branding.ogImage || "");
			setMeta('meta[name="twitter:image"]', 'content', branding.ogImage || "");
			setMeta('link[rel="canonical"]', 'href', seo.canonicalUrl || "");
		}
	}

	function applyHomepageConfig() {
		if (!document.body.classList.contains("home-page")) {
			return;
		}

		const homepage = safeParse(localStorage.getItem(HOMEPAGE_KEY), null);
		if (!homepage || typeof homepage !== "object") {
			return;
		}

		const visibility = {
			hero: homepage?.visibility?.hero !== false,
			featured: homepage?.visibility?.featured !== false,
			banner: homepage?.visibility?.banner !== false
		};

		const heroSection = document.querySelector('.hero-section');
		setSectionVisibility(document.getElementById('homeProducts'), visibility.featured);
		setSectionVisibility(document.querySelector('.compact-banner'), visibility.banner);

		const heroSlides = Array.isArray(homepage?.hero?.slides)
			? homepage.hero.slides.filter((slide) => slide?.image && slide?.active !== false && String(slide?.status || 'active').toLowerCase() !== 'inactive')
			: [];
		setSectionVisibility(heroSection, visibility.hero && heroSlides.length > 0);

		const slidesRoot = document.querySelector('.hero-slides');
		if (slidesRoot) {
			slidesRoot.innerHTML = renderHeroSlides(homepage.hero);
			window.dispatchEvent(new CustomEvent('byose:hero-slides-updated', {
				detail: {
					count: heroSlides.length
				}
			}));
		}

		const featuredSection = document.getElementById('homeProducts');
		if (featuredSection) {
			const eyebrow = featuredSection.querySelector('.section-kicker');
			const heading = featuredSection.querySelector('h2');
			if (eyebrow && homepage?.featured?.subheading) {
				eyebrow.textContent = homepage.featured.subheading;
			}
			if (heading && homepage?.featured?.heading) {
				heading.textContent = homepage.featured.heading;
			}
		}

		const filterPills = document.getElementById('filterPills');
		if (filterPills && Array.isArray(homepage?.featured?.filters) && homepage.featured.filters.length) {
			filterPills.innerHTML = homepage.featured.filters.map((filter, index) => `<button type="button" class="filter-pill${index === 0 ? ' is-active' : ''}" data-filter="${String(filter || '').trim()}">${String(filter || '').trim().replace(/(^\w|[- ]\w)/g, (match) => match.replace(/[- ]/, ' ').toUpperCase())}</button>`).join('');
		}

		const banner = document.querySelector('.compact-banner');
		if (banner) {
			const title = banner.querySelector('.banner-copy h2');
			const text = banner.querySelector('.banner-copy p');
			const tags = banner.querySelector('.banner-tags');
			if (title && homepage?.banner?.title) {
				title.textContent = homepage.banner.title;
			}
			if (text && homepage?.banner?.text) {
				text.textContent = homepage.banner.text;
			}
			if (tags && Array.isArray(homepage?.banner?.tags) && homepage.banner.tags.length) {
				tags.innerHTML = homepage.banner.tags.map((tag) => `<span>${String(tag || '').trim()}</span>`).join('');
			}
		}
	}

	function init() {
		applySettings();
		applyHomepageConfig();
		window.addEventListener('storage', (event) => {
			if (!event.key || event.key === SETTINGS_KEY) {
				applySettings();
			}
			if (!event.key || event.key === HOMEPAGE_KEY) {
				applyHomepageConfig();
			}
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();