(async function () {
	const sidebar = window.AdminSidebar;
	const service = window.AdminProductsService;
	const imagePicker = window.AdminImagePicker;
	const repeaterApi = window.AdminFormRepeater;

	if (sidebar && typeof sidebar.init === 'function') {
		sidebar.init();
	}

	if (!service || !imagePicker || !repeaterApi) {
		return;
	}

	try {
		await service.init?.();
	} catch (error) {
		const statusNode = document.getElementById('productEditorStatus');
		if (statusNode) {
			statusNode.textContent = error?.message || 'Unable to load the centralized catalog right now.';
			statusNode.dataset.state = 'error';
		}
	}

	const productId = service.getProductIdFromLocation();
	const product = service.getProductById(productId);
	const form = document.getElementById('productEditorForm');
	const status = document.getElementById('productEditorStatus');
	const preview = document.getElementById('productEditorPreview');
	const title = document.getElementById('productEditorTitle');
	const subtitle = document.getElementById('productEditorSubtitle');
	const saveProductButton = document.getElementById('saveProductButton');
	const openEditedProductButton = document.getElementById('openEditedProductButton');
	const categorySelect = document.getElementById('productCategorySelect');
	const mainImageInput = document.getElementById('mainImageInput');
	const mainImagePreview = document.getElementById('mainImagePreview');
	const mainImageUploadInput = document.getElementById('mainImageUploadInput');
	const galleryManager = document.getElementById('galleryManager');
	const galleryUploadInput = document.getElementById('galleryUploadInput');
	const galleryPathInput = document.getElementById('galleryPathInput');
	const addGalleryPathButton = document.getElementById('addGalleryPathButton');
	const attributeGroups = document.getElementById('attributeGroups');
	const addAttributeGroupButton = document.getElementById('addAttributeGroupButton');
	const resetAttributesButton = document.getElementById('resetAttributesButton');
	const attributeSectionHint = document.getElementById('attributeSectionHint');
	const keywordsInput = document.getElementById('keywordsInput');
	const shortDescriptionInput = document.getElementById('shortDescriptionInput');
	const longDescriptionInput = document.getElementById('longDescriptionInput');

	function populateCategoryOptions() {
		if (!categorySelect || typeof service.getCategoryOptions !== 'function') {
			return;
		}

		const options = service.getCategoryOptions();
		const currentValue = String(product?.category || categorySelect.value || 'general');
		categorySelect.innerHTML = options.map((option) => `<option value="${service.escapeHtml(option.value)}">${service.escapeHtml(option.label)}</option>`).join('');
		categorySelect.value = options.some((option) => option.value === currentValue) ? currentValue : (options[0]?.value || 'general');
	}

	populateCategoryOptions();

	if (!product) {
		status.textContent = 'The selected product could not be found in the shared catalog.';
		status.dataset.state = 'error';
		form.hidden = true;
		if (openEditedProductButton) {
			openEditedProductButton.hidden = true;
		}
		return;
	}

	const state = {
		productId: Number(product.id),
		mainImage: String(product.mainImage || product.image || '').trim(),
		gallery: service.uniqueStrings(Array.isArray(product.gallery) ? product.gallery : []),
		attributes: Array.isArray(product.attributes) && product.attributes.length
			? product.attributes
			: service.createAttributeTemplate(product.category),
		previousCategory: String(product.category || 'general')
	};

	function createEmptyOption(value = '') {
		return {
			value: String(value || '').trim(),
			stock: 0,
			image: ''
		};
	}

	function createEmptyAttribute(name = 'New Attribute', type = 'text') {
		return {
			name,
			type: type === 'image' ? 'image' : 'text',
			options: []
		};
	}

	function normalizeEditableAttributes(attributes) {
		return Array.isArray(attributes)
			? attributes.map((attribute) => ({
				name: String(attribute?.name || '').trim(),
				type: String(attribute?.type || 'text').trim() === 'image' ? 'image' : 'text',
				options: Array.isArray(attribute?.options)
					? attribute.options.map((option) => ({
						value: String(option?.value || '').trim(),
						stock: Math.max(0, Number(option?.stock || 0) || 0),
						image: String(option?.image || '').trim()
					}))
					: []
			}))
			: [];
	}

	function buildCleanAttributesForSave(attributes) {
		return normalizeEditableAttributes(attributes)
			.map((attribute) => ({
				name: attribute.name,
				type: attribute.type,
				options: attribute.options.filter((option) => option.value)
			}))
			.filter((attribute) => attribute.name && attribute.options.length);
	}

	function parseBulkValues(value) {
		return service.uniqueStrings(String(value || '').split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean));
	}

	function getAttributeSuggestions(category, attributeName) {
		const normalizedCategory = String(category || 'general').toLowerCase();
		const normalizedName = String(attributeName || '').toLowerCase();

		if (/color|colour|finish/.test(normalizedName)) {
			if (normalizedCategory === 'electronics') {
				return ['Black', 'Silver', 'White', 'Blue'];
			}
			return ['Black', 'White', 'Red', 'Blue'];
		}

		if (/size|shoe|foot/.test(normalizedName)) {
			if (normalizedCategory === 'shoes') {
				return ['39', '40', '41', '42', '43', '44'];
			}
			if (normalizedCategory === 'fashion') {
				return ['S', 'M', 'L', 'XL'];
			}
			return ['Standard'];
		}

		if (/material/.test(normalizedName)) {
			return ['Leather', 'Cotton', 'Mesh', 'Synthetic'];
		}

		if (/variant|storage|capacity|memory|ram/.test(normalizedName)) {
			return ['64GB', '128GB', '256GB'];
		}

		return [];
	}

	const highlightsRepeater = repeaterApi.createTextRepeater({
		container: document.getElementById('highlightsRepeater'),
		addButton: document.getElementById('addHighlightButton'),
		placeholder: 'Highlight text',
		emptyText: 'No highlight items yet.',
		values: Array.isArray(product.highlights) ? product.highlights : []
	});

	const trustRepeater = repeaterApi.createTextRepeater({
		container: document.getElementById('trustRepeater'),
		addButton: document.getElementById('addTrustButton'),
		placeholder: 'Trust message',
		emptyText: 'No trust items yet.',
		values: Array.isArray(product.trust) ? product.trust : []
	});

	const specsRepeater = repeaterApi.createKeyValueRepeater({
		container: document.getElementById('specsRepeater'),
		addButton: document.getElementById('addSpecButton'),
		keyPlaceholder: 'Label',
		valuePlaceholder: 'Value',
		emptyText: 'No specifications yet.',
		values: Array.isArray(product.specs) ? product.specs : []
	});

	title.textContent = `Edit ${product.name}`;
	subtitle.textContent = `Product ID ${product.id} controls both storefront cards and the full details page.`;
	if (saveProductButton) {
		saveProductButton.textContent = 'Save changes';
	}
	if (openEditedProductButton) {
		openEditedProductButton.href = `view.html?id=${encodeURIComponent(product.id)}`;
	}
	service.populateProductForm(form, product);
	keywordsInput.value = Array.isArray(product.keywords) ? product.keywords.join(', ') : '';
	shortDescriptionInput.value = product.shortDescription || product.description || '';
	longDescriptionInput.value = service.serializeParagraphs(product.longDescription);
	mainImageInput.value = state.mainImage;

	function resolvePreviewImage(path) {
		return service.resolveStorefrontImagePath(path || '') || '../../img/logo.png';
	}

	function refreshMainImagePreview() {
		mainImagePreview.src = resolvePreviewImage(state.mainImage || mainImageInput.value);
	}

	function getCategoryHint(category) {
		const normalized = String(category || 'general').toLowerCase();
		if (normalized === 'shoes') {
			return 'Shoes usually use numeric sizes plus a color selector.';
		}
		if (normalized === 'fashion') {
			return 'Clothes and fashion products usually use size options like S, M, L, XL plus colors.';
		}
		if (normalized === 'electronics') {
			return 'Electronics usually use finish, color, storage, or variant attributes instead of sizes.';
		}
		return 'General products can use any custom option set.';
	}

	function createOptionMarkup(groupIndex, option, optionIndex, type) {
		const previewSrc = resolvePreviewImage(option.image || state.mainImage);
		return `
			<div class="editor-option-row" data-option-index="${groupIndex}:${optionIndex}">
				<div class="editor-option-fields">
					<label>
						<span>Value</span>
						<input type="text" data-option-field="value" value="${service.escapeHtml(option.value)}" placeholder="Option value">
					</label>
					<label>
						<span>Stock</span>
						<input type="number" min="0" step="1" data-option-field="stock" value="${Number(option.stock || 0)}">
					</label>
					${type === 'image' ? `
						<label class="editor-option-image-path">
							<span>Image</span>
							<input type="text" data-option-field="image" value="${service.escapeHtml(option.image || '')}" placeholder="Image path or uploaded image">
						</label>
					` : ''}
				</div>
				${type === 'image' ? `
					<div class="editor-option-image-tools">
						<img src="${service.escapeHtml(previewSrc)}" alt="${service.escapeHtml(option.value || 'Option preview')}">
						<label class="products-secondary-link products-file-button" for="option-upload-${groupIndex}-${optionIndex}"><i class="fa-solid fa-upload"></i><span>Upload</span></label>
						<input id="option-upload-${groupIndex}-${optionIndex}" type="file" accept="image/*" data-option-upload="${groupIndex}:${optionIndex}" hidden>
					</div>
				` : ''}
				<button type="button" class="editor-option-remove" data-remove-option="${groupIndex}:${optionIndex}" aria-label="Remove option">
					<i class="fa-solid fa-trash"></i>
				</button>
			</div>
		`;
	}

	function renderAttributeGroups() {
		state.attributes = normalizeEditableAttributes(state.attributes);
		attributeSectionHint.textContent = getCategoryHint(categorySelect.value);

		attributeGroups.innerHTML = state.attributes.map((attribute, groupIndex) => `
			<section class="editor-attribute-card">
				<div class="editor-attribute-head">
					<div class="editor-attribute-meta">
						<span class="editor-attribute-title">${service.escapeHtml(attribute.name || `Attribute ${groupIndex + 1}`)}</span>
						<span class="editor-attribute-count">${attribute.options.length} option${attribute.options.length === 1 ? '' : 's'}</span>
					</div>
					<div class="editor-attribute-grid">
						<label>
							<span>Attribute Name</span>
							<input type="text" data-attribute-field="name" data-group-index="${groupIndex}" value="${service.escapeHtml(attribute.name)}" placeholder="Color, Size, Material...">
						</label>
						<label>
							<span>Display Type</span>
							<select data-attribute-field="type" data-group-index="${groupIndex}">
								<option value="text"${attribute.type === 'text' ? ' selected' : ''}>Text options</option>
								<option value="image"${attribute.type === 'image' ? ' selected' : ''}>Image options</option>
							</select>
						</label>
					</div>
					<div class="editor-header-actions">
						<button class="products-secondary-link" type="button" data-add-option="${groupIndex}">Add Option</button>
						<button class="products-secondary-link editor-destructive-link" type="button" data-remove-group="${groupIndex}">Remove Attribute</button>
					</div>
				</div>
				<div class="editor-quick-add" data-bulk-add-group="${groupIndex}">
					<input type="text" data-bulk-add-input="${groupIndex}" placeholder="Add multiple options: Black, Red, Blue">
					<button class="products-secondary-link" type="button" data-bulk-add-button="${groupIndex}">Add Values</button>
				</div>
				${getAttributeSuggestions(categorySelect.value, attribute.name).length ? `
					<div class="editor-suggestion-list">
						${getAttributeSuggestions(categorySelect.value, attribute.name).map((value) => `
							<button class="editor-suggestion-chip" type="button" data-suggest-option="${groupIndex}" data-suggest-value="${service.escapeHtml(value)}">${service.escapeHtml(value)}</button>
						`).join('')}
					</div>
				` : ''}
				<div class="editor-option-list">
					${attribute.options.length
						? attribute.options.map((option, optionIndex) => createOptionMarkup(groupIndex, option, optionIndex, attribute.type)).join('')
						: '<div class="editor-option-empty">No options yet. Add one or paste multiple values above.</div>'}
				</div>
			</section>
		`).join('');
	}

	function updateOptionPreview(groupIndex, optionIndex) {
		const option = state.attributes?.[groupIndex]?.options?.[optionIndex];
		const row = attributeGroups.querySelector(`[data-option-index="${groupIndex}:${optionIndex}"]`);
		const previewImage = row?.querySelector('.editor-option-image-tools img');
		const imageInput = row?.querySelector('[data-option-field="image"]');
		if (imageInput) {
			imageInput.value = option?.image || '';
		}
		if (previewImage) {
			previewImage.src = resolvePreviewImage(option?.image || state.mainImage);
			previewImage.alt = option?.value || 'Option preview';
		}
	}

	function addOptionValues(groupIndex, values) {
		const nextValues = Array.isArray(values) ? values : [];
		if (!nextValues.length || !state.attributes[groupIndex]) {
			return;
		}

		const existingValues = new Set(
			(state.attributes[groupIndex].options || []).map((option) => String(option.value || '').trim().toLowerCase()).filter(Boolean)
		);

		nextValues.forEach((value) => {
			const normalizedValue = String(value || '').trim();
			if (!normalizedValue || existingValues.has(normalizedValue.toLowerCase())) {
				return;
			}
			existingValues.add(normalizedValue.toLowerCase());
			state.attributes[groupIndex].options.push(createEmptyOption(normalizedValue));
		});

		renderAttributeGroups();
		renderPreview();
	}

	function renderGalleryManager() {
		const gallery = service.uniqueStrings(state.gallery.filter(Boolean));
		state.gallery = gallery;

		if (!gallery.length) {
			galleryManager.innerHTML = '<div class="editor-gallery-empty">No gallery images yet. Add images to update the product details page.</div>';
			return;
		}

		galleryManager.innerHTML = gallery.map((image, index) => `
			<article class="editor-gallery-card">
				<img src="${service.escapeHtml(resolvePreviewImage(image))}" alt="Gallery image ${index + 1}">
				<div class="editor-gallery-card__body">
					<label>
						<span>Image ${index + 1}</span>
						<input type="text" value="${service.escapeHtml(image)}" data-gallery-input="${index}">
					</label>
					<div class="editor-gallery-card__actions">
						<label class="products-secondary-link products-file-button" for="gallery-replace-${index}"><i class="fa-solid fa-rotate"></i><span>Replace</span></label>
						<input id="gallery-replace-${index}" type="file" accept="image/*" data-gallery-replace="${index}" hidden>
						<button class="products-secondary-link editor-destructive-link" type="button" data-gallery-remove="${index}">Delete</button>
					</div>
				</div>
			</article>
		`).join('');
	}

	function buildPayload() {
		const raw = service.readProductForm(form);
		const gallery = service.uniqueStrings([state.mainImage || raw.mainImage, ...state.gallery]);
		const attributes = buildCleanAttributesForSave(state.attributes);

		return {
			...raw,
			mainImage: state.mainImage || raw.mainImage,
			image: state.mainImage || raw.mainImage,
			gallery,
			keywords: String(keywordsInput.value || '').split(',').map((entry) => entry.trim()).filter(Boolean),
			longDescription: service.parseParagraphs(longDescriptionInput.value),
			highlights: highlightsRepeater.getValues(),
			trust: trustRepeater.getValues(),
			specs: specsRepeater.getValues(),
			attributes
		};
	}

	function renderPreview() {
		const payload = buildPayload();
		const displayImage = resolvePreviewImage(payload.mainImage);
		const oldPriceMarkup = Number(payload.oldPrice || 0) > Number(payload.price || 0)
			? `<span class="product-preview-old-price">${service.formatCurrency(payload.oldPrice)}</span>`
			: '';
		const shortDescription = payload.shortDescription || product.shortDescription || product.description || 'This product preview updates live while you edit the storefront card.';

		preview.innerHTML = `
			<div class="product-preview-stack">
				<section class="product-preview-card">
					<img src="${service.escapeHtml(displayImage)}" alt="${service.escapeHtml(payload.name || product.name)}">
					<div>
						<p class="product-preview-eyebrow">Front Display Preview</p>
						<h3>${service.escapeHtml(payload.name || product.name)}</h3>
						<p>${service.escapeHtml(shortDescription)}</p>
						<div class="product-preview-meta">
							<span>${service.escapeHtml(service.normalizeCategoryLabel(payload.category || product.category || 'general'))}</span>
							<div class="product-preview-price-group">
								<strong>${service.formatCurrency(payload.price || product.price || 0)}</strong>
								${oldPriceMarkup}
							</div>
						</div>
						${payload.badge ? `<span class="product-preview-badge">${service.escapeHtml(payload.badge)}</span>` : ''}
					</div>
				</section>

				<section class="product-preview-card product-preview-card--detail">
					<div>
						<p class="product-preview-eyebrow">Details Page Preview</p>
						<h3>${service.escapeHtml(payload.name || product.name)}</h3>
						<ul class="product-preview-detail-list">
							<li><span>Gallery images</span><strong>${payload.gallery.length}</strong></li>
							<li><span>Attribute groups</span><strong>${payload.attributes.length}</strong></li>
							<li><span>Highlights</span><strong>${payload.highlights.length}</strong></li>
							<li><span>Specs</span><strong>${payload.specs.length}</strong></li>
						</ul>
					</div>
					<div class="product-preview-gallery-strip">
						${payload.gallery.slice(0, 4).map((image) => `<img src="${service.escapeHtml(resolvePreviewImage(image))}" alt="Gallery preview">`).join('') || '<div class="editor-gallery-empty">No gallery images yet.</div>'}
					</div>
				</section>
			</div>
		`;
	}

	function refreshEverything() {
		refreshMainImagePreview();
		renderGalleryManager();
		renderAttributeGroups();
		renderPreview();
	}

	function applyCategoryTemplate() {
		state.attributes = service.createAttributeTemplate(categorySelect.value);
		refreshEverything();
	}

	mainImageInput.addEventListener('input', () => {
		state.mainImage = String(mainImageInput.value || '').trim();
		refreshMainImagePreview();
		renderPreview();
	});

	mainImageUploadInput.addEventListener('change', async () => {
		const file = mainImageUploadInput.files && mainImageUploadInput.files[0];
		if (!file) {
			return;
		}

		const result = await imagePicker.readFileAsDataUrl(file);
		state.mainImage = result.dataUrl;
		mainImageInput.value = result.dataUrl;
		refreshEverything();
		mainImageUploadInput.value = '';
	});

	galleryUploadInput.addEventListener('change', async () => {
		const files = galleryUploadInput.files;
		if (!files || !files.length) {
			return;
		}

		const uploaded = await imagePicker.readFilesAsDataUrls(files);
		state.gallery = service.uniqueStrings(state.gallery.concat(uploaded.map((entry) => entry.dataUrl)));
		refreshEverything();
		galleryUploadInput.value = '';
	});

	addGalleryPathButton.addEventListener('click', () => {
		const value = String(galleryPathInput.value || '').trim();
		if (!value) {
			return;
		}

		state.gallery = service.uniqueStrings(state.gallery.concat(value));
		galleryPathInput.value = '';
		refreshEverything();
	});

	galleryManager.addEventListener('input', (event) => {
		const input = event.target.closest('[data-gallery-input]');
		if (!input) {
			return;
		}

		const index = Number(input.dataset.galleryInput || 0);
		state.gallery[index] = String(input.value || '').trim();
		refreshEverything();
	});

	galleryManager.addEventListener('click', (event) => {
		const removeButton = event.target.closest('[data-gallery-remove]');
		if (!removeButton) {
			return;
		}

		const index = Number(removeButton.dataset.galleryRemove || 0);
		state.gallery.splice(index, 1);
		refreshEverything();
	});

	galleryManager.addEventListener('change', async (event) => {
		const input = event.target.closest('[data-gallery-replace]');
		if (!input || !input.files || !input.files[0]) {
			return;
		}

		const index = Number(input.dataset.galleryReplace || 0);
		const result = await imagePicker.readFileAsDataUrl(input.files[0]);
		state.gallery[index] = result.dataUrl;
		refreshEverything();
		input.value = '';
	});

	categorySelect.addEventListener('change', () => {
		const nextCategory = String(categorySelect.value || 'general');
		if (state.previousCategory === nextCategory) {
			attributeSectionHint.textContent = getCategoryHint(nextCategory);
			renderPreview();
			return;
		}

		const confirmed = window.confirm('Change category template and adapt attributes for this product?');
		if (confirmed) {
			state.previousCategory = nextCategory;
			applyCategoryTemplate();
			return;
		}

		categorySelect.value = state.previousCategory;
	});

	resetAttributesButton.addEventListener('click', applyCategoryTemplate);
	addAttributeGroupButton.addEventListener('click', () => {
		state.attributes.push(createEmptyAttribute());
		renderAttributeGroups();
		renderPreview();
	});

	attributeGroups.addEventListener('input', (event) => {
		const groupField = event.target.closest('[data-group-index][data-attribute-field]');
		if (groupField) {
			const groupIndex = Number(groupField.dataset.groupIndex || 0);
			const field = groupField.dataset.attributeField;
			state.attributes[groupIndex][field] = field === 'type' ? String(groupField.value || 'text') : String(groupField.value || '').trim();
			if (field === 'type') {
				renderAttributeGroups();
				renderPreview();
				return;
			}
			const card = groupField.closest('.editor-attribute-card');
			const titleNode = card?.querySelector('.editor-attribute-title');
			if (titleNode && field === 'name') {
				titleNode.textContent = state.attributes[groupIndex][field] || `Attribute ${groupIndex + 1}`;
			}
			renderPreview();
			return;
		}

		const bulkInput = event.target.closest('[data-bulk-add-input]');
		if (bulkInput) {
			return;
		}

		const optionField = event.target.closest('[data-option-field]');
		if (!optionField) {
			return;
		}

		const optionRow = optionField.closest('[data-option-index]');
		if (!optionRow) {
			return;
		}

		const [groupIndex, optionIndex] = optionRow.dataset.optionIndex.split(':').map(Number);
		const field = optionField.dataset.optionField;
		state.attributes[groupIndex].options[optionIndex][field] = field === 'stock'
			? Math.max(0, Number(optionField.value || 0) || 0)
			: String(optionField.value || '').trim();
		if (field === 'image') {
			updateOptionPreview(groupIndex, optionIndex);
		}
		if (field === 'value') {
			updateOptionPreview(groupIndex, optionIndex);
		}
		renderPreview();
	});

	attributeGroups.addEventListener('keydown', (event) => {
		const bulkInput = event.target.closest('[data-bulk-add-input]');
		if (!bulkInput || event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		const groupIndex = Number(bulkInput.dataset.bulkAddInput || 0);
		const values = parseBulkValues(bulkInput.value);
		addOptionValues(groupIndex, values);
		bulkInput.value = '';
	});

	attributeGroups.addEventListener('click', (event) => {
		const bulkAddButton = event.target.closest('[data-bulk-add-button]');
		if (bulkAddButton) {
			const groupIndex = Number(bulkAddButton.dataset.bulkAddButton || 0);
			const input = attributeGroups.querySelector(`[data-bulk-add-input="${groupIndex}"]`);
			const values = parseBulkValues(input?.value);
			addOptionValues(groupIndex, values);
			if (input) {
				input.value = '';
			}
			return;
		}

		const suggestionButton = event.target.closest('[data-suggest-option]');
		if (suggestionButton) {
			const groupIndex = Number(suggestionButton.dataset.suggestOption || 0);
			addOptionValues(groupIndex, [suggestionButton.dataset.suggestValue || '']);
			return;
		}

		const addOptionButton = event.target.closest('[data-add-option]');
		if (addOptionButton) {
			const groupIndex = Number(addOptionButton.dataset.addOption || 0);
			state.attributes[groupIndex].options.push(createEmptyOption());
			renderAttributeGroups();
			renderPreview();
			return;
		}

		const removeGroupButton = event.target.closest('[data-remove-group]');
		if (removeGroupButton) {
			const groupIndex = Number(removeGroupButton.dataset.removeGroup || 0);
			state.attributes.splice(groupIndex, 1);
			renderAttributeGroups();
			renderPreview();
			return;
		}

		const removeOptionButton = event.target.closest('[data-remove-option]');
		if (removeOptionButton) {
			const [groupIndex, optionIndex] = String(removeOptionButton.dataset.removeOption || '0:0').split(':').map(Number);
			state.attributes[groupIndex].options.splice(optionIndex, 1);
			renderAttributeGroups();
			renderPreview();
		}
	});

	attributeGroups.addEventListener('change', async (event) => {
		const uploadInput = event.target.closest('[data-option-upload]');
		if (!uploadInput || !uploadInput.files || !uploadInput.files[0]) {
			return;
		}

		const [groupIndex, optionIndex] = String(uploadInput.dataset.optionUpload || '0:0').split(':').map(Number);
		const result = await imagePicker.readFileAsDataUrl(uploadInput.files[0]);
		state.attributes[groupIndex].options[optionIndex].image = result.dataUrl;
		updateOptionPreview(groupIndex, optionIndex);
		renderPreview();
		uploadInput.value = '';
	});

	form.addEventListener('input', renderPreview);
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const payload = buildPayload();

		if (!payload.name || !payload.mainImage || Number(payload.price) <= 0) {
			status.textContent = 'Product name, main image, and a valid price are required.';
			status.dataset.state = 'error';
			return;
		}

		saveProductButton.disabled = true;
		saveProductButton.textContent = 'Saving...';
		status.textContent = 'Saving product changes to the live website catalog...';
		status.dataset.state = '';

		try {
			const updated = await service.updateProduct(product.id, payload);
			status.textContent = `${updated.name} details were saved across the website and product details system.`;
			status.dataset.state = 'success';
			if (openEditedProductButton) {
				openEditedProductButton.href = `view.html?id=${encodeURIComponent(updated.id)}`;
			}
		} catch (error) {
			status.textContent = error?.message || 'The product details could not be saved.';
			status.dataset.state = 'error';
		} finally {
			saveProductButton.disabled = false;
			saveProductButton.textContent = 'Save changes';
		}
	});

	refreshEverything();
})();
