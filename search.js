(function () {
  document.addEventListener('DOMContentLoaded', async () => {
    const utils = window.ByoseSearchUtils;
    const shopApi = window.ByoseShop;
    const searchApi = window.ByoseStorefrontSearch;
    const imageApi = window.ByoseImageSearch;
    const productCatalog = window.ByoseProductCatalog;

    const elements = {
      form: document.getElementById('searchPageForm'),
      input: document.getElementById('searchPageInput'),
      suggestions: document.getElementById('searchSuggestions'),
      discovery: document.getElementById('searchDiscovery'),
      popularSearches: document.getElementById('popularSearches'),
      recentSearches: document.getElementById('recentSearches'),
      recentSearchesGroup: document.getElementById('recentSearchesGroup'),
      clearRecentSearches: document.getElementById('clearRecentSearches'),
      emptyState: document.getElementById('searchEmptyState'),
      filtersBar: document.getElementById('searchFiltersBar'),
      categoryFilters: document.getElementById('searchCategoryFilters'),
      resultsSection: document.getElementById('searchResultsSection'),
      results: document.getElementById('searchResults'),
      resultsSummary: document.getElementById('searchResultsSummary'),
      resultsTitle: document.getElementById('search-results-title'),
      emptyRelated: document.getElementById('searchEmptyRelated'),
      imageTrigger: document.getElementById('imageSearchTrigger'),
      imageInputCamera: document.getElementById('imageSearchInputCamera'),
      imageInputGallery: document.getElementById('imageSearchInputGallery'),
      imageInputFiles: document.getElementById('imageSearchInputFiles'),
      visualSearchPicker: document.getElementById('visualSearchPicker'),
      visualSearchPickerBackdrop: document.getElementById('visualSearchPickerBackdrop'),
      visualSearchPickerClose: document.getElementById('visualSearchPickerClose'),
      visualSearchPickerOptions: document.querySelectorAll('.visual-search-picker__option'),
      visualPanel: document.getElementById('visualSearchPanel'),
      imagePreview: document.getElementById('imageSearchPreview'),
      imagePreviewShell: document.getElementById('imageSearchPreviewShell'),
      imageStatus: document.getElementById('imageSearchStatus'),
      imageChips: document.getElementById('imageSearchChips'),
      imageTitle: document.getElementById('imageSearchTitle'),
      imageReset: document.getElementById('imageSearchReset')
    };

    if (!utils || !shopApi || !searchApi || !imageApi || !elements.form || !elements.input || !elements.results) {
      return;
    }

    const state = {
      activeImageAnalysis: null,
      activeImageFile: null,
      catalog: [],
      panelHideTimer: null,
      searchRequestId: 0,
      suggestionRequestId: 0,
      activeCategory: 'all',
      lastResults: [],
      lastRelatedCategories: [],
      lastSuggestedSearches: [],
      lastRenderOptions: {},
      suggestionsVisible: false,
      activeSuggestionIndex: -1,
      searchDebounceTimer: null,
      suggestionDebounceTimer: null,
      searchAbortController: null,
      suggestionAbortController: null
    };

    const VISUAL_PANEL_TRANSITION_MS = 220;
    const SEARCH_DEBOUNCE_MS = 200;
    const SUGGESTION_DEBOUNCE_MS = 120;
    const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
    const ACCEPTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
    const DEFAULT_CATEGORY = 'all';
    const SKELETON_COUNT = 6;

    function getCatalogSnapshot() {
      if (productCatalog && typeof productCatalog.getStorefrontCatalog === 'function') {
        return productCatalog.getStorefrontCatalog();
      }

      return Array.isArray(window.products) ? window.products.slice() : [];
    }

    function mapSearchProducts(products) {
      return (Array.isArray(products) ? products : []).map((product, index) => shopApi.normalizeProduct(product, index));
    }

    function updateUrl(query) {
      const url = new URL(window.location.href);
      if (query) {
        url.searchParams.set('q', query);
      } else {
        url.searchParams.delete('q');
      }
      window.history.replaceState({}, '', url);
    }

    function setResultsTitle(title) {
      if (elements.resultsTitle) {
        elements.resultsTitle.textContent = title;
      }
    }

    function showDiscovery() {
      if (elements.discovery) {
        elements.discovery.hidden = false;
      }
    }

    function hideDiscovery() {
      if (elements.discovery) {
        elements.discovery.hidden = true;
      }
    }

    function showEmptyState() {
      if (elements.emptyState) {
        elements.emptyState.hidden = false;
      }
      showDiscovery();
    }

    function hideEmptyState() {
      if (elements.emptyState) {
        elements.emptyState.hidden = true;
      }
    }

    function hideCategoryFilters() {
      if (elements.filtersBar) {
        elements.filtersBar.hidden = true;
      }
      if (elements.categoryFilters) {
        elements.categoryFilters.innerHTML = '';
      }
    }

    function hideEmptyRelated() {
      if (elements.emptyRelated) {
        elements.emptyRelated.hidden = true;
        elements.emptyRelated.innerHTML = '';
      }
    }

    function hideResults() {
      elements.results.innerHTML = '';
      if (elements.resultsSummary) {
        elements.resultsSummary.textContent = '';
      }
      if (elements.resultsSection) {
        elements.resultsSection.hidden = true;
      }
      hideCategoryFilters();
      hideEmptyRelated();
      state.lastResults = [];
      state.lastRelatedCategories = [];
      state.activeCategory = DEFAULT_CATEGORY;
    }

    function renderSkeletonGrid() {
      hideEmptyState();
      hideDiscovery();
      if (elements.resultsSection) {
        elements.resultsSection.hidden = false;
      }

      elements.results.classList.add('byose-product-grid', 'byose-product-grid--storefront');
      elements.results.innerHTML = Array.from({ length: SKELETON_COUNT }, () => `
        <article class="byose-product-card byose-product-card--skeleton" aria-hidden="true">
          <div class="byose-skeleton-image"></div>
          <div class="byose-product-content">
            <div class="byose-skeleton-line byose-skeleton-line--title"></div>
            <div class="byose-skeleton-line byose-skeleton-line--price"></div>
          </div>
        </article>
      `).join('');
    }

    function renderSearchChip(label, iconClass) {
      return `
        <button type="button" class="search-chip" data-query="${utils.escapeHtml(label)}">
          ${iconClass ? `<i class="${iconClass}" aria-hidden="true"></i>` : ''}
          <span>${utils.escapeHtml(label)}</span>
        </button>
      `;
    }

    function bindSearchChips(container, handler) {
      if (!container) {
        return;
      }

      container.querySelectorAll('.search-chip').forEach((button) => {
        button.addEventListener('click', () => {
          const query = String(button.dataset.query || '').trim();
          if (!query) {
            return;
          }
          handler(query);
        });
      });
    }

    function renderPopularSearches(terms) {
      if (!elements.popularSearches) {
        return;
      }

      const items = Array.isArray(terms) && terms.length ? terms : ['Shoes', 'Phones', 'Fashion', 'Bags', 'Electronics'];
      elements.popularSearches.innerHTML = items
        .map((term) => renderSearchChip(String(term).replace(/\b\w/g, (char) => char.toUpperCase()), 'fa-solid fa-arrow-trend-up'))
        .join('');

      bindSearchChips(elements.popularSearches, (query) => {
        elements.input.value = query;
        hideSuggestions();
        runTextSearch(query, { immediate: true });
      });
    }

    function renderRecentSearchChip(term) {
      return `
        <span class="search-chip search-chip--recent">
          <button type="button" class="search-chip__action" data-query="${utils.escapeHtml(term)}">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
            <span>${utils.escapeHtml(term)}</span>
          </button>
          <button type="button" class="search-chip__remove" data-remove-query="${utils.escapeHtml(term)}" aria-label="Remove ${utils.escapeHtml(term)} from recent searches">&times;</button>
        </span>
      `;
    }

    function renderRecentSearches() {
      const recent = searchApi.readRecentSearches();

      if (!elements.recentSearches || !elements.recentSearchesGroup) {
        return;
      }

      if (!recent.length) {
        elements.recentSearchesGroup.hidden = true;
        elements.recentSearches.innerHTML = '';
        return;
      }

      elements.recentSearchesGroup.hidden = false;
      elements.recentSearches.innerHTML = recent.map((term) => renderRecentSearchChip(term)).join('');

      elements.recentSearches.querySelectorAll('.search-chip__action').forEach((button) => {
        button.addEventListener('click', () => {
          const query = String(button.dataset.query || '').trim();
          elements.input.value = query;
          hideSuggestions();
          runTextSearch(query, { immediate: true });
        });
      });

      elements.recentSearches.querySelectorAll('.search-chip__remove').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          searchApi.removeRecentSearch(button.dataset.removeQuery || '');
          renderRecentSearches();
        });
      });
    }

    async function loadPopularSearches() {
      try {
        const terms = await searchApi.fetchPopularTerms();
        renderPopularSearches(terms);
      } catch (_error) {
        renderPopularSearches([]);
      }
    }

    function collectCategories(items) {
      const categories = new Set();
      (items || []).forEach((product) => {
        const normalized = utils.normalizeText(product && product.category);
        if (normalized) {
          categories.add(normalized.replace(/\s+/g, '-'));
        }
      });
      return Array.from(categories).sort((left, right) => left.localeCompare(right));
    }

    function renderCategoryFilters(items) {
      if (!elements.filtersBar || !elements.categoryFilters) {
        return;
      }

      const categories = collectCategories(items);
      if (!categories.length) {
        hideCategoryFilters();
        return;
      }

      const buttons = [
        `<button type="button" class="shop-filter-pill${state.activeCategory === DEFAULT_CATEGORY ? ' active' : ''}" data-filter="${DEFAULT_CATEGORY}" aria-pressed="${state.activeCategory === DEFAULT_CATEGORY ? 'true' : 'false'}">All</button>`
      ];

      categories.forEach((category) => {
        const label = shopApi.createCategoryLabel ? shopApi.createCategoryLabel(category) : category;
        const isActive = state.activeCategory === category;
        buttons.push(
          `<button type="button" class="shop-filter-pill${isActive ? ' active' : ''}" data-filter="${utils.escapeHtml(category)}" aria-pressed="${isActive ? 'true' : 'false'}">${utils.escapeHtml(label)}</button>`
        );
      });

      elements.categoryFilters.innerHTML = buttons.join('');
      elements.filtersBar.hidden = false;

      elements.categoryFilters.querySelectorAll('.shop-filter-pill').forEach((button) => {
        button.addEventListener('click', () => {
          state.activeCategory = String(button.dataset.filter || DEFAULT_CATEGORY).trim().toLowerCase() || DEFAULT_CATEGORY;
          renderCategoryFilters(state.lastResults);
          renderFilteredResults(state.lastResults, state.lastRenderOptions);
        });
      });
    }

    function filterByActiveCategory(items) {
      if (!state.activeCategory || state.activeCategory === DEFAULT_CATEGORY) {
        return items;
      }
      return shopApi.filterProductsByCategory(items, state.activeCategory);
    }

    function renderEmptyRelated(categories, query, suggestedSearches) {
      if (!elements.emptyRelated) {
        return;
      }

      const related = Array.isArray(categories) ? categories : [];
      const suggested = Array.isArray(suggestedSearches) ? suggestedSearches : state.lastSuggestedSearches;
      const blocks = [];

      if (related.length) {
        blocks.push(`
          <p class="search-empty-related__title">Try browsing related categories for "${utils.escapeHtml(query)}":</p>
          <div class="search-empty-related__chips">
            ${related.map((category) => {
              const label = shopApi.createCategoryLabel ? shopApi.createCategoryLabel(category) : category;
              return renderSearchChip(label, 'fa-solid fa-tag');
            }).join('')}
          </div>
        `);
      }

      if (suggested.length) {
        blocks.push(`
          <p class="search-empty-related__title">Suggested searches:</p>
          <div class="search-empty-related__chips">
            ${suggested.map((term) => renderSearchChip(String(term).replace(/\b\w/g, (char) => char.toUpperCase()), 'fa-solid fa-lightbulb')).join('')}
          </div>
        `);
      }

      if (!blocks.length) {
        hideEmptyRelated();
        return;
      }

      elements.emptyRelated.hidden = false;
      elements.emptyRelated.innerHTML = blocks.join('');

      bindSearchChips(elements.emptyRelated, (value) => {
        elements.input.value = value;
        runTextSearch(value, { immediate: true });
      });
    }

    async function renderFilteredResults(items, options) {
      const config = options || {};
      const filteredItems = filterByActiveCategory(items);

      setResultsTitle(config.title || 'Matching products');
      await shopApi.renderProductGrid(elements.results, filteredItems, config.emptyMessage);
      shopApi.updateResultsSummary(elements.resultsSummary, filteredItems.length, config.label || '');

      if (!filteredItems.length) {
        renderEmptyRelated(
          state.lastRelatedCategories,
          config.query || elements.input.value.trim(),
          state.lastSuggestedSearches
        );
      } else {
        hideEmptyRelated();
      }

      if (elements.resultsSection) {
        elements.resultsSection.hidden = false;
      }
    }

    async function showResults(items, options) {
      const config = options || {};
      state.lastResults = Array.isArray(items) ? items.slice() : [];
      state.lastRenderOptions = config;
      hideEmptyState();
      hideDiscovery();
      renderCategoryFilters(state.lastResults);
      await renderFilteredResults(state.lastResults, config);
    }

    function hideSuggestions() {
      state.suggestionsVisible = false;
      state.activeSuggestionIndex = -1;
      if (elements.suggestions) {
        elements.suggestions.hidden = true;
        elements.suggestions.innerHTML = '';
      }
      elements.input.setAttribute('aria-expanded', 'false');
    }

    function renderSuggestionsList(suggestions) {
      if (!elements.suggestions || !Array.isArray(suggestions) || !suggestions.length) {
        hideSuggestions();
        return;
      }

      elements.suggestions.innerHTML = suggestions
        .map((entry, index) => `
          <button
            type="button"
            class="search-suggestion${index === state.activeSuggestionIndex ? ' is-active' : ''}"
            role="option"
            data-label="${utils.escapeHtml(entry.label)}"
            aria-selected="${index === state.activeSuggestionIndex ? 'true' : 'false'}"
          >
            <span class="search-suggestion__label">${utils.escapeHtml(entry.label)}</span>
            <span class="search-suggestion__meta">${utils.escapeHtml(entry.meta || 'Suggestion')}</span>
          </button>
        `)
        .join('');

      elements.suggestions.hidden = false;
      state.suggestionsVisible = true;
      elements.input.setAttribute('aria-expanded', 'true');

      elements.suggestions.querySelectorAll('.search-suggestion').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          const label = String(button.dataset.label || '').trim();
          elements.input.value = label;
          hideSuggestions();
          runTextSearch(label, { immediate: true });
        });
      });
    }

    async function fetchAndRenderSuggestions(query) {
      const currentRequest = ++state.suggestionRequestId;

      if (state.suggestionAbortController) {
        state.suggestionAbortController.abort();
      }

      if (typeof AbortController !== 'undefined') {
        state.suggestionAbortController = new AbortController();
      }

      try {
        const suggestions = await searchApi.fetchSuggestions(query, {
          limit: 8,
          signal: state.suggestionAbortController?.signal
        });
        if (currentRequest !== state.suggestionRequestId) {
          return;
        }
        renderSuggestionsList(suggestions);
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        if (currentRequest === state.suggestionRequestId) {
          hideSuggestions();
        }
      }
    }

    function scheduleSuggestions(query) {
      window.clearTimeout(state.suggestionDebounceTimer);
      state.suggestionDebounceTimer = window.setTimeout(() => {
        fetchAndRenderSuggestions(query);
      }, SUGGESTION_DEBOUNCE_MS);
    }

    function isAcceptedImageFile(file) {
      if (!file) {
        return false;
      }

      const mimeType = String(file.type || '').trim().toLowerCase();
      if (mimeType && ACCEPTED_IMAGE_TYPES.has(mimeType)) {
        return true;
      }

      const extension = String(file.name || '').split('.').pop().trim().toLowerCase();
      return ACCEPTED_IMAGE_EXTENSIONS.has(extension);
    }

    function clearImageInputs() {
      [elements.imageInputCamera, elements.imageInputGallery, elements.imageInputFiles].forEach((input) => {
        if (input) {
          input.value = '';
        }
      });
    }

    function setVisualSearchPickerVisible(visible) {
      if (!elements.visualSearchPicker) {
        return;
      }

      elements.visualSearchPicker.hidden = !visible;
      elements.visualSearchPicker.setAttribute('aria-hidden', visible ? 'false' : 'true');

      if (elements.imageTrigger) {
        elements.imageTrigger.setAttribute('aria-expanded', visible ? 'true' : 'false');
      }

      if (visible) {
        document.body.classList.add('search-visual-picker-open');
        const firstOption = elements.visualSearchPicker.querySelector('.visual-search-picker__option');
        if (firstOption) {
          window.requestAnimationFrame(() => firstOption.focus());
        }
        return;
      }

      document.body.classList.remove('search-visual-picker-open');
    }

    function hideVisualSearchPicker() {
      setVisualSearchPickerVisible(false);
    }

    function showVisualSearchPicker() {
      setVisualSearchPickerVisible(true);
    }

    function openImageSourceInput(source) {
      const inputMap = {
        camera: elements.imageInputCamera,
        gallery: elements.imageInputGallery,
        files: elements.imageInputFiles
      };

      const input = inputMap[source];
      if (!input) {
        return;
      }

      hideVisualSearchPicker();
      clearImageInputs();
      window.requestAnimationFrame(() => input.click());
    }

    function handleImageInputChange(event) {
      const file = event?.target?.files && event.target.files[0];
      if (!file) {
        return;
      }

      if (!isAcceptedImageFile(file)) {
        clearImageInputs();
        setVisualPanelVisible(true);
        setVisualStatus('Please choose a JPG, JPEG, PNG, or WEBP image.', 'error');
        return;
      }

      runImageSearch(file);
    }

    function setVisualPanelVisible(visible) {
      if (!elements.visualPanel) {
        return;
      }

      if (state.panelHideTimer) {
        window.clearTimeout(state.panelHideTimer);
        state.panelHideTimer = null;
      }

      if (visible) {
        elements.visualPanel.hidden = false;
        elements.visualPanel.setAttribute('aria-hidden', 'false');
        window.requestAnimationFrame(() => {
          if (elements.visualPanel) {
            elements.visualPanel.dataset.visible = 'true';
          }
        });
        return;
      }

      elements.visualPanel.dataset.visible = 'false';
      elements.visualPanel.setAttribute('aria-hidden', 'true');
      state.panelHideTimer = window.setTimeout(() => {
        if (elements.visualPanel && elements.visualPanel.dataset.visible !== 'true') {
          elements.visualPanel.hidden = true;
        }
        state.panelHideTimer = null;
      }, VISUAL_PANEL_TRANSITION_MS);
    }

    function setVisualStatus(message, stateName) {
      if (!elements.imageStatus) {
        return;
      }
      elements.imageStatus.textContent = message;
      elements.imageStatus.dataset.state = stateName || 'idle';
    }

    function setPreview(previewUrl) {
      setVisualPanelVisible(Boolean(previewUrl));
      if (elements.imagePreview) {
        elements.imagePreview.src = previewUrl || '';
      }
      if (elements.imagePreviewShell) {
        elements.imagePreviewShell.hidden = !previewUrl;
      }
    }

    function renderVisualChips(analysis) {
      if (!elements.imageChips) {
        return;
      }

      if (!analysis) {
        elements.imageChips.innerHTML = '';
        elements.imageChips.hidden = true;
        return;
      }

      const chipValues = [];
      (analysis.objects || []).slice(0, 2).forEach((value) => chipValues.push({ label: 'Object', value }));
      (analysis.colors || []).slice(0, 2).forEach((entry) => chipValues.push({ label: 'Color', value: entry.name }));
      (analysis.styles || []).slice(0, 2).forEach((value) => chipValues.push({ label: 'Style', value }));
      (analysis.patterns || []).slice(0, 1).forEach((value) => chipValues.push({ label: 'Pattern', value }));

      if (!chipValues.length) {
        elements.imageChips.innerHTML = '';
        elements.imageChips.hidden = true;
        return;
      }

      elements.imageChips.innerHTML = chipValues
        .map((entry) => `<span class="visual-search-chip"><strong>${utils.escapeHtml(entry.label)}:</strong> ${utils.escapeHtml(entry.value)}</span>`)
        .join('');
      elements.imageChips.hidden = false;
    }

    function resetVisualSearch() {
      state.activeImageAnalysis = null;
      state.activeImageFile = null;
      clearImageInputs();
      hideVisualSearchPicker();
      if (elements.imageReset) {
        elements.imageReset.hidden = true;
      }
      if (elements.imageTitle) {
        elements.imageTitle.textContent = 'Results for your image';
      }

      setPreview('');
      renderVisualChips(null);
      setVisualStatus('Upload an image to search the live product catalog.', 'idle');
      setVisualPanelVisible(false);

      if (elements.input.value.trim()) {
        runTextSearch(elements.input.value, { immediate: true });
      } else {
        hideResults();
        showEmptyState();
        renderRecentSearches();
      }
    }

    async function refreshCatalog() {
      if (productCatalog && typeof productCatalog.refreshCatalog === 'function') {
        try {
          await productCatalog.refreshCatalog({ silent: true, force: false });
        } catch (_error) {
          // Keep the last known catalog snapshot for visual search fallback.
        }
      }

      state.catalog = getCatalogSnapshot();

      if (state.activeImageAnalysis) {
        await runCombinedSearch(elements.input.value);
        return;
      }

      if (elements.input.value.trim()) {
        await runTextSearch(elements.input.value, { immediate: true });
        return;
      }

      hideResults();
      showEmptyState();
      renderRecentSearches();
    }

    async function runCombinedSearch(query) {
      const trimmedQuery = String(query || '').trim();
      const currentRequest = ++state.searchRequestId;
      hideSuggestions();
      renderSkeletonGrid();

      if (!state.activeImageFile) {
        setVisualStatus('Upload an image to search the live product catalog.', 'error');
        return;
      }

      try {
        const payload = await searchApi.searchByImage(state.activeImageFile, {
          query: trimmedQuery,
          analysis: state.activeImageAnalysis,
          limit: 60
        });

        if (currentRequest !== state.searchRequestId) {
          return;
        }

        state.lastRelatedCategories = payload.relatedCategories || [];
        state.lastSuggestedSearches = payload.suggestedSearches || [];

        const labelParts = ['Visual search results'];
        if (trimmedQuery) {
          labelParts.push(`Search: ${trimmedQuery}`);
        }

        await showResults(mapSearchProducts(payload.products), {
          title: 'Results for your image',
          label: labelParts.join(' • '),
          query: trimmedQuery,
          emptyMessage: trimmedQuery
            ? `No live catalog products matched this image and "${trimmedQuery}".`
            : 'No similar products were found for this image in the live catalog.'
        });

        setVisualStatus(
          payload.count
            ? `Found ${payload.count} live catalog match${payload.count === 1 ? '' : 'es'} for your image.`
            : 'No live catalog matches were found for this image.',
          payload.count ? 'ready' : 'error'
        );
      } catch (error) {
        if (currentRequest !== state.searchRequestId) {
          return;
        }

        console.error('[Search] VPS visual search failed:', error);
        setVisualStatus('Visual search failed. Please try another image.', 'error');
        await showResults([], {
          title: 'Results for your image',
          label: trimmedQuery ? `Search: ${trimmedQuery}` : 'Visual search',
          query: trimmedQuery,
          emptyMessage: 'Unable to complete visual search right now. Please try again shortly.'
        });
      }
    }

    async function executeTextSearch(query) {
      const trimmedQuery = String(query || '').trim();
      updateUrl(trimmedQuery);
      state.activeCategory = DEFAULT_CATEGORY;

      if (state.activeImageAnalysis) {
        await runCombinedSearch(trimmedQuery);
        return;
      }

      if (!trimmedQuery) {
        hideResults();
        hideSuggestions();
        showEmptyState();
        renderRecentSearches();
        return;
      }

      const currentRequest = ++state.searchRequestId;

      if (state.searchAbortController) {
        state.searchAbortController.abort();
      }

      if (typeof AbortController !== 'undefined') {
        state.searchAbortController = new AbortController();
      }

      renderSkeletonGrid();

      try {
        const payload = await searchApi.searchProducts(trimmedQuery, {
          category: state.activeCategory === DEFAULT_CATEGORY ? '' : state.activeCategory,
          limit: 60,
          signal: state.searchAbortController?.signal
        });

        if (currentRequest !== state.searchRequestId) {
          return;
        }

        state.lastRelatedCategories = payload.relatedCategories || [];
        state.lastSuggestedSearches = payload.products.length
          ? []
          : await searchApi.fetchPopularTerms().catch(() => []);
        searchApi.rememberRecentSearch(trimmedQuery);
        renderRecentSearches();

        await showResults(mapSearchProducts(payload.products), {
          title: 'Matching products',
          label: `Search: ${trimmedQuery}`,
          query: trimmedQuery,
          emptyMessage: `No products found for "${trimmedQuery}".`
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        if (currentRequest !== state.searchRequestId) {
          return;
        }

        console.error('[Search] Live API search failed:', error);
        await showResults([], {
          title: 'Matching products',
          label: `Search: ${trimmedQuery}`,
          query: trimmedQuery,
          emptyMessage: `Unable to search right now. Please try again shortly.`
        });
      }
    }

    function runTextSearch(query, options) {
      const config = options || {};
      hideEmptyState();

      if (config.immediate) {
        window.clearTimeout(state.searchDebounceTimer);
        return executeTextSearch(query);
      }

      window.clearTimeout(state.searchDebounceTimer);
      state.searchDebounceTimer = window.setTimeout(() => {
        executeTextSearch(query);
      }, SEARCH_DEBOUNCE_MS);

      return Promise.resolve();
    }

    async function runImageSearch(file) {
      if (!file) {
        return;
      }

      const currentRequest = ++state.searchRequestId;
      hideSuggestions();
      hideEmptyState();
      hideDiscovery();
      setVisualPanelVisible(true);
      setVisualStatus('Uploading image to BYOSE Market search...', 'loading');
      renderVisualChips(null);

      if (elements.imageReset) {
        elements.imageReset.hidden = false;
      }

      try {
        const previewUrl = await imageApi.readPreview(file);
        if (currentRequest !== state.searchRequestId) {
          return;
        }

        state.activeImageFile = file;
        setPreview(previewUrl);
        setVisualStatus('Analyzing image and searching the live catalog...', 'loading');

        let clientAnalysis = null;
        try {
          clientAnalysis = await imageApi.analyzeFile(file);
        } catch (_analysisError) {
          clientAnalysis = null;
        }

        if (currentRequest !== state.searchRequestId) {
          return;
        }

        state.activeImageAnalysis = clientAnalysis;
        if (elements.imageTitle) {
          elements.imageTitle.textContent = 'Results for your image';
        }

        renderVisualChips(clientAnalysis);
        setVisualStatus('Matching your image against live products on the server...', 'loading');

        await runCombinedSearch(elements.input.value);
      } catch (_error) {
        if (currentRequest !== state.searchRequestId) {
          return;
        }

        state.activeImageAnalysis = null;
        state.activeImageFile = null;
        renderVisualChips(null);
        setVisualStatus('We could not analyze that image. Try another photo.', 'error');
        hideResults();
        showEmptyState();
      }
    }

    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      hideSuggestions();
      runTextSearch(elements.input.value, { immediate: true });
    });

    elements.input.addEventListener('input', () => {
      scheduleSuggestions(elements.input.value);
      runTextSearch(elements.input.value);
    });

    elements.input.addEventListener('focus', () => {
      renderRecentSearches();
      scheduleSuggestions(elements.input.value);
    });

    elements.input.addEventListener('blur', () => {
      window.setTimeout(hideSuggestions, 140);
    });

    elements.input.addEventListener('keydown', (event) => {
      if (!state.suggestionsVisible || !elements.suggestions) {
        return;
      }

      const suggestionButtons = Array.from(elements.suggestions.querySelectorAll('.search-suggestion'));
      if (!suggestionButtons.length) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.activeSuggestionIndex = (state.activeSuggestionIndex + 1) % suggestionButtons.length;
        fetchAndRenderSuggestions(elements.input.value);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.activeSuggestionIndex = state.activeSuggestionIndex <= 0
          ? suggestionButtons.length - 1
          : state.activeSuggestionIndex - 1;
        fetchAndRenderSuggestions(elements.input.value);
        return;
      }

      if (event.key === 'Enter' && state.activeSuggestionIndex >= 0) {
        event.preventDefault();
        const active = suggestionButtons[state.activeSuggestionIndex];
        if (active) {
          elements.input.value = String(active.dataset.label || '').trim();
          hideSuggestions();
          runTextSearch(elements.input.value, { immediate: true });
        }
      }

      if (event.key === 'Escape') {
        hideSuggestions();
      }
    });

    if (elements.clearRecentSearches) {
      elements.clearRecentSearches.addEventListener('click', () => {
        searchApi.clearRecentSearches();
        renderRecentSearches();
      });
    }

    if (elements.imageTrigger) {
      elements.imageTrigger.addEventListener('click', () => {
        hideSuggestions();
        showVisualSearchPicker();
      });
    }

    if (elements.visualSearchPickerBackdrop) {
      elements.visualSearchPickerBackdrop.addEventListener('click', hideVisualSearchPicker);
    }

    if (elements.visualSearchPickerClose) {
      elements.visualSearchPickerClose.addEventListener('click', hideVisualSearchPicker);
    }

    elements.visualSearchPickerOptions.forEach((button) => {
      button.addEventListener('click', () => {
        openImageSourceInput(String(button.dataset.source || '').trim());
      });
    });

    [elements.imageInputCamera, elements.imageInputGallery, elements.imageInputFiles].forEach((input) => {
      if (!input) {
        return;
      }

      input.addEventListener('change', handleImageInputChange);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && elements.visualSearchPicker && !elements.visualSearchPicker.hidden) {
        hideVisualSearchPicker();
      }
    });

    if (elements.imageReset) {
      elements.imageReset.addEventListener('click', resetVisualSearch);
    }

    [
      'byose:products-synchronized',
      'byose:products-changed',
      'byose:storefront-products-updated'
    ].forEach((eventName) => {
      window.addEventListener(eventName, refreshCatalog);
    });

    await loadPopularSearches();
    renderRecentSearches();
    await refreshCatalog();

    const initialQuery = new URLSearchParams(window.location.search).get('q') || '';
    if (initialQuery.trim()) {
      elements.input.value = initialQuery;
      await runTextSearch(initialQuery, { immediate: true });
      return;
    }

    hideResults();
    showEmptyState();
    setVisualPanelVisible(false);
    setVisualStatus('Upload an image to search the live product catalog.', 'idle');
  });
})();
