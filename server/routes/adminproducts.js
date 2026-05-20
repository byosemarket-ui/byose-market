const express = require('express');

const productController = require('../controllers/productcontroller');
const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const { createRateLimiter } = require('../middleware/ratelimiter');

const router = express.Router();

const adminProductLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 120,
    code: 'ADMIN_PRODUCTS_RATE_LIMITED',
    message: 'Too many admin product requests. Please retry shortly.'
});

router.use(adminAccessDisabled);

router.get('/', adminProductLimiter, productController.getAllProducts);
router.post('/bootstrap', adminProductLimiter, productController.bootstrapCatalog);
router.post('/', adminProductLimiter, productController.createProduct);
router.get('/:id', adminProductLimiter, productController.getProductById);
router.put('/:id', adminProductLimiter, productController.updateProduct);
router.delete('/:id', adminProductLimiter, productController.deleteProduct);

module.exports = router;