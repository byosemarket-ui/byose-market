const { initializeClient, closeClient } = require('../database/sqlite/client');
const { applyMigrations } = require('../database/sqlite/migrate');
const config = require('../config/env');
const productRepository = require('../repositories/sqlite/product.repository');
const { queryCache } = require('../services/querycache.service');

async function main() {
    initializeClient();
    applyMigrations(require('../database/sqlite/client').getClient(), config.sqlite.migrationsDir);

    const samples = [
        {
            catalogId: 9001,
            name: 'Samsung Galaxy A15',
            category: 'phones',
            price: 280000,
            stock: 12,
            status: 'active',
            description: 'Android smartphone with AMOLED display',
            keywords: ['samsung', 'phone', 'android'],
            badge: 'Samsung'
        },
        {
            catalogId: 9002,
            name: 'Nike Air Runner',
            category: 'shoes',
            price: 95000,
            stock: 8,
            status: 'active',
            description: 'Comfortable running shoes for daily wear',
            keywords: ['nike', 'shoes', 'sneakers'],
            badge: 'Nike'
        },
        {
            catalogId: 9003,
            name: 'Leather Tote Bag',
            category: 'bags',
            price: 65000,
            stock: 5,
            status: 'active',
            description: 'Handcrafted leather tote bag',
            keywords: ['bag', 'leather'],
            badge: 'Byose'
        },
        {
            catalogId: 9004,
            name: 'Draft Hidden Item',
            category: 'phones',
            price: 1000,
            stock: 1,
            status: 'draft',
            description: 'Should not appear in public lists',
            keywords: ['hidden']
        }
    ];

    for (const sample of samples) {
        await productRepository.save(sample, { identifier: sample.catalogId });
    }

    const publicList = await productRepository.list({ publishedOnly: true, limit: 50, columns: 'card' });
    const phones = await productRepository.list({ category: 'phones', publishedOnly: true, limit: 50 });
    const page2 = await productRepository.list({ publishedOnly: true, limit: 1, offset: 1, columns: 'card' });
    const search = await productRepository.searchCandidates({ query: 'samsung', patterns: ['%samsung%'], limit: 20 });
    const shoeSearch = await productRepository.searchCandidates({ query: 'nike shoes', patterns: ['%nike%'], limit: 20 });

    queryCache.bump('products');
    const t0 = Date.now();
    await productRepository.list({ publishedOnly: true, limit: 120, columns: 'card' });
    const listMs = Date.now() - t0;

    const t1 = Date.now();
    await productRepository.searchCandidates({ query: 'samsung', patterns: ['%samsung%'], limit: 40 });
    const searchMs = Date.now() - t1;

    const one = await productRepository.findByIdentifier(9001);

    console.log(JSON.stringify({
        publicCount: publicList.length,
        publicIncludesDraft: publicList.some((item) => item.catalogId === 9004),
        phonesCount: phones.length,
        page2CatalogId: page2[0]?.catalogId || null,
        searchHits: search.map((item) => item.catalogId),
        shoeHits: shoeSearch.map((item) => item.catalogId),
        ftsEnabled: productRepository.hasFtsIndex(),
        publishedColumn: productRepository.hasPublishedColumn(),
        productName: one?.name || null,
        listMs,
        searchMs
    }, null, 2));

    closeClient();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
