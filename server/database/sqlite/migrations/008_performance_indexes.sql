-- Performance indexes, published flag, integrity repairs, and FTS search index.

-- Denormalized publish flag for sargable public product queries.
ALTER TABLE products ADD COLUMN is_published INTEGER NOT NULL DEFAULT 1;

UPDATE products
SET is_published = CASE
    WHEN lower(COALESCE(json_extract(metadata_json, '$.publishStatus'), status, 'active')) IN ('draft', 'archived', 'disabled') THEN 0
    WHEN lower(COALESCE(status, 'active')) = 'draft' THEN 0
    WHEN lower(COALESCE(status, 'active')) = 'inactive'
         AND lower(COALESCE(json_extract(metadata_json, '$.publishStatus'), 'active')) = 'active' THEN 1
    WHEN lower(COALESCE(status, 'active')) IN ('active', 'published', 'live', '') THEN 1
    WHEN lower(COALESCE(json_extract(metadata_json, '$.publishStatus'), '')) = 'active' THEN 1
    ELSE 0
END;

-- Match list / search ORDER BY for public and admin catalogs.
CREATE INDEX IF NOT EXISTS idx_products_list_sort
    ON products (priority DESC, order_index DESC, updated_at DESC, catalog_id ASC);

CREATE INDEX IF NOT EXISTS idx_products_category_list_sort
    ON products (category_slug, priority DESC, order_index DESC, updated_at DESC, catalog_id ASC);

CREATE INDEX IF NOT EXISTS idx_products_published_list_sort
    ON products (is_published, priority DESC, order_index DESC, updated_at DESC, catalog_id ASC);

CREATE INDEX IF NOT EXISTS idx_products_published_category_list_sort
    ON products (is_published, category_slug, priority DESC, order_index DESC, updated_at DESC, catalog_id ASC);

CREATE INDEX IF NOT EXISTS idx_product_images_product_sort_id
    ON product_images (product_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_categories_sort_name
    ON categories (sort_order DESC, name ASC);

CREATE INDEX IF NOT EXISTS idx_reviews_product_status_created
    ON reviews (product_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_legacy_id
    ON orders (legacy_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_email_created
    ON orders (user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_phone_number_created
    ON orders (phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_activities_created
    ON customer_activities (created_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_activities_client_id
    ON customer_activities (client_activity_id);

CREATE INDEX IF NOT EXISTS idx_carts_updated_created
    ON carts (updated_at DESC, created_at DESC);

-- Safe integrity repairs
DELETE FROM product_images
WHERE product_id NOT IN (SELECT id FROM products);

UPDATE products
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND category_id NOT IN (SELECT id FROM categories);

UPDATE products
SET category_id = (
    SELECT c.id FROM categories c
    WHERE lower(c.slug) = lower(products.category_slug)
    LIMIT 1
)
WHERE category_slug IS NOT NULL
  AND category_slug != ''
  AND EXISTS (
      SELECT 1 FROM categories c WHERE lower(c.slug) = lower(products.category_slug)
  )
  AND (
      category_id IS NULL
      OR category_id NOT IN (SELECT id FROM categories)
      OR category_id != (
          SELECT c.id FROM categories c
          WHERE lower(c.slug) = lower(products.category_slug)
          LIMIT 1
      )
  );

CREATE TABLE IF NOT EXISTS catalog_sequences (
    name TEXT PRIMARY KEY,
    last INTEGER NOT NULL
);

INSERT INTO catalog_sequences (name, last)
VALUES ('products', (SELECT COALESCE(MAX(catalog_id), 0) FROM products))
ON CONFLICT(name) DO UPDATE SET
    last = CASE
        WHEN excluded.last > catalog_sequences.last THEN excluded.last
        ELSE catalog_sequences.last
    END;

-- Full-text search over the fields that matter for storefront search.
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    name,
    title,
    description,
    short_description,
    category_slug,
    badge,
    keywords_json,
    content='products',
    content_rowid='id',
    tokenize='porter unicode61'
);

INSERT INTO products_fts(rowid, name, title, description, short_description, category_slug, badge, keywords_json)
SELECT id, name, title, description, short_description, category_slug, badge, keywords_json
FROM products;

CREATE TRIGGER IF NOT EXISTS products_fts_ai AFTER INSERT ON products BEGIN
    INSERT INTO products_fts(rowid, name, title, description, short_description, category_slug, badge, keywords_json)
    VALUES (new.id, new.name, new.title, new.description, new.short_description, new.category_slug, new.badge, new.keywords_json);
END;

CREATE TRIGGER IF NOT EXISTS products_fts_ad AFTER DELETE ON products BEGIN
    INSERT INTO products_fts(products_fts, rowid, name, title, description, short_description, category_slug, badge, keywords_json)
    VALUES ('delete', old.id, old.name, old.title, old.description, old.short_description, old.category_slug, old.badge, old.keywords_json);
END;

CREATE TRIGGER IF NOT EXISTS products_fts_au AFTER UPDATE ON products BEGIN
    INSERT INTO products_fts(products_fts, rowid, name, title, description, short_description, category_slug, badge, keywords_json)
    VALUES ('delete', old.id, old.name, old.title, old.description, old.short_description, old.category_slug, old.badge, old.keywords_json);
    INSERT INTO products_fts(rowid, name, title, description, short_description, category_slug, badge, keywords_json)
    VALUES (new.id, new.name, new.title, new.description, new.short_description, new.category_slug, new.badge, new.keywords_json);
END;

ANALYZE;
