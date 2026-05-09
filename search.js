(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const utils = window.ByoseSearchUtils;
    const shopApi = window.ByoseShop;
    const imageApi = window.ByoseImageSearch;
    const aiApi = window.ByoseSearchAI;

    const elements = {
      form: document.getElementById('searchPageForm'),
      input: document.getElementById('searchPageInput'),
      resultsSection: document.getElementById('searchResultsSection'),
      results: document.getElementById('searchResults'),
      resultsSummary: document.getElementById('searchResultsSummary'),
      resultsTitle: document.getElementById('search-results-title'),
      imageTrigger: document.getElementById('imageSearchTrigger'),
      imageInput: document.getElementById('imageSearchInput'),
      visualPanel: document.getElementById('visualSearchPanel'),
      imagePreview: document.getElementById('imageSearchPreview'),
      imagePreviewShell: document.getElementById('imageSearchPreviewShell'),
      imageStatus: document.getElementById('imageSearchStatus'),
      imageChips: document.getElementById('imageSearchChips'),
      imageTitle: document.getElementById('imageSearchTitle'),
      imageReset: document.getElementById('imageSearchReset')
    };

    if (!utils || !shopApi || !imageApi || !aiApi || !elements.form || !elements.input || !elements.resultsSection || !elements.results || !elements.resultsSummary) {
      return;
    }

    const state = {
      activeImageAnalysis: null,
      catalog: utils.getCatalog(window.products),
      panelHideTimer: null,
      requestId: 0
    };

    const VISUAL_PANEL_TRANSITION_MS = 220;

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

    function hideResults() {
      elements.results.innerHTML = '';
      elements.resultsSummary.textContent = '';
      elements.resultsSection.hidden = true;
    }

    function showResults(items, options) {
      const config = options || {};
      setResultsTitle(config.title || 'Matching products');
      shopApi.renderProductGrid(elements.results, items, config.emptyMessage);
      shopApi.updateResultsSummary(elements.resultsSummary, items.length, config.label || '');
      elements.resultsSection.hidden = false;
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

      if (elements.imageInput) {
        elements.imageInput.value = '';
      }

      if (elements.imageReset) {
        elements.imageReset.hidden = true;
      }

      if (elements.imageTitle) {
        elements.imageTitle.textContent = 'Results for your image';
      }

      setPreview('');
      renderVisualChips(null);
      setVisualStatus('Upload an image to search the existing product catalog.', 'idle');
      setVisualPanelVisible(false);

      if (elements.input.value.trim()) {
        runTextSearch(elements.input.value);
      } else {
        hideResults();
      }
    }

    function refreshCatalog() {
      state.catalog = utils.getCatalog(window.products);

      if (state.activeImageAnalysis) {
        runCombinedSearch(elements.input.value);
        return;
      }

      if (elements.input.value.trim()) {
        runTextSearch(elements.input.value);
        return;
      }

      hideResults();
      }

    async function runCombinedSearch(query) {
      const trimmedQuery = String(query || '').trim();
      const currentRequest = ++state.requestId;
      const result = await aiApi.matchProductsByImage({
        analysis: state.activeImageAnalysis,
        products: state.catalog,
        query: trimmedQuery,
        limit: state.catalog.length
      });

      if (currentRequest !== state.requestId) {
        return;
      }

      const labelParts = ['Results for your image'];
      if (trimmedQuery) {
        labelParts.push(`Search: ${trimmedQuery}`);
      }

      showResults(result.results, {
        title: 'Results for your image',
        label: labelParts.join(' • '),
        emptyMessage: trimmedQuery
          ? `No catalog products matched this image and "${trimmedQuery}".`
          : 'No similar products were found for this image.'
      });
    }

    function runTextSearch(query) {
      const trimmedQuery = String(query || '').trim();
      updateUrl(trimmedQuery);

      if (state.activeImageAnalysis) {
        return runCombinedSearch(trimmedQuery);
      }

      if (!trimmedQuery) {
        hideResults();
        return Promise.resolve();
      }

      const results = utils.searchProducts(state.catalog, trimmedQuery);
      showResults(results, {
        title: 'Matching products',
        label: `Search: ${trimmedQuery}`,
        emptyMessage: `No products found for "${trimmedQuery}".`
      });

      return Promise.resolve();
    }

    async function runImageSearch(file) {
      if (!file) {
        return;
      }

      const currentRequest = ++state.requestId;
      setVisualPanelVisible(true);
      setVisualStatus('Preparing image preview...', 'loading');
      renderVisualChips(null);

      if (elements.imageReset) {
        elements.imageReset.hidden = false;
      }

      try {
        const previewUrl = await imageApi.readPreview(file);

        if (currentRequest !== state.requestId) {
          return;
        }

        setPreview(previewUrl);
        setVisualStatus('Analyzing image and matching products...', 'loading');

        const analysis = await imageApi.analyzeFile(file);

        if (currentRequest !== state.requestId) {
          return;
        }

        state.activeImageAnalysis = analysis;

        if (elements.imageTitle) {
          elements.imageTitle.textContent = 'Results for your image';
        }

        renderVisualChips(analysis);
        setVisualStatus(
          analysis.source === 'ai'
            ? 'AI analysis complete. Showing the closest matches from the current catalog.'
            : 'Visual analysis complete. Showing the closest matches from the current catalog.',
          'ready'
        );

        await runCombinedSearch(elements.input.value);
      } catch (error) {
        if (currentRequest !== state.requestId) {
          return;
        }

        state.activeImageAnalysis = null;
        renderVisualChips(null);
        setVisualStatus('We could not analyze that image. Try another photo.', 'error');
        hideResults();
      }
    }

    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      runTextSearch(elements.input.value);
    });

    elements.input.addEventListener('input', () => {
      runTextSearch(elements.input.value);
    });

    if (elements.imageTrigger && elements.imageInput) {
      elements.imageTrigger.addEventListener('click', () => {
        elements.imageInput.click();
      });

      elements.imageInput.addEventListener('change', () => {
        const file = elements.imageInput.files && elements.imageInput.files[0];
        runImageSearch(file);
      });
    }

    if (elements.imageReset) {
      elements.imageReset.addEventListener('click', resetVisualSearch);
    }

    window.addEventListener('byose:products-changed', refreshCatalog);

    const initialQuery = new URLSearchParams(window.location.search).get('q') || '';

    if (initialQuery.trim()) {
      elements.input.value = initialQuery;
      runTextSearch(initialQuery);
      return;
    }

    hideResults();
    setVisualPanelVisible(false);
    setVisualStatus('Upload an image to search the existing product catalog.', 'idle');
  });
})();