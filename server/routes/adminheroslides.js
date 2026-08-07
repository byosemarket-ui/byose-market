const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const { createRateLimiter } = require('../middleware/ratelimiter');
const heroSlideController = require('../controllers/heroslidecontroller');

const router = express.Router();

const adminHeroMutationLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 60,
    code: 'HERO_ADMIN_RATE_LIMITED',
    message: 'Too many hero slide changes. Please retry shortly.'
});

router.use(adminAccessDisabled);
router.get('/', heroSlideController.listHeroSlides);
router.post('/', adminHeroMutationLimiter, heroSlideController.createHeroSlide);
router.put('/:id/move', adminHeroMutationLimiter, heroSlideController.moveHeroSlide);
router.get('/:id', heroSlideController.getHeroSlideById);
router.put('/:id', adminHeroMutationLimiter, heroSlideController.updateHeroSlide);
router.delete('/:id', adminHeroMutationLimiter, heroSlideController.deleteHeroSlide);

module.exports = router;
