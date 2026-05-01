const express = require('express');
const router = express.Router();
const productController = require('../controllers/productcontroller');
const adminAccessDisabled = require('../middleware/adminaccessdisabled');

// Public product routes
router.get('/', productController.getAllProducts);

// Admin product routes
router.post('/bootstrap', adminAccessDisabled, productController.bootstrapCatalog);
router.post('/', adminAccessDisabled, productController.createProduct);

// Shared product routes
router.get('/:id', productController.getProductById);
router.put('/:id', adminAccessDisabled, productController.updateProduct);
router.delete('/:id', adminAccessDisabled, productController.deleteProduct);

module.exports = router;
