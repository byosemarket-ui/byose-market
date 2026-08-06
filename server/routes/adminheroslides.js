const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const heroSlideController = require('../controllers/heroslidecontroller');

const router = express.Router();

router.use(adminAccessDisabled);
router.get('/', heroSlideController.listHeroSlides);
router.post('/', heroSlideController.createHeroSlide);
router.get('/:id', heroSlideController.getHeroSlideById);
router.put('/:id', heroSlideController.updateHeroSlide);
router.delete('/:id', heroSlideController.deleteHeroSlide);

module.exports = router;
