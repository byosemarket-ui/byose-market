const express = require('express');
const router = express.Router();
const productController = require('../controllers/productcontroller');
const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { createVisualSearchUploadMiddleware } = require('../middleware/visualsearchupload');

const publicProductLimiter = createRateLimiter({
	windowMs: 60 * 1000,
	max: 180,
	code: 'PRODUCT_RATE_LIMITED',
	message: 'Too many product requests. Please try again shortly.'
});

const adminInventoryLimiter = createRateLimiter({
	windowMs: 5 * 60 * 1000,
	max: 80,
	code: 'ADMIN_INVENTORY_RATE_LIMITED',
	message: 'Too many inventory operations. Please retry shortly.'
});

const visualSearchLimiter = createRateLimiter({
	windowMs: 60 * 1000,
	max: 30,
	code: 'VISUAL_SEARCH_RATE_LIMITED',
	message: 'Too many visual search requests. Please try again shortly.'
});

const visualSearchUpload = createVisualSearchUploadMiddleware();

// Public product routes
router.get('/search/suggestions', publicProductLimiter, productController.getSearchSuggestions);
router.get('/search/popular', publicProductLimiter, productController.getPopularSearchTerms);
router.get('/search', publicProductLimiter, productController.searchProducts);
router.post('/search/visual', visualSearchLimiter, visualSearchUpload, productController.searchProductsByImage);
router.get('/', publicProductLimiter, productController.getAllProducts);

// Admin product routes
router.post('/bootstrap', adminInventoryLimiter, adminAccessDisabled, productController.bootstrapCatalog);
router.post('/', adminInventoryLimiter, adminAccessDisabled, productController.createProduct);

// Shared product routes
router.get('/:id', publicProductLimiter, productController.getProductById);
router.put('/:id', adminInventoryLimiter, adminAccessDisabled, productController.updateProduct);
router.delete('/:id', adminInventoryLimiter, adminAccessDisabled, productController.deleteProduct);

module.exports = router;
