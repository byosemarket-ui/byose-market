-- Favorite stores enrichment + future notification preferences

ALTER TABLE stores ADD COLUMN category TEXT NOT NULL DEFAULT 'Marketplace';
ALTER TABLE stores ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN rating REAL NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE favorite_stores ADD COLUMN notify_new_products INTEGER NOT NULL DEFAULT 1;
ALTER TABLE favorite_stores ADD COLUMN notify_offers INTEGER NOT NULL DEFAULT 1;
ALTER TABLE favorite_stores ADD COLUMN notify_announcements INTEGER NOT NULL DEFAULT 1;

UPDATE stores
SET
    category = 'Marketplace',
    location = 'Kigali, Rwanda',
    metadata_json = '{"isPlatformStore":true,"productScope":"all"}',
    updated_at = CURRENT_TIMESTAMP
WHERE public_id = 'STORE-BYOSE';

INSERT OR IGNORE INTO stores (
    public_id, name, slug, description, logo, banner, status, category, location, rating, review_count, metadata_json, created_at, updated_at
) VALUES (
    'STORE-FASHION',
    'BYOSE Shoes',
    'byose-shoes',
    'Footwear and everyday shoes from BYOSE Market.',
    '/img/logo.png',
    '',
    'active',
    'Shoes',
    'Kigali, Rwanda',
    4.6,
    28,
    '{"isPlatformStore":false,"productScope":"category","categorySlug":"shoes"}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO stores (
    public_id, name, slug, description, logo, banner, status, category, location, rating, review_count, metadata_json, created_at, updated_at
) VALUES (
    'STORE-ELECTRONICS',
    'BYOSE Phones',
    'byose-phones',
    'Phones and mobile essentials with trusted local delivery.',
    '/img/logo.png',
    '',
    'active',
    'Phones',
    'Kigali, Rwanda',
    4.5,
    19,
    '{"isPlatformStore":false,"productScope":"category","categorySlug":"phones"}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
