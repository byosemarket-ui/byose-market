const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.heroSlides) {
        throw new Error('Hero slide data service requires the SQLite repository bundle.');
    }

    return repositories;
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
    return getRepos().heroSlides.update(slideId, updates);
}

async function deleteHeroSlide(slideId) {
    return getRepos().heroSlides.deleteBySlideId(slideId);
}

async function findHeroSlideByDisplayOrder(displayOrder, excludeSlideId = "") {
    return getRepos().heroSlides.findByDisplayOrder(displayOrder, excludeSlideId);
}

async function nextDisplayOrder() {
    return getRepos().heroSlides.nextDisplayOrder();
}

module.exports = {
    countHeroSlides,
    createHeroSlide,
    deleteHeroSlide,
    findHeroSlideByDisplayOrder,
    findHeroSlideById,
    listHeroSlides,
    nextDisplayOrder,
    updateHeroSlide
};
