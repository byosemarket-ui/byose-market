(function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminHomepageService;

	if (sidebar && typeof sidebar.init === "function") {
		sidebar.init();
	}

	if (!service) {
		return;
	}

	const params = new URLSearchParams(window.location.search);
	const state = {
		section: String(params.get("section") || "hero")
	};

	function escapeAttribute(value) {
		return service.escapeHtml(String(value || ""));
	}

	function createHeroPreviewMarkup(hero) {
		const slides = Array.isArray(hero?.slides) ? hero.slides : [];
		const previewSlide = slides.find((slide) => slide.active) || slides[0] || null;

		if (!previewSlide) {
			return `
				<div class="homepage-hero-preview-empty">
					<strong>No slides yet</strong>
					<p>Add a hero slide to preview how the homepage banner will look.</p>
				</div>
			`;
		}

		const buttonMarkup = previewSlide.buttonText && previewSlide.buttonLink
			? `<a class="homepage-preview-cta" href="${escapeAttribute(previewSlide.buttonLink)}" target="_blank" rel="noreferrer">${service.escapeHtml(previewSlide.buttonText)}</a>`
			: "";

		return `
			<div class="homepage-hero-preview-card">
				<div class="homepage-hero-preview-media">
					<img src="${escapeAttribute(resolveAdminPreviewAsset(previewSlide.image))}" alt="${escapeAttribute(previewSlide.alt || previewSlide.title || "Hero preview")}">
					<div class="homepage-hero-preview-overlay"></div>
					<div class="homepage-hero-preview-copy">
						<span class="homepage-hero-preview-eyebrow">${service.escapeHtml(hero?.title || "Byose Market")}</span>
						<h3>${service.escapeHtml(previewSlide.title || "Untitled slide")}</h3>
						<p>${service.escapeHtml(previewSlide.subtitle || "No subtitle yet")}</p>
						${buttonMarkup}
					</div>
				</div>
			</div>
		`;
	}

	function createHeroSlideCardMarkup(slide, index, totalSlides) {
		return `
			<article class="homepage-slide-card" data-hero-slide-card>
				<input type="hidden" data-slide-field="id" value="${escapeAttribute(slide.id)}">
				<div class="homepage-slide-card-head">
					<div>
						<p class="dashboard-eyebrow">Slide ${index + 1}</p>
						<h3>${service.escapeHtml(slide.title || `Hero slide ${index + 1}`)}</h3>
					</div>
					<div class="homepage-slide-card-actions">
						<span class="homepage-slide-state ${slide.active ? "is-active" : "is-inactive"}" data-slide-state>${slide.active ? "Active" : "Inactive"}</span>
						<button class="module-secondary-button" type="button" data-slide-action="move-up" ${index === 0 ? "disabled" : ""}>Up</button>
						<button class="module-secondary-button" type="button" data-slide-action="move-down" ${index === totalSlides - 1 ? "disabled" : ""}>Down</button>
						<button class="module-secondary-button homepage-slide-delete" type="button" data-slide-action="delete">Delete</button>
					</div>
				</div>
				<div class="homepage-slide-layout">
					<div class="homepage-slide-preview">
						<img src="${escapeAttribute(resolveAdminPreviewAsset(slide.image))}" alt="${escapeAttribute(slide.alt || slide.title || `Slide ${index + 1}`)}" data-slide-preview-image>
					</div>
					<div class="module-form-grid homepage-slide-fields">
						<label class="module-field-span-2"><span>Image URL</span><input type="text" data-slide-field="image" value="${escapeAttribute(slide.image)}" placeholder="img/hero.jpg or https://..."><small class="module-helper-text">Use a site path or full URL. Upload can also fill this field automatically.</small></label>
						<label class="module-field-span-2 homepage-slide-upload-field"><span>Upload Image</span><input type="file" accept="image/*" data-slide-upload></label>
						<label><span>Title</span><input type="text" data-slide-field="title" value="${escapeAttribute(slide.title)}" placeholder="Main hero title"></label>
						<label><span>Subtitle</span><input type="text" data-slide-field="subtitle" value="${escapeAttribute(slide.subtitle)}" placeholder="Supporting copy"></label>
						<label><span>Button Text</span><input type="text" data-slide-field="buttonText" value="${escapeAttribute(slide.buttonText)}" placeholder="Shop now"></label>
						<label><span>Button Link</span><input type="text" data-slide-field="buttonLink" value="${escapeAttribute(slide.buttonLink)}" placeholder="shop.html"></label>
						<label><span>Alt Text</span><input type="text" data-slide-field="alt" value="${escapeAttribute(slide.alt)}" placeholder="Slide image description"></label>
						<label><span>Order</span><input type="number" min="1" step="1" data-slide-field="order" value="${Number(slide.order || index + 1)}"></label>
						<label class="homepage-slide-visibility"><span>Visible on homepage</span><input type="checkbox" data-slide-field="active" ${slide.active ? "checked" : ""}></label>
					</div>
				</div>
			</article>
		`;
	}

	function buildHeroManager(hero) {
		const slides = Array.isArray(hero?.slides) ? hero.slides : [];
		return `
			<label class="module-field-span-2"><span>Hero Eyebrow</span><input name="title" type="text" value="${escapeAttribute(hero?.title)}" placeholder="Byose Market"></label>
			<div class="module-field-span-2 homepage-hero-manager">
				<div class="homepage-hero-toolbar">
					<div>
						<strong>Hero slide manager</strong>
						<p>Create, update, reorder, and toggle slides before saving them to the shared homepage config.</p>
					</div>
					<button class="module-primary-button" type="button" data-hero-action="add-slide">Add Slide</button>
				</div>
				<div class="homepage-hero-preview-wrap" data-hero-preview>
					${createHeroPreviewMarkup(hero)}
				</div>
				<div class="homepage-slide-list" data-hero-slides-list>
					${slides.map((slide, index) => createHeroSlideCardMarkup(slide, index, slides.length)).join("")}
				</div>
			</div>
		`;
	}

	function createEmptyHeroSlide(index) {
		return {
			id: service.createSlideId(),
			image: "",
			alt: "",
			title: "",
			subtitle: "",
			buttonText: "Shop now",
			buttonLink: "shop.html",
			active: true,
			order: index + 1
		};
	}

	function resolveAdminPreviewAsset(path) {
		const value = String(path || "").trim();
		if (!value) {
			return "../../img/logo.png";
		}
		if (/^(?:https?:|data:|blob:)/i.test(value)) {
			return value;
		}
		if (value.startsWith("../../") || value.startsWith("../") || value.startsWith("./") || value.startsWith("/")) {
			return value;
		}
		return `../../${value.replace(/^\/+/, "")}`;
	}

	function getHeroCards() {
		return Array.from(fields.querySelectorAll("[data-hero-slide-card]"));
	}

	function collectHeroSlides() {
		return service.normalizeHeroSlides(getHeroCards().map((card, index) => ({
			id: card.querySelector('[data-slide-field="id"]')?.value || service.createSlideId(),
			image: card.querySelector('[data-slide-field="image"]')?.value || "",
			alt: card.querySelector('[data-slide-field="alt"]')?.value || "",
			title: card.querySelector('[data-slide-field="title"]')?.value || "",
			subtitle: card.querySelector('[data-slide-field="subtitle"]')?.value || "",
			buttonText: card.querySelector('[data-slide-field="buttonText"]')?.value || "",
			buttonLink: card.querySelector('[data-slide-field="buttonLink"]')?.value || "",
			active: Boolean(card.querySelector('[data-slide-field="active"]')?.checked),
			order: Number(card.querySelector('[data-slide-field="order"]')?.value || index + 1)
		})));
	}

	function getHeroDraft() {
		return {
			title: String(form?.querySelector('[name="title"]')?.value || "").trim(),
			slides: collectHeroSlides()
		};
	}

	function renderHeroPreviewFromDraft() {
		const previewRoot = fields.querySelector("[data-hero-preview]");
		if (!previewRoot) {
			return;
		}

		previewRoot.innerHTML = createHeroPreviewMarkup(getHeroDraft());
	}

	function syncHeroCardsUi() {
		const cards = getHeroCards();
		cards.forEach((card, index) => {
			const titleInput = card.querySelector('[data-slide-field="title"]');
			const imageInput = card.querySelector('[data-slide-field="image"]');
			const activeInput = card.querySelector('[data-slide-field="active"]');
			const orderInput = card.querySelector('[data-slide-field="order"]');
			const stateNode = card.querySelector("[data-slide-state]");
			const previewImage = card.querySelector("[data-slide-preview-image]");
			const eyebrow = card.querySelector(".dashboard-eyebrow");
			const heading = card.querySelector("h3");
			const upButton = card.querySelector('[data-slide-action="move-up"]');
			const downButton = card.querySelector('[data-slide-action="move-down"]');

			if (eyebrow) {
				eyebrow.textContent = `Slide ${index + 1}`;
			}
			if (heading) {
				heading.textContent = String(titleInput?.value || "").trim() || `Hero slide ${index + 1}`;
			}
			if (previewImage) {
				previewImage.src = resolveAdminPreviewAsset(imageInput?.value || "");
			}
			if (stateNode) {
				const active = Boolean(activeInput?.checked);
				stateNode.textContent = active ? "Active" : "Inactive";
				stateNode.classList.toggle("is-active", active);
				stateNode.classList.toggle("is-inactive", !active);
			}
			if (orderInput) {
				orderInput.min = "1";
			}
			if (upButton) {
				upButton.disabled = index === 0;
			}
			if (downButton) {
				downButton.disabled = index === cards.length - 1;
			}
		});

		renderHeroPreviewFromDraft();
	}

	function insertHeroSlideCard(slide) {
		const list = fields.querySelector("[data-hero-slides-list]");
		if (!list) {
			return;
		}

		list.insertAdjacentHTML("beforeend", createHeroSlideCardMarkup(slide, getHeroCards().length, getHeroCards().length + 1));
		syncHeroCardsUi();
	}

	function sortHeroCardsByOrder() {
		const list = fields.querySelector("[data-hero-slides-list]");
		if (!list) {
			return;
		}

		const cards = getHeroCards().sort((left, right) => {
			const leftOrder = Number(left.querySelector('[data-slide-field="order"]')?.value || 0);
			const rightOrder = Number(right.querySelector('[data-slide-field="order"]')?.value || 0);
			return leftOrder - rightOrder;
		});

		cards.forEach((card, index) => {
			list.appendChild(card);
			const orderInput = card.querySelector('[data-slide-field="order"]');
			if (orderInput) {
				orderInput.value = String(index + 1);
			}
		});

		syncHeroCardsUi();
	}
	const sectionConfig = {
		hero: {
			title: "Hero Slides",
			intro: "Manage image, copy, CTA, ordering, and per-slide visibility for the storefront hero slider.",
			buildFields(content) {
				return buildHeroManager(content.hero);
			}
		},
		featured: {
			title: "Featured Products Section",
			intro: "Control the homepage featured products section headings and active filter pills.",
			buildFields(content) {
				return `
					<label><span>Eyebrow</span><input name="subheading" type="text" value="${service.escapeHtml(content.featured.subheading)}"></label>
					<label><span>Heading</span><input name="heading" type="text" value="${service.escapeHtml(content.featured.heading)}"></label>
					<label class="module-field-span-2"><span>Filters</span><input name="filters" type="text" value="${service.escapeHtml(content.featured.filters.join(", "))}"><small class="module-helper-text">Comma-separated values. These should match product categories or aliases used by the storefront.</small></label>
				`;
			}
		},
		banner: {
			title: "Quick Selection Banner",
			intro: "Manage the compact banner headline, supporting copy, and tag pills on the homepage.",
			buildFields(content) {
				return `
					<label><span>Heading</span><input name="title" type="text" value="${service.escapeHtml(content.banner.title)}"></label>
					<label class="module-field-span-2"><span>Body Text</span><textarea name="text" rows="5">${service.escapeHtml(content.banner.text)}</textarea></label>
					<label class="module-field-span-2"><span>Tags</span><input name="tags" type="text" value="${service.escapeHtml(content.banner.tags.join(", "))}"></label>
				`;
			}
		}
	};

	const tabs = Array.from(document.querySelectorAll("[data-homepage-section]"));
	const form = document.getElementById("homepageSectionForm");
	const title = document.getElementById("homepageSectionTitle");
	const intro = document.getElementById("homepageSectionIntro");
	const fields = document.getElementById("homepageSectionFields");
	const feedback = document.getElementById("homepageSectionFeedback");
	const overviewStats = document.getElementById("homepageOverviewStats");
	const visibilityControls = document.getElementById("homepageVisibilityControls");

	function getContent() {
		return service.getContent();
	}

	function getOverview() {
		return typeof service.getOverview === "function"
			? service.getOverview()
			: { sections: [] };
	}

	function setActiveTab() {
		tabs.forEach((button) => {
			button.classList.toggle("is-active", button.dataset.homepageSection === state.section);
		});
	}

	function renderOverview() {
		const overview = getOverview();
		if (overviewStats) {
			overviewStats.innerHTML = overview.sections.map((section) => `
				<article class="module-stat-card homepage-stat-card">
					<div class="homepage-stat-head">
						<span>${service.escapeHtml(section.label)}</span>
						<span class="homepage-status-badge ${section.enabled ? "is-active" : "is-inactive"}">${service.escapeHtml(section.status)}</span>
					</div>
					<strong>${Number(section.count || 0).toLocaleString("en-US")}</strong>
					<small>${service.escapeHtml(section.countLabel)}</small>
				</article>
			`).join("");
		}

		if (visibilityControls) {
			visibilityControls.innerHTML = overview.sections.map((section) => `
				<label class="homepage-toggle-card" for="homepage-toggle-${service.escapeHtml(section.key)}">
					<div class="homepage-toggle-copy">
						<div class="homepage-toggle-head">
							<strong>${service.escapeHtml(section.label)}</strong>
							<span class="homepage-status-badge ${section.enabled ? "is-active" : "is-inactive"}">${service.escapeHtml(section.status)}</span>
						</div>
						<p>${section.enabled ? "Visible on storefront homepage." : "Hidden from storefront homepage."}</p>
					</div>
					<span class="homepage-toggle-switch">
						<input id="homepage-toggle-${service.escapeHtml(section.key)}" type="checkbox" data-visibility-toggle="${service.escapeHtml(section.key)}" ${section.enabled ? "checked" : ""}>
						<span class="homepage-toggle-slider" aria-hidden="true"></span>
					</span>
				</label>
			`).join("");
		}
	}

	function renderSection() {
		const section = sectionConfig[state.section] || sectionConfig.hero;
		const content = getContent();
		setActiveTab();
		title.textContent = section.title;
		intro.textContent = section.intro;
		fields.innerHTML = section.buildFields(content);
	}

	function parseList(value) {
		return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
	}

	function parseSlides(value) {
		return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
			const parts = line.split("|");
			return {
				image: String(parts[0] || "").trim(),
				alt: String(parts.slice(1).join("|") || parts[0] || "Homepage slide").trim()
			};
		}).filter((slide) => slide.image);
	}

	function syncPage() {
		renderOverview();
		renderSection();
	}

	form?.addEventListener("submit", (event) => {
		event.preventDefault();
		const data = new FormData(form);
		if (state.section === "hero") {
			service.saveSection("hero", {
				title: String(data.get("title") || "").trim(),
				slides: collectHeroSlides()
			});
		} else if (state.section === "featured") {
			service.saveSection("featured", {
				heading: String(data.get("heading") || "").trim(),
				subheading: String(data.get("subheading") || "").trim(),
				filters: parseList(data.get("filters"))
			});
		} else {
			service.saveSection("banner", {
				title: String(data.get("title") || "").trim(),
				text: String(data.get("text") || "").trim(),
				tags: parseList(data.get("tags"))
			});
		}
		feedback.textContent = "Homepage configuration saved. Storefront pages using the shared homepage config will reflect the latest data.";
		feedback.className = "module-feedback is-success";
		syncPage();
	});

	form?.addEventListener("click", (event) => {
		if (state.section !== "hero") {
			return;
		}

		const addButton = event.target.closest('[data-hero-action="add-slide"]');
		if (addButton) {
			insertHeroSlideCard(createEmptyHeroSlide(getHeroCards().length));
			feedback.textContent = "New hero slide added. Save to publish it to the homepage.";
			feedback.className = "module-feedback";
			return;
		}

		const actionButton = event.target.closest("[data-slide-action]");
		if (!actionButton) {
			return;
		}

		const card = actionButton.closest("[data-hero-slide-card]");
		const list = fields.querySelector("[data-hero-slides-list]");
		if (!card || !list) {
			return;
		}

		const action = actionButton.dataset.slideAction;
		if (action === "delete") {
			const slideTitle = card.querySelector('[data-slide-field="title"]')?.value || "this slide";
			const confirmed = window.confirm(`Delete ${slideTitle}? This will not affect the homepage until you save.`);
			if (!confirmed) {
				return;
			}
			card.remove();
			syncHeroCardsUi();
			feedback.textContent = "Hero slide removed from the draft. Save to apply the deletion.";
			feedback.className = "module-feedback";
			return;
		}

		if (action === "move-up" && card.previousElementSibling) {
			list.insertBefore(card, card.previousElementSibling);
			syncHeroCardsUi();
			return;
		}

		if (action === "move-down" && card.nextElementSibling) {
			list.insertBefore(card.nextElementSibling, card);
			syncHeroCardsUi();
		}
	});

	form?.addEventListener("input", (event) => {
		if (state.section !== "hero") {
			return;
		}

		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		if (target.matches('[data-slide-field], [name="title"]')) {
			syncHeroCardsUi();
		}
	});

	form?.addEventListener("change", (event) => {
		if (state.section !== "hero") {
			return;
		}

		const target = event.target;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		if (target.matches('[data-slide-field="order"]')) {
			sortHeroCardsByOrder();
			return;
		}

		if (target.matches("[data-slide-upload]")) {
			const file = target.files && target.files[0];
			const card = target.closest("[data-hero-slide-card]");
			const imageInput = card?.querySelector('[data-slide-field="image"]');
			if (!file || !(imageInput instanceof HTMLInputElement)) {
				return;
			}

			const reader = new FileReader();
			reader.onload = () => {
				imageInput.value = String(reader.result || "");
				syncHeroCardsUi();
				feedback.textContent = "Slide image uploaded into the draft. Save to publish the updated hero slide.";
				feedback.className = "module-feedback";
			};
			reader.readAsDataURL(file);
		}
	});

	visibilityControls?.addEventListener("change", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || target.dataset.visibilityToggle === undefined) {
			return;
		}

		service.saveVisibility(target.dataset.visibilityToggle, target.checked);
		feedback.textContent = `${target.checked ? "Enabled" : "Disabled"} ${target.dataset.visibilityToggle} section on the homepage.`;
		feedback.className = "module-feedback is-success";
		renderOverview();
	});

	tabs.forEach((button) => {
		button.addEventListener("click", () => {
			state.section = button.dataset.homepageSection || "hero";
			feedback.textContent = "";
			feedback.className = "module-feedback";
			renderSection();
			syncHeroCardsUi();
		});
	});

	window.addEventListener(service.EVENT_NAME, syncPage);
	window.addEventListener("storage", (event) => {
		if (!event.key || event.key === "byose_admin_homepage_v1") {
			syncPage();
		}
	});

	syncPage();
})();
