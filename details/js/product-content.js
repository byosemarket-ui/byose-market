/**
 * STEP 3H: Backend-Driven Product Content
 *
 * Fetches a single product by ID for PDP, and uses the shared catalog cache
 * for related products — avoiding full-catalog force refreshes on every visit.
 */

import productService from '../../services/centralized-products.service.js';

/**
 * Get product by ID from backend (canonical source)
 * @param {number|string} productId
 * @returns {Promise<Object|null>}
 */
export async function getProductContentById(productId) {
  try {
    if (typeof productService.getProductById === 'function') {
      const product = await productService.getProductById(productId);
      if (product) {
        return product;
      }
    }

    const products = await productService.getProducts();
    if (!Array.isArray(products)) {
      return null;
    }
    return products.find(p => Number(p.id || p.catalogId) === Number(productId)) || null;
  } catch (error) {
    console.error('[Product Content] Failed to fetch product by ID:', productId, error);
    const cached = productService.getCachedProducts();
    return cached.find(p => Number(p.id || p.catalogId) === Number(productId)) || null;
  }
}

/**
 * Get all products from backend (canonical source)
 * Prefer warm cache / soft refresh over force-refresh.
 * @returns {Promise<Array>}
 */
export async function getAllProductContent() {
  try {
    const products = await productService.getProducts();
    return Array.isArray(products) ? products : [];
  } catch (error) {
    console.error('[Product Content] Failed to fetch all products:', error);
    return productService.getCachedProducts();
  }
}

export function getCachedProductContent() {
  try {
    const cached = productService.getCachedProducts();
    return Array.isArray(cached) ? cached : [];
  } catch (_error) {
    return [];
  }
}

/**
 * LEGACY: productContent array - DEPRECATED
 * Kept as empty export for backwards compatibility only
 * DO NOT USE - will be removed in next phase
 */
export const productContent = [];
