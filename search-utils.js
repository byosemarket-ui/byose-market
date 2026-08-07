(function () {

  const TOKEN_ALIASES = {
    shoe: ['shoes', 'sneakers', 'footwear', 'inkweto'],
    shoes: ['shoe', 'sneakers', 'footwear', 'inkweto'],
    sneaker: ['shoe', 'shoes', 'footwear'],
    bag: ['bags', 'leather', 'fashion', 'handbag', 'sac'],
    bags: ['bag', 'fashion', 'handbag'],
    watch: ['smartwatch', 'electronics', 'amasaha'],
    smartwatch: ['watch', 'electronics'],
    tv: ['television', 'electronics', 'screen'],
    television: ['tv', 'electronics'],
    shirt: ['tshirt', 'fashion', 'clothes', 'imyenda'],
    tshirt: ['shirt', 'fashion', 'clothes'],
    phone: ['electronics', 'smart', 'watch', 'tv'],
    electronics: ['watch', 'tv', 'smartwatch'],
    fashion: ['shirt', 'bag', 'clothes'],
    clothes: ['fashion', 'shirt', 'tshirt']
  };

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokenize(value) {
    return Array.from(new Set(normalizeText(value).split(/\s+/).filter(Boolean)));
  }

  function expandTokens(tokens) {
    const expanded = new Set(tokens);
    tokens.forEach((token) => {
      const aliases = TOKEN_ALIASES[token] || [];
      aliases.forEach((alias) => expanded.add(alias));
    });
    return Array.from(expanded);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatCurrency(value) {
    return `RWF ${Number(value || 0).toLocaleString('en-US')}`;
  }

  function resolveProductUrl(product) {
    const rawUrl = String(product && product.url ? product.url : '').trim();
    if (rawUrl && !/^(?:javascript|data):/i.test(rawUrl)) {
      return rawUrl;
    }

    const id = Number(product && product.id);
    if (Number.isFinite(id) && id > 0) {
      return `details/product-details1.html?id=${encodeURIComponent(id)}`;
    }

    const rawPage = String(product && product.page ? product.page : '').trim();
    if (rawPage && !/^(?:javascript|data):/i.test(rawPage)) {
      return rawPage;
    }

    return 'details/product-details1.html';
  }

  function buildSearchText(product) {
    return normalizeText([
      product.name,
      product.category,
      Array.isArray(product.keywords) ? product.keywords.join(' ') : ''
    ].join(' '));
  }

  function mapProduct(product, index) {
    return {
      ...product,
      id: product.id || index + 1,
      category: product.category || 'General',
      keywords: Array.isArray(product.keywords) ? product.keywords : [],
      searchText: buildSearchText(product),
      searchTokens: expandTokens(tokenize([
        product.name,
        product.category,
        Array.isArray(product.keywords) ? product.keywords.join(' ') : ''
      ].join(' '))),
      url: resolveProductUrl(product)
    };
  }

  function getCatalog(source) {
    const raw = Array.isArray(source) ? source : Array.isArray(window.products) ? window.products : [];
    return raw.map(mapProduct);
  }

  function scoreProduct(product, queryTokens) {
    if (!queryTokens.length) {
      return 1;
    }

    const searchText = product.searchText;
    let score = 0;

    queryTokens.forEach((token) => {
      if (normalizeText(product.name).startsWith(token)) {
        score += 10;
      }
      if (product.searchTokens.includes(token)) {
        score += 8;
      }
      if (searchText.includes(token)) {
        score += 4;
      }
      if (normalizeText(product.category) === token) {
        score += 6;
      }
    });

    return score;
  }

  function rankProductsByTokens(products, tokens) {
    const expandedTokens = expandTokens(tokens);
    return products
      .map((product) => ({ product, score: scoreProduct(product, expandedTokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(right.product.name))
      .map((entry) => entry.product);
  }

  function searchProducts(products, query) {
    const tokens = tokenize(query);
    return rankProductsByTokens(products, tokens);
  }

  function uniqueBy(items, getKey) {
    const seen = new Set();
    return items.filter((item) => {
      const key = getKey(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function getProductHint(product) {
    if (product.badge) {
      return product.badge;
    }
    if (product.category) {
      return String(product.category).toUpperCase();
    }
    return 'PICK';
  }

  window.ByoseSearchUtils = {
    escapeHtml,
    expandTokens,
    formatCurrency,
    getCatalog,
    getProductHint,
    normalizeText,
    rankProductsByTokens,
    resolveProductUrl,
    scoreProduct,
    searchProducts,
    tokenize,
    uniqueBy
  };
})();