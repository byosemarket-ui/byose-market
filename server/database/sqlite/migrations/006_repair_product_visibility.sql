-- Repair products hidden by the stock-forced inactive bug.
-- When publishStatus is active but status was set to inactive due to zero stock,
-- restore storefront visibility while keeping intentionally inactive products unchanged.

UPDATE products
SET
    status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE lower(COALESCE(status, '')) = 'inactive'
  AND (
    json_extract(metadata_json, '$.publishStatus') IS NULL
    OR lower(json_extract(metadata_json, '$.publishStatus')) IN ('active', 'published', 'live')
  );
