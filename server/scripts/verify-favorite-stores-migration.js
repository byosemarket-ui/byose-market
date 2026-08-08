const { initializeClient, closeClient, getClient } = require('../database/sqlite/client');
const { applyMigrations } = require('../database/sqlite/migrate');
const config = require('../config/env');
const storeRepository = require('../repositories/sqlite/store.repository');
const favoriteStoresDataService = require('../services/favoritestoresdataservice');

async function main() {
    initializeClient();
    applyMigrations(getClient(), config.sqlite.migrationsDir);

    const stores = getClient().prepare('SELECT public_id, slug, category, location FROM stores').all();
    console.log('stores', stores);

    const favoriteCols = getClient().prepare('PRAGMA table_info(favorite_stores)').all().map((c) => c.name);
    console.log('favorite_cols', favoriteCols);

    const platform = await storeRepository.findByPublicIdOrSlug('byose-market');
    if (!platform) {
        throw new Error('Platform store missing');
    }

    const fakeUser = { recordId: 1, id: '1' };
    const before = await favoriteStoresDataService.getFavoriteStores(fakeUser);
    console.log('before_count', before.count);

    const followed = await favoriteStoresDataService.followStore(fakeUser, { storeId: 'byose-market' });
    if (followed.error) throw new Error(followed.error);
    console.log('after_follow', followed.data.count);

    const again = await favoriteStoresDataService.followStore(fakeUser, { storeId: 'STORE-BYOSE' });
    if (again.error) throw new Error(again.error);
    console.log('duplicate_follow_count', again.data.count);

    const detail = await favoriteStoresDataService.getStoreByIdentifier('byose-market', fakeUser);
    if (detail.error) throw new Error(detail.error);
    console.log('store_detail', {
        name: detail.data.store.name,
        isFavorite: detail.data.store.isFavorite,
        productCount: detail.data.store.productCount,
        products: detail.data.products.length,
        notify: detail.data.store.notificationPrefs
    });

    const unfollowed = await favoriteStoresDataService.unfollowStore(fakeUser, 'byose-market');
    if (unfollowed.error) throw new Error(unfollowed.error);
    console.log('after_unfollow', unfollowed.data.count);

    console.log('OK');
    closeClient();
}

main().catch((error) => {
    console.error(error);
    try { closeClient(); } catch (_error) {}
    process.exit(1);
});
