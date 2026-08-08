-- Align curated store product scopes with real category slugs

UPDATE stores
SET
    name = 'BYOSE Shoes',
    slug = 'byose-shoes',
    description = 'Footwear and everyday shoes from BYOSE Market.',
    category = 'Shoes',
    metadata_json = '{"isPlatformStore":false,"productScope":"category","categorySlug":"shoes"}',
    updated_at = CURRENT_TIMESTAMP
WHERE public_id = 'STORE-FASHION';

UPDATE stores
SET
    name = 'BYOSE Phones',
    slug = 'byose-phones',
    description = 'Phones and mobile essentials with trusted local delivery.',
    category = 'Phones',
    metadata_json = '{"isPlatformStore":false,"productScope":"category","categorySlug":"phones"}',
    updated_at = CURRENT_TIMESTAMP
WHERE public_id = 'STORE-ELECTRONICS';
