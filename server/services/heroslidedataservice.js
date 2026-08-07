const { getRepositoryBundle } = require('../repositories');
const { deleteManagedFiles, normalizeManagedPath } = require('./uploadstorage.service');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.heroSlides) {
        throw new Error('Hero slide data service requires the SQLite repository bundle.');
    }

    return repositories;
}

function collectHeroSlideManagedPaths(slide) {
    const candidates = [
        slide?.imagePath,
        slide?.imageUrl
    ];

    return Array.from(new Set(
        candidates.map((entry) => normalizeManagedPath(entry)).filter(Boolean)
    ));
}

function collectRemovedHeroImagePaths(previousSlide, nextSlide) {
    const previousPaths = new Set(collectHeroSlideManagedPaths(previousSlide));
    const nextPaths = new Set(collectHeroSlideManagedPaths(nextSlide));
    return Array.from(previousPaths).filter((entry) => !nextPaths.has(entry));
}

async function deleteUnreferencedHeroImages(paths = [], excludeSlideId = '') {
    const candidates = Array.isArray(paths) ? paths : [paths];
    const removable = [];

    for (const entry of candidates) {
        const normalized = normalizeManagedPath(entry);
        if (!normalized) {
            continue;
        }

        const references = await getRepos().heroSlides.countByImageReference(normalized, excludeSlideId);
        if (references === 0) {
            removable.push(normalized);
        }
    }

    return deleteManagedFiles(removable);
}

async function createHeroSlide(payload) {
    return getRepos().heroSlides.create(payload);
}

async function listHeroSlides(options) {
    return getRepos().heroSlides.list(options);
}

async function countHeroSlides(options) {
    return getRepos().heroSlides.count(options);
}

async function findHeroSlideById(slideId) {
    return getRepos().heroSlides.findBySlideId(slideId);
}

async function updateHeroSlide(slideId, updates) {
    const existing = await findHeroSlideById(slideId);
    if (!existing) {
        return null;
    }

    const saved = await getRepos().heroSlides.update(slideId, updates);
    if (saved) {
        await deleteUnreferencedHeroImages(
            collectRemovedHeroImagePaths(existing, saved),
            slideId
        );
    }
    return saved;
}

async function deleteHeroSlide(slideId) {
    const deleted = await getRepos().heroSlides.deleteBySlideId(slideId);
    if (deleted) {
        await deleteUnreferencedHeroImages(collectHeroSlideManagedPaths(deleted));
    }
    return deleted;
}

async function findHeroSlideByDisplayOrder(displayOrder, excludeSlideId = "") {
    return getRepos().heroSlides.findByDisplayOrder(displayOrder, excludeSlideId);
}

async function nextDisplayOrder() {
    return getRepos().heroSlides.nextDisplayOrder();
}

async function swapHeroSlideDisplayOrder(slideIdA, slideIdB) {
    return getRepos().heroSlides.swapDisplayOrders(slideIdA, slideIdB);
}

async function moveHeroSlide(slideId, direction = 'up') {
    const normalizedDirection = String(direction || 'up').toLowerCase() === 'down' ? 'down' : 'up';
    const slides = await listHeroSlides({
        status: 'all',
        sort: 'order-asc',
        limit: 300,
        page: 1
    });

    const index = slides.findIndex((slide) => String(slide.slideId || slide.id) === String(slideId));
    if (index < 0) {
        return null;
    }

    const neighborIndex = normalizedDirection === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= slides.length) {
        return {
            slide: slides[index],
            neighbor: null,
            moved: false
        };
    }

    const swapped = await swapHeroSlideDisplayOrder(
        slides[index].slideId,
        slides[neighborIndex].slideId
    );

    return {
        slide: swapped?.left || null,
        neighbor: swapped?.right || null,
        moved: Boolean(swapped)
    };
}

module.exports = {
    collectHeroSlideManagedPaths,
    collectRemovedHeroImagePaths,
    countHeroSlides,
    createHeroSlide,
    deleteHeroSlide,
    deleteUnreferencedHeroImages,
    findHeroSlideByDisplayOrder,
    findHeroSlideById,
    listHeroSlides,
    moveHeroSlide,
    nextDisplayOrder,
    swapHeroSlideDisplayOrder,
    updateHeroSlide
};
