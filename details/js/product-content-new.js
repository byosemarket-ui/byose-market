/**
 * STEP 3H: Backend-Driven Product Content
 * 
 * DEPRECATED HARDCODED FALLBACK - Now fetches from centralized backend API
 * This module ensures all product rendering uses backend/MongoDB as canonical source.
 */

import productService from '../../services/centralized-products.service.js';

// DEPRECATED: Hardcoded productContent array removed
// REASON: Local ownership pattern eliminated in STEP 3H
// MIGRATION: All calls now route through centralized backend service

/**
 * Get product by ID from backend (canonical source)
 * @param {number|string} productId 
 * @returns {Promise<Object|null>}
 */
export async function getProductContentById(productId) {
  try {
    const products = await productService.getProductsWithRetry();
    if (!Array.isArray(products)) {
      return null;
    }
    return products.find(p => Number(p.id || p.catalogId) === Number(productId)) || null;
  } catch (error) {
    console.error('[Product Content] Failed to fetch product by ID:', productId, error);
    // Return cached data only as last resort (not canonical, just fallback)
    const cached = productService.getCachedProducts();
    return cached.find(p => Number(p.id || p.catalogId) === Number(productId)) || null;
  }
}

/**
 * Get all products from backend (canonical source)
 * @returns {Promise<Array>}
 */
export async function getAllProductContent() {
  try {
    const products = await productService.getProductsWithRetry();
    return Array.isArray(products) ? products : [];
  } catch (error) {
    console.error('[Product Content] Failed to fetch all products:', error);
    // Return cached data only as last resort (not canonical, just fallback)
    return productService.getCachedProducts();
  }
}

/**
 * LEGACY: productContent array - DEPRECATED
 * Kept as empty export for backwards compatibility only
 * DO NOT USE - will be removed in next phase
 */
export const productContent = [];
