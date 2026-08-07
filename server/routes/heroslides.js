const express = require('express');
const { createRateLimiter } = require('../middleware/ratelimiter');
const heroSlideController = require('../controllers/heroslidecontroller');

const router = express.Router();

const publicHeroSlideLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    code: 'HERO_SLIDE_RATE_LIMITED',
    message: 'Too many hero slide requests. Please try again shortly.'
});

router.get('/', publicHeroSlideLimiter, heroSlideController.listPublicHeroSlides);

module.exports = router;
