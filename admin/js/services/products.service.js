(function (global) {
	"use strict";

	const DEFAULT_CATEGORY_OPTIONS = [
		{ value: "fashion", label: "Fashion" },
		{ value: "shoes", label: "Shoes" },
		{ value: "electronics", label: "Electronics" },
		{ value: "general", label: "General" }
	];

	function getCategoryOptions() {
		const categoriesService = global.AdminCategoriesService;
		if (categoriesService && typeof categoriesService.getCategoryOptions === "function") {
			const options = categoriesService.getCategoryOptions();
			if (Array.isArray(options) && options.length) {
				return options;
			}
		}

		return DEFAULT_CATEGORY_OPTIONS.slice();
	}

	function getCatalogService() {
		return global.ByoseProductCatalog || null;
	}

	function getProducts() {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.getCatalog === "function"
			? catalogService.getCatalog()
			: [];
	}

	function init() {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.refreshCatalog === 'function'
			? catalogService.refreshCatalog({ silent: true, allowBootstrap: false })
			: Promise.resolve(getProducts());
	}

	function refresh(options) {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.refreshCatalog === 'function'
			? catalogService.refreshCatalog(options || {})
			: Promise.resolve(getProducts());
	}

	function getProductById(productId) {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.getProductById === "function"
			? catalogService.getProductById(productId)
			: null;
	}

	function createProduct(payload) {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.createProduct === "function"
			? catalogService.createProduct(payload)
			: null;
	}

	function updateProduct(productId, payload) {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.updateProduct === "function"
			? catalogService.updateProduct(productId, payload)
			: null;
	}

	function deleteProduct(productId) {
		const catalogService = getCatalogService();
		return catalogService && typeof catalogService.deleteProduct === "function"
			? catalogService.deleteProduct(productId)
			: false;
	}

	function formatCurrency(value) {
		const amount = Number(value || 0);
		return `RWF ${amount.toLocaleString("en-US")}`;
	}

	function formatDate(value) {
		if (!value) {
			return "No timestamp";
		}

		const date = new Date(value);
		if (Number.isNaN(date.getTime())) {
			return "No timestamp";
		}

		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit"
		}).format(date);
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function normalizeCategoryLabel(category) {
		return String(category || "general")
			.replace(/-/g, " ")
			.replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
	}

	function resolveStorefrontImagePath(path) {
		const value = String(path || "").trim();
		if (!value) {
			return "";
		}

		if (/^(?:https?:|data:|blob:|\/)/i.test(value)) {
			return value;
		}

		if (/^(?:\.\.\/|\.\/)/.test(value)) {
			return value;
		}

		return `../../${value.replace(/^\/+/, "")}`;
	}

	function uniqueStrings(values) {
		return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));
	}

	function parseParagraphs(value) {
		return String(value || "")
			.split(/\r?\n\s*\r?\n|\r?\n/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	function serializeParagraphs(values) {
		return Array.isArray(values) ? values.map((value) => String(value || "").trim()).filter(Boolean).join("\n") : "";
	}

	function normalizeEditorAttributes(attributes) {
		return Array.isArray(attributes)
			? attributes.map((attribute) => ({
				name: String(attribute?.name || "Option").trim() || "Option",
				type: String(attribute?.type || "text").trim() === "image" ? "image" : "text",
				options: Array.isArray(attribute?.options)
					? attribute.options.map((option) => ({
						value: String(option?.value || "").trim(),
						stock: Number(option?.stock || 0) || 0,
						image: String(option?.image || "").trim()
					})).filter((option) => option.value || option.image)
					: []
			}))
			: [];
	}

	function createAttributeTemplate(category) {
		const normalizedCategory = String(category || "general").toLowerCase();

		if (normalizedCategory === "shoes") {
			return [
				{
					name: "Color",
					type: "image",
					options: [{ value: "Default", stock: 0, image: "" }]
				},
				{
					name: "Size",
					type: "text",
					options: ["39", "40", "41", "42"].map((value) => ({ value, stock: 0, image: "" }))
				}
			];
		}

		if (normalizedCategory === "fashion") {
			return [
				{
					name: "Color",
					type: "image",
					options: [{ value: "Default", stock: 0, image: "" }]
				},
				{
					name: "Size",
					type: "text",
					options: ["S", "M", "L", "XL"].map((value) => ({ value, stock: 0, image: "" }))
				}
			];
		}

		if (normalizedCategory === "electronics") {
			return [
				{
					name: "Finish",
					type: "image",
					options: [{ value: "Default", stock: 0, image: "" }]
				},
				{
					name: "Variant",
					type: "text",
					options: [{ value: "Standard", stock: 0, image: "" }]
				}
			];
		}

		return [
			{
				name: "Option",
				type: "text",
				options: [{ value: "Default", stock: 0, image: "" }]
			}
		];
	}

	function parseLineList(value) {
		return String(value || "")
			.split(/\r?\n|,/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	function parseSpecs(value) {
		return String(value || "")
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => {
				const parts = entry.split(":");
				if (parts.length < 2) {
					return null;
				}

				return [parts[0].trim(), parts.slice(1).join(":").trim()];
			})
			.filter(Boolean);
	}

	function serializeSpecs(specs) {
		return Array.isArray(specs)
			? specs.map((entry) => `${entry[0]}: ${entry[1]}`).join("\n")
			: "";
	}

	function getFormValue(form, name) {
		const field = form.elements.namedItem(name);
		return field ? String(field.value || "").trim() : "";
	}

	function hasFormField(form, name) {
		return Boolean(form?.elements?.namedItem(name));
	}

	function readProductForm(form) {
		const name = getFormValue(form, "name");
		const category = getFormValue(form, "category") || "general";
		const price = Number(getFormValue(form, "price")) || 0;
		const oldPrice = Number(getFormValue(form, "oldPrice")) || 0;
		const stock = Number(getFormValue(form, "stock")) || 0;
		const badge = getFormValue(form, "badge");
		const mainImage = getFormValue(form, "mainImage");
		const gallery = parseLineList(getFormValue(form, "gallery"));
		const keywords = parseLineList(getFormValue(form, "keywords"));
		const shortDescription = getFormValue(form, "shortDescription");
		const longDescription = parseLineList(getFormValue(form, "longDescription"));
		const highlights = parseLineList(getFormValue(form, "highlights"));
		const trust = parseLineList(getFormValue(form, "trust"));
		const specs = parseSpecs(getFormValue(form, "specs"));

		const payload = {
			name,
			category,
			price,
			oldPrice,
			stock,
			badge,
			mainImage,
			image: mainImage,
			gallery,
			keywords,
			shortDescription,
			description: shortDescription,
			longDescription,
			highlights,
			trust,
			specs
		};

		if (hasFormField(form, "visibility")) {
			payload.visibility = getFormValue(form, "visibility") || "both";
		}

		if (hasFormField(form, "priority")) {
			payload.priority = getFormValue(form, "priority") || "normal";
		}

		if (hasFormField(form, "orderIndex")) {
			payload.orderIndex = Number(getFormValue(form, "orderIndex")) || 0;
		}

		if (hasFormField(form, "highlightTag")) {
			payload.highlightTag = getFormValue(form, "highlightTag");
		}

		return payload;
	}

	function populateProductForm(form, product) {
		if (!form || !product) {
			return;
		}

		function setFieldValue(name, value) {
			const field = form.elements.namedItem(name);
			if (field) {
				field.value = value;
			}
		}

		setFieldValue("name", product.name || "");
		setFieldValue("category", product.category || "general");
		setFieldValue("price", Number(product.price || 0));
		setFieldValue("oldPrice", Number(product.oldPrice || 0));
		setFieldValue("stock", Number(product.stock || 0));
		setFieldValue("badge", product.badge || "");
		setFieldValue("visibility", product.visibility || "both");
		setFieldValue("priority", product.priority || "normal");
		setFieldValue("orderIndex", Number(product.orderIndex || 0));
		setFieldValue("highlightTag", product.highlightTag || "");
		setFieldValue("mainImage", product.mainImage || product.image || "");
		setFieldValue("gallery", Array.isArray(product.gallery) ? product.gallery.join("\n") : "");
		setFieldValue("keywords", Array.isArray(product.keywords) ? product.keywords.join(", ") : "");
		setFieldValue("shortDescription", product.shortDescription || product.description || "");
		setFieldValue("longDescription", Array.isArray(product.longDescription) ? product.longDescription.join("\n") : "");
		setFieldValue("highlights", Array.isArray(product.highlights) ? product.highlights.join("\n") : "");
		setFieldValue("trust", Array.isArray(product.trust) ? product.trust.join("\n") : "");
		setFieldValue("specs", serializeSpecs(product.specs));
	}

	function getProductIdFromLocation() {
		const params = new URLSearchParams(global.location.search);
		return Number(params.get("id") || 0) || null;
	}

	function filterProducts(options) {
		const config = options || {};
		const query = String(config.query || "").trim().toLowerCase();
		const category = String(config.category || "all").trim().toLowerCase();

		return getProducts()
			.filter((product) => {
				if (category !== "all" && String(product.category || "").toLowerCase() !== category) {
					return false;
				}

				if (!query) {
					return true;
				}

				const haystack = [
					product.name,
					product.category,
					product.badge,
					product.shortDescription,
					Array.isArray(product.keywords) ? product.keywords.join(" ") : ""
				].join(" ").toLowerCase();

				return haystack.includes(query);
			})
			.sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
	}

	function getStats(products) {
		const list = Array.isArray(products) ? products : getProducts();
		const totalStock = list.reduce((sum, product) => sum + Number(product.stock || 0), 0);
		const lowStock = list.filter((product) => Number(product.stock || 0) <= 5).length;
		const totalValue = list.reduce((sum, product) => sum + (Number(product.price || 0) * Number(product.stock || 0)), 0);
		const activeCategories = new Set(list.map((product) => String(product.category || "general").toLowerCase())).size;

		return {
			totalProducts: list.length,
			totalStock,
			lowStock,
			totalValue,
			activeCategories
		};
	}

	global.AdminProductsService = {
		CATEGORY_OPTIONS: DEFAULT_CATEGORY_OPTIONS,
		EVENT_NAME: global.ByoseProductCatalog?.EVENT_NAME || 'byose:products-changed',
		createAttributeTemplate,
		createProduct,
		deleteProduct,
		escapeHtml,
		filterProducts,
		formatCurrency,
		formatDate,
		getCategoryOptions,
		getProductById,
		getProductIdFromLocation,
		getProducts,
		getStats,
		init,
		normalizeEditorAttributes,
		normalizeCategoryLabel,
		parseParagraphs,
		populateProductForm,
		refresh,
		readProductForm,
		resolveStorefrontImagePath,
		serializeSpecs,
		serializeParagraphs,
		uniqueStrings,
		updateProduct
	};
})(window);
