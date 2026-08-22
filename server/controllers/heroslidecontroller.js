const config = require('../config/env');
const HeroSlide = require('../models/heroslide');
const heroSlideDataService = require('../services/heroslidedataservice');
const { deleteManagedFiles } = require('../services/uploadstorage.service');
const heroImage = require('../services/hero-image.service');
const getRealtimeEventService = require('../services/realtimeeventservice');
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

    const subtitle = normalizeText(source.subtitle);

    return {
        id: normalizeText(source.slideId || source.id || source._id),
        slideId: normalizeText(source.slideId || source.id || source._id),
        title: normalizeText(source.title),
        subtitle,
        description: subtitle,
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
    if (Object.prototype.hasOwnProperty.call(body, 'subtitle') || Object.prototype.hasOwnProperty.call(body, 'description')) {
        payload.subtitle = normalizeText(
            Object.prototype.hasOwnProperty.call(body, 'subtitle') ? body.subtitle : body.description
        );
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

function resolvePublicHeroImageUrl(serialized) {
    const source = serialized.imagePath || serialized.imageUrl || '';
    const optimized = heroImage.resolveOptimizedPublicUrl(source);
    if (optimized) {
        return optimized;
    }

    const normalized = normalizeText(serialized.imageUrl);
    if (normalized) {
        return normalized;
    }

    const imagePath = normalizeText(serialized.imagePath);
    if (!imagePath) {
        return '';
    }

    if (/^(?:https?:|\/)/i.test(imagePath)) {
        return imagePath;
    }

    return `/uploads/${imagePath.replace(/^\/+/, '')}`;
}

function serializePublicSlide(slide) {
    const serialized = serializeSlide(slide);
    const imageUrl = resolvePublicHeroImageUrl(serialized);
    return {
        id: serialized.id,
        slideId: serialized.slideId,
        title: serialized.title,
        subtitle: serialized.subtitle,
        description: serialized.description,
        buttonText: serialized.buttonText,
        buttonLink: serialized.buttonLink,
        imageUrl,
        imagePath: serialized.imagePath,
        displayOrder: serialized.displayOrder,
        status: serialized.status
    };
}

function requireHeroImage(imageUrl, imagePath) {
    return Boolean(normalizeText(imageUrl) || normalizeText(imagePath));
}

function isUniqueConstraintError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    const code = String(error?.code || '');
    return code === 'SQLITE_CONSTRAINT'
        || code === '11000'
        || message.includes('unique')
        || message.includes('duplicate');
}

function setPublicHeroCacheHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('Vary', 'Accept-Encoding');
}

function emitHeroRealtime(action, slides = []) {
    try {
        const realtimeService = getRealtimeEventService();
        realtimeService.emitHeroSlidesUpdated(action, Array.isArray(slides) ? slides : []);
    } catch (_error) {
        // Realtime is best-effort and must not break CRUD responses.
    }
}

async function safeDeleteMongoHeroImages(paths = [], excludeSlideId = '') {
    const candidates = Array.isArray(paths) ? paths : [paths];
    const removable = [];

    for (const entry of candidates) {
        const normalized = normalizeText(entry).replace(/^\/uploads\//, '').replace(/^\/+/, '');
        if (!normalized) {
            continue;
        }

        const publicUrl = `/uploads/${normalized}`;
        const query = {
            $or: [
                { imagePath: normalized },
                { imagePath: `/${normalized}` },
                { imageUrl: publicUrl },
                { imageUrl: { $regex: `${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` } }
            ]
        };
        if (excludeSlideId) {
            query.slideId = { $ne: excludeSlideId };
        }

        const count = await HeroSlide.countDocuments(query);
        if (count === 0) {
            removable.push(normalized);
        }
    }

    return deleteManagedFiles(removable);
}

exports.listPublicHeroSlides = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'public_hero_slides' });
    try {
        const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20) || 20));
        setPublicHeroCacheHeaders(res);

        if (isSqlite()) {
            const slides = await heroSlideDataService.listHeroSlides({
                status: 'active',
                sort: 'order-asc',
                limit,
                page: 1
            });

            return res.json({
                success: true,
                slides: slides.map(serializePublicSlide)
            });
        }

        const slides = await HeroSlide.find({ status: 'active' })
            .sort(buildSortQuery('order-asc'))
            .limit(limit)
            .lean();

        return res.json({
            success: true,
            slides: slides.map(serializePublicSlide)
        });
    } catch (error) {
        logger.error('public.hero_slides.list_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

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

        const imageUrl = normalizeText(body.imageUrl);
        const imagePath = normalizeText(body.imagePath);
        if (!requireHeroImage(imageUrl, imagePath)) {
            return res.status(400).json({ success: false, message: 'Hero slide image is required.' });
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

        const subtitle = normalizeText(
            Object.prototype.hasOwnProperty.call(body, 'subtitle') ? body.subtitle : body.description
        );

        if (isSqlite()) {
            if (displayOrder === null) {
                displayOrder = await heroSlideDataService.nextDisplayOrder();
            }

            const document = await heroSlideDataService.createHeroSlide({
                slideId,
                title,
                subtitle,
                buttonText: normalizeText(body.buttonText),
                buttonLink,
                imageUrl,
                imagePath,
                displayOrder,
                status: normalizeStatus(body.status),
                meta: body.meta && typeof body.meta === 'object' ? body.meta : {}
            });

            const created = serializeSlide(document);
            emitHeroRealtime('created', [created]);
            return res.status(201).json({ success: true, slide: created });
        }

        if (displayOrder === null) {
            const latest = await HeroSlide.findOne({}).sort({ displayOrder: -1 }).select('displayOrder').lean();
            displayOrder = toNumber(latest?.displayOrder, -1) + 1;
        }

        const document = await HeroSlide.create({
            slideId,
            title,
            subtitle,
            buttonText: normalizeText(body.buttonText),
            buttonLink,
            imageUrl,
            imagePath,
            displayOrder,
            status: normalizeStatus(body.status),
            meta: body.meta && typeof body.meta === 'object' ? body.meta : {}
        });

        const created = serializeSlide(document);
        emitHeroRealtime('created', [created]);
        return res.status(201).json({ success: true, slide: created });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(409).json({
                success: false,
                message: 'A hero slide with that display order or id already exists.'
            });
        }
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
            const existing = await heroSlideDataService.findHeroSlideById(identifier);
            if (!existing) {
                return res.status(404).json({ success: false, message: 'Hero slide not found.' });
            }

            const nextImageUrl = Object.prototype.hasOwnProperty.call(updates, 'imageUrl')
                ? updates.imageUrl
                : existing.imageUrl;
            const nextImagePath = Object.prototype.hasOwnProperty.call(updates, 'imagePath')
                ? updates.imagePath
                : existing.imagePath;
            if (!requireHeroImage(nextImageUrl, nextImagePath)) {
                return res.status(400).json({ success: false, message: 'Hero slide image is required.' });
            }

            const slide = await heroSlideDataService.updateHeroSlide(identifier, updates);
            if (!slide) {
                return res.status(404).json({ success: false, message: 'Hero slide not found.' });
            }
            const serialized = serializeSlide(slide);
            emitHeroRealtime('updated', [serialized]);
            return res.json({ success: true, slide: serialized });
        }

        const slide = await HeroSlide.findOne({ slideId: identifier });
        if (!slide) {
            return res.status(404).json({ success: false, message: 'Hero slide not found.' });
        }

        const previous = slide.toObject({ versionKey: false });
        const nextImageUrl = Object.prototype.hasOwnProperty.call(updates, 'imageUrl')
            ? updates.imageUrl
            : previous.imageUrl;
        const nextImagePath = Object.prototype.hasOwnProperty.call(updates, 'imagePath')
            ? updates.imagePath
            : previous.imagePath;
        if (!requireHeroImage(nextImageUrl, nextImagePath)) {
            return res.status(400).json({ success: false, message: 'Hero slide image is required.' });
        }

        Object.assign(slide, updates);
        await slide.save();
        await safeDeleteMongoHeroImages(
            heroSlideDataService.collectRemovedHeroImagePaths(previous, slide.toObject({ versionKey: false })),
            identifier
        );
        const serialized = serializeSlide(slide);
        emitHeroRealtime('updated', [serialized]);
        return res.json({ success: true, slide: serialized });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(409).json({
                success: false,
                message: 'A hero slide with that display order or id already exists.'
            });
        }
        logger.error('admin.hero_slides.update_failed', { error, requestedSlideId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.moveHeroSlide = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_hero_slides' });
    try {
        const identifier = normalizeText(req.params.id);
        if (!identifier) {
            return res.status(400).json({ success: false, message: 'Slide id is required.' });
        }

        const direction = normalizeText(req.body?.direction, 'up').toLowerCase() === 'down' ? 'down' : 'up';

        if (isSqlite()) {
            const result = await heroSlideDataService.moveHeroSlide(identifier, direction);
            if (!result?.slide) {
                return res.status(404).json({ success: false, message: 'Hero slide not found.' });
            }
            const serializedSlide = serializeSlide(result.slide);
            const serializedNeighbor = result.neighbor ? serializeSlide(result.neighbor) : null;
            if (result.moved) {
                emitHeroRealtime('moved', [serializedSlide, serializedNeighbor].filter(Boolean));
            }
            return res.json({
                success: true,
                moved: Boolean(result.moved),
                slide: serializedSlide,
                neighbor: serializedNeighbor
            });
        }

        const slides = await HeroSlide.find({}).sort(buildSortQuery('order-asc')).lean();
        const index = slides.findIndex((entry) => String(entry.slideId) === identifier);
        if (index < 0) {
            return res.status(404).json({ success: false, message: 'Hero slide not found.' });
        }

        const neighborIndex = direction === 'up' ? index - 1 : index + 1;
        if (neighborIndex < 0 || neighborIndex >= slides.length) {
            return res.json({
                success: true,
                moved: false,
                slide: serializeSlide(slides[index]),
                neighbor: null
            });
        }

        const left = await HeroSlide.findOne({ slideId: slides[index].slideId });
        const right = await HeroSlide.findOne({ slideId: slides[neighborIndex].slideId });
        const orderA = toNumber(left.displayOrder, 0);
        const orderB = toNumber(right.displayOrder, 0);
        const tempOrder = -1 - Math.abs(Date.now() % 100000000);

        left.displayOrder = tempOrder;
        await left.save();
        right.displayOrder = orderA;
        await right.save();
        left.displayOrder = orderB === orderA ? orderA + 1 : orderB;
        await left.save();

        const serializedLeft = serializeSlide(left);
        const serializedRight = serializeSlide(right);
        emitHeroRealtime('moved', [serializedLeft, serializedRight]);
        return res.json({
            success: true,
            moved: true,
            slide: serializedLeft,
            neighbor: serializedRight
        });
    } catch (error) {
        logger.error('admin.hero_slides.move_failed', { error, requestedSlideId: req.params.id });
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
            emitHeroRealtime('deleted', [serializeSlide(slide)]);
            return res.json({ success: true, slideId: identifier });
        }

        const slide = await HeroSlide.findOneAndDelete({ slideId: identifier });
        if (!slide) {
            return res.status(404).json({ success: false, message: 'Hero slide not found.' });
        }

        await safeDeleteMongoHeroImages(heroSlideDataService.collectHeroSlideManagedPaths(slide));
        emitHeroRealtime('deleted', [serializeSlide(slide)]);
        return res.json({ success: true, slideId: identifier });
    } catch (error) {
        logger.error('admin.hero_slides.delete_failed', { error, requestedSlideId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
