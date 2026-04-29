const express = require('express');
const router = express.Router();
const productController = require('../controllers/productcontroller');
const adminAuthMiddleware = require('../middleware/adminauthmiddleware');

// Public product routes
router.get('/', productController.getAllProducts);

// Admin product routes
router.post('/bootstrap', adminAuthMiddleware, productController.bootstrapCatalog);
router.post('/', adminAuthMiddleware, productController.createProduct);

// Shared product routes
router.get('/:id', productController.getProductById);
router.put('/:id', adminAuthMiddleware, productController.updateProduct);
router.delete('/:id', adminAuthMiddleware, productController.deleteProduct);

module.exports = router;
