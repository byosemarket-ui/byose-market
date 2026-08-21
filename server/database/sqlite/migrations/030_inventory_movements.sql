CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    catalog_id TEXT NOT NULL DEFAULT '',
    product_name TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    variant_key TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    order_id TEXT NOT NULL DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT '',
    movement_type TEXT NOT NULL,
    quantity_before INTEGER NOT NULL DEFAULT 0,
    quantity_changed INTEGER NOT NULL DEFAULT 0,
    quantity_after INTEGER NOT NULL DEFAULT 0,
    reserved_before INTEGER NOT NULL DEFAULT 0,
    reserved_changed INTEGER NOT NULL DEFAULT 0,
    reserved_after INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    reference_id TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
    ON inventory_movements (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
    ON inventory_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_catalog
    ON inventory_movements (catalog_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
    ON inventory_movements (movement_type, created_at DESC);
