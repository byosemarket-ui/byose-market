const config = require('../config/env');
const HeroSlide = require('../models/heroslide');
const heroSlideDataService = require('../services/heroslidedataservice');
const { appLogger } = require('../utils/logger');

function normalizeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function normalizeStatus(value) {
    return normalizeText(value, 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidButtonLink(value) {
    const link = normalizeText(value);
    if (!link) {
        return true;
    }

    if (/^(javascript|data|vbscript):/i.test(link)) {
        return false;
    }

    if (/^https?:\/\//i.test(link)) {
        try {
            const parsed = new URL(link);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (_error) {
            return false;
        }
    }

    if (link.startsWith('/') || link.startsWith('./') || link.startsWith('../')) {
        return true;
    }

    return /^[a-z0-9][a-z0-9._\-/?&=#]*$/i.test(link);
}

function isSqlite() {
    return config.databaseClient === 'sqlite';
}

async function assertUniqueDisplayOrder(displayOrder, excludeSlideId = '') {
    if (!Number.isFinite(displayOrder)) {
        return null;
    }

    if (isSqlite()) {
        return heroSlideDataService.findHeroSlideByDisplayOrder(displayOrder, excludeSlideId);
    }

    const query = { displayOrder };
    if (excludeSlideId) {
        query.slideId = { $ne: excludeSlideId };
    }

    return HeroSlide.findOne(query).lean();
}

function buildSlideId(payload) {
    const provided = normalizeText(payload?.id || payload?.slideId);
    if (provided) {
        return provided;
    }

    return `hero-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeSlide(slide) {
    const source = slide && typeof slide.toObject === 'function'
        ? slide.toObject({ versionKey: false })
        : { ...(slide || {}) };

    return {
        id: normalizeText(source.slideId || source.id || source._id),
        slideId: normalizeText(source.slideId || source.id || source._id),
        title: normalizeText(source.title),
        subtitle: normalizeText(source.subtitle),
        buttonText: normalizeText(source.buttonText),
        buttonLink: normalizeText(source.buttonLink),
        imageUrl: normalizeText(source.imageUrl),
        imagePath: normalizeText(source.imagePath),
        displayOrder: toNumber(source.displayOrder, 0),
        status: normalizeStatus(source.status),
        createdAt: source.createdAt || new Date().toISOString(),
        updatedAt: source.updatedAt || source.createdAt || new Date().toISOString(),
        meta: source.meta && typeof source.meta === 'object' ? source.meta : {}
    };
}

function buildSortQuery(sort) {
    const normalized = normalizeText(sort, 'order-asc').toLowerCase();
    if (normalized === 'order-desc') {
        return { displayOrder: -1, updatedAt: -1 };
    }
    if (normalized === 'newest') {
        return { createdAt: -1, updatedAt: -1 };
    }
    if (normalized === 'oldest') {
        return { createdAt: 1, updatedAt: 1 };
    }
    if (normalized === 'title-asc') {
        return { title: 1, displayOrder: 1 };
    }
    if (normalized === 'title-desc') {
        return { title: -1, displayOrder: 1 };
    }
    return { displayOrder: 1, createdAt: -1 };
}

function extractSlidePayload(body = {}) {
    const payload = {};

    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
        payload.title = normalizeText(body.title);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'subtitle')) {
        payload.subtitle = normalizeText(body.subtitle);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'buttonText')) {
        payload.buttonText = normalizeText(body.buttonText);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'buttonLink')) {
        payload.buttonLink = normalizeText(body.buttonLink);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'imageUrl')) {
        payload.imageUrl = normalizeText(body.imageUrl);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'imagePath')) {
        payload.imagePath = normalizeText(body.imagePath);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'displayOrder')) {
        payload.displayOrder = toNumber(body.displayOrder, 0);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
        payload.status = normalizeStatus(body.status);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'meta') && body.meta && typeof body.meta === 'object') {
        payload.meta = body.meta;
    }

    return payload;
}

exports.listHeroSlides = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_hero_slides' });
    try {
        const status = normalizeText(req.query?.status);
        const search = normalizeText(req.query?.search);
        const sort = normalizeText(req.query?.sort, 'order-asc');
        const limit = Math.min(300, Math.max(1, Number(req.query?.limit || 100) || 100));
        const page = Math.max(1, Number(req.query?.page || 1) || 1);

        if (isSqlite()) {
            const [slides, total] = await Promise.all([
                heroSlideDataService.listHeroSlides({ status, search, sort, limit, page }),
                heroSlideDataService.countHeroSlides({ status, search })
            ]);

            return res.json({
                success: true,
                slides: slides.map(serializeSlide),
                total,
                page,
                limit
            });
        }

        const query = {};
        if (status && status.toLowerCase() !== 'all') {
            query.status = normalizeStatus(status);
        }
        if (search) {
            query.$or = [
                { slideId: new RegExp(search, 'i') },
                { title: new RegExp(search, 'i') },
                { subtitle: new RegExp(search, 'i') },
                { buttonText: new RegExp(search, 'i') },
                { buttonLink: new RegExp(search, 'i') }
            ];
        }

        const skip = (page - 1) * limit;
        const [slides, total] = await Promise.all([
            HeroSlide.find(query).sort(buildSortQuery(sort)).skip(skip).limit(limit).lean(),
            HeroSlide.countDocuments(query)
        ]);

        return res.json({
            success: true,
            slides: slides.map(serializeSlide),
            total,
            page,
            limit
        });
    } catch (error) {
        logger.error('admin.hero_slides.list_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getHeroSlideById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_hero_slides' });
    try {
        const identifier = normalizeText(req.params.id);
        if (!identifier) {
            return res.status(400).json({ success: false, message: 'Slide id is required.' });
        }

        if (isSqlite()) {
            const slide = await heroSlideDataService.findHeroSlideById(identifier);
            if (!slide) {
                return res.status(404).json({ success: false, message: 'Hero slide not found.' });
            }
            return res.json({ success: true, slide: serializeSlide(slide) });
        }

        const slide = await HeroSlide.findOne({ slideId: identifier }).lean();
        if (!slide) {
            return res.status(404).json({ success: false, message: 'Hero slide not found.' });
        }

        return res.json({ success: true, slide: serializeSlide(slide) });
    } catch (error) {
        logger.error('admin.hero_slides.lookup_failed', { error, requestedSlideId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.createHeroSlide = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_hero_slides' });
    try {
        const body = req.body || {};
        const title = normalizeText(body.title);
        if (!title) {
            return res.status(400).json({ success: false, message: 'Slide title is required.' });
        }

        const buttonLink = normalizeText(body.buttonLink);
        if (!isValidButtonLink(buttonLink)) {
            return res.status(400).json({ success: false, message: 'Button link must be a valid internal path or http(s) URL.' });
        }

        const slideId = buildSlideId(body);
        let displayOrder = Object.prototype.hasOwnProperty.call(body, 'displayOrder')
            ? toNumber(body.displayOrder, 0)
            : null;

        if (displayOrder !== null) {
            if (!Number.isInteger(displayOrder) || displayOrder < 0) {
                return res.status(400).json({ success: false, message: 'Display order must be a whole number of 0 or greater.' });
            }

            const conflict = await assertUniqueDisplayOrder(displayOrder);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: `Display order ${displayOrder} is already in use.`
                });
            }
        }

        if (isSqlite()) {
            if (displayOrder === null) {
                displayOrder = await heroSlideDataService.nextDisplayOrder();
            }

            const document = await heroSlideDataService.createHeroSlide({
                slideId,
                title,
                subtitle: normalizeText(body.subtitle),
                buttonText: normalizeText(body.buttonText),
                buttonLink,
                imageUrl: normalizeText(body.imageUrl),
                imagePath: normalizeText(body.imagePath),
                displayOrder,
                status: normalizeStatus(body.status),
                meta: body.meta && typeof body.meta === 'object' ? body.meta : {}
            });

            return res.status(201).json({ success: true, slide: serializeSlide(document) });
        }

        if (displayOrder === null) {
            const latest = await HeroSlide.findOne({}).sort({ displayOrder: -1 }).select('displayOrder').lean();
            displayOrder = toNumber(latest?.displayOrder, -1) + 1;
        }

        const document = await HeroSlide.create({
            slideId,
            title,
            subtitle: normalizeText(body.subtitle),
            buttonText: normalizeText(body.buttonText),
            buttonLink,
            imageUrl: normalizeText(body.imageUrl),
            imagePath: normalizeText(body.imagePath),
            displayOrder,
            status: normalizeStatus(body.status),
            meta: body.meta && typeof body.meta === 'object' ? body.meta : {}
        });

        return res.status(201).json({ success: true, slide: serializeSlide(document) });
    } catch (error) {
        logger.error('admin.hero_slides.create_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateHeroSlide = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_hero_slides' });
    try {
        const identifier = normalizeText(req.params.id);
        if (!identifier) {
            return res.status(400).json({ success: false, message: 'Slide id is required.' });
        }

        const updates = extractSlidePayload(req.body || {});
        if (!Object.keys(updates).length) {
            return res.status(400).json({ success: false, message: 'No slide fields provided to update.' });
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'buttonLink') && !isValidButtonLink(updates.buttonLink)) {
            return res.status(400).json({ success: false, message: 'Button link must be a valid internal path or http(s) URL.' });
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'displayOrder')) {
            if (!Number.isInteger(updates.displayOrder) || updates.displayOrder < 0) {
                return res.status(400).json({ success: false, message: 'Display order must be a whole number of 0 or greater.' });
            }

            const conflict = await assertUniqueDisplayOrder(updates.displayOrder, identifier);
            if (conflict) {
                return res.status(409).json({
                    success: false,
                    message: `Display order ${updates.displayOrder} is already in use.`
                });
            }
        }

        if (isSqlite()) {
            const slide = await heroSlideDataService.updateHeroSlide(identifier, updates);
            if (!slide) {
                return res.status(404).json({ success: false, message: 'Hero slide not found.' });
            }
            return res.json({ success: true, slide: serializeSlide(slide) });
        }

        const slide = await HeroSlide.findOne({ slideId: identifier });
        if (!slide) {
            return res.status(404).json({ success: false, message: 'Hero slide not found.' });
        }

        Object.assign(slide, updates);
        await slide.save();
        return res.json({ success: true, slide: serializeSlide(slide) });
    } catch (error) {
        logger.error('admin.hero_slides.update_failed', { error, requestedSlideId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteHeroSlide = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_hero_slides' });
    try {
        const identifier = normalizeText(req.params.id);
        if (!identifier) {
            return res.status(400).json({ success: false, message: 'Slide id is required.' });
        }

        if (isSqlite()) {
            const slide = await heroSlideDataService.deleteHeroSlide(identifier);
            if (!slide) {
                return res.status(404).json({ success: false, message: 'Hero slide not found.' });
            }
            return res.json({ success: true, slideId: identifier });
        }

        const slide = await HeroSlide.findOneAndDelete({ slideId: identifier });
        if (!slide) {
            return res.status(404).json({ success: false, message: 'Hero slide not found.' });
        }

        return res.json({ success: true, slideId: identifier });
    } catch (error) {
        logger.error('admin.hero_slides.delete_failed', { error, requestedSlideId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
