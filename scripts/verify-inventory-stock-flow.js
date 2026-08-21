#!/usr/bin/env node
/**
 * Inventory / stock flow verification.
 * Uses a temporary SQLite database. Does not create live customer payments or orders.
 *
 * Run: node scripts/verify-inventory-stock-flow.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSourceGuards() {
  const cartController = read('server/controllers/cartcontroller.js');
  const cartRepo = read('server/repositories/sqlite/cart.repository.js');
  const orderController = read('server/controllers/ordercontroller.js');
  const orderRepo = read('server/repositories/sqlite/order.repository.js');
  const productRepo = read('server/repositories/sqlite/product.repository.js');
  const dpo = read('server/services/dpopayment.service.js');
  const inventory = read('server/services/inventory.service.js');
  const cartJs = read('services/byose-cart.js');

  assert(!cartController.includes('decrementStockForOrderItems'), 'cart controller must not decrement stock');
  assert(!cartRepo.includes('decrementStockForOrderItems'), 'cart repository must not decrement stock');
  assert(cartJs.includes('resolveLineStockFromCatalog'), 'cart still validates catalog stock without deducting it');
  assert(orderRepo.includes('decrementStockForOrderItems'), 'order create still reserves stock');
  assert(orderRepo.includes("transaction.immediate()"), 'order create uses an immediate write lock');
  assert(orderController.includes('attachReservationMetadata'), 'new orders record reservation metadata');
  assert(orderController.includes('function reReserveOrderStock'), 'admin restore must re-reserve stock');
  assert(orderController.includes('releaseOrRestoreForCancellation'), 'cancel uses the inventory service');
  assert(dpo.includes('applyInventoryForPaymentOutcome'), 'DPO verify applies inventory on trusted outcomes');
  assert(dpo.includes('verifyToken'), 'online success still comes from DPO verifyToken');
  assert(dpo.includes('isSettledPaidStatus'), 'duplicate paid callbacks stay idempotent');
  assert(inventory.includes('ONLINE_PAYMENT_SUCCESS'), 'inventory service records payment success');
  assert(inventory.includes('COD_ORDER_CREATED'), 'inventory service records COD reservation');
  assert(productRepo.includes("mode === 'commit'"), 'product repo can convert a reservation into a sale');
  assert(productRepo.includes('inventory_movements') || productRepo.includes('inventory-movement.repository'), 'stock changes are logged');
}

async function runDatabaseScenarios() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-inventory-'));
  const tmpDb = path.join(tmpDir, 'inventory-test.sqlite');
  process.env.SQLITE_DB_PATH = tmpDb;
  process.env.DB_CLIENT = 'sqlite';

  const { initializeClient, closeClient } = require('../server/database/sqlite/client');
  const { applyMigrations } = require('../server/database/sqlite/migrate');
  const config = require('../server/config/env');
  const db = initializeClient();
  applyMigrations(db, config.sqlite.migrationsDir);

  const productRepository = require('../server/repositories/sqlite/product.repository');
  const inventoryService = require('../server/services/inventory.service');

  function insertProduct({ catalogId, name, stock, variants }) {
    db.prepare(`
      INSERT INTO products (
        catalog_id, category_slug, name, title, stock, variants_json, metadata_json, status, visibility
      ) VALUES (?, 'general', ?, ?, ?, ?, '{}', 'active', 'both')
    `).run(
      catalogId,
      name,
      name,
      stock,
      JSON.stringify(variants || {})
    );
  }

  function loadProduct(catalogId) {
    const row = db.prepare('SELECT * FROM products WHERE catalog_id = ?').get(catalogId);
    const variants = JSON.parse(row.variants_json || '{}');
    const metadata = JSON.parse(row.metadata_json || '{}');
    const summary = productRepository.summarizeInventory(row.stock, variants, metadata);
    return { row, variants, metadata, summary };
  }

  function sizeStock(catalogId, colorName, size) {
    const product = loadProduct(catalogId);
    const color = (product.variants.colorVariants || []).find((entry) => entry.colorName === colorName);
    const sizeRow = (color?.sizes || []).find((entry) => String(entry.size) === String(size));
    return {
      available: Number(sizeRow?.stock || 0),
      reserved: Number(sizeRow?.reserved || 0),
      sold: Number(sizeRow?.sold || 0)
    };
  }

  insertProduct({ catalogId: 101, name: 'Simple Lamp', stock: 5 });
  insertProduct({
    catalogId: 202,
    name: 'Shoes',
    stock: 6,
    variants: {
      colorVariants: [
        {
          id: 'grey',
          colorName: 'Grey',
          sizes: [
            { size: '40', stock: 2, reserved: 0, sold: 0 },
            { size: '41', stock: 4, reserved: 0, sold: 0 }
          ]
        }
      ]
    }
  });

  const simpleItem = { productId: '101', quantity: 1, productName: 'Simple Lamp' };
  const grey40 = {
    productId: '202',
    quantity: 1,
    productName: 'Shoes',
    colorName: 'Grey',
    color: 'Grey',
    size: '40',
    sizeLabel: '40',
    variantKey: 'Color:grey|Size:40'
  };

  productRepository.decrementStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
    orderId: 'CART-SHOULD-NOT-RUN',
    reason: 'ORDER_RESERVED',
    mode: 'reserve'
  });
  assert(loadProduct(101).summary.availableStock === 4, 'A skipped: this call is order reserve, not cart');
  productRepository.releaseReservedStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
    orderId: 'CART-SHOULD-NOT-RUN',
    reason: 'STOCK_RELEASED'
  });
  assert(loadProduct(101).summary.availableStock === 5, 'A. releasing a test reserve returns stock to 5');

  productRepository.decrementStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
    orderId: 'COD-1',
    reason: 'COD_ORDER_CREATED',
    mode: 'reserve'
  });
  let simple = loadProduct(101);
  assert(simple.summary.availableStock === 4, 'B. COD qty 1: available becomes 4');
  assert(simple.summary.reservedStock === 1, 'B. COD qty 1: reserved becomes 1');
  productRepository.releaseReservedStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
    orderId: 'COD-1',
    reason: 'STOCK_RELEASED'
  });

  productRepository.decrementStockForOrderItems([{ ...simpleItem, quantity: 2 }], {
    orderId: 'COD-2',
    reason: 'COD_ORDER_CREATED',
    mode: 'reserve'
  });
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 3, 'C. COD qty 2: available becomes 3');
  productRepository.releaseReservedStockForOrderItems([{ ...simpleItem, quantity: 2 }], {
    orderId: 'COD-2',
    reason: 'STOCK_RELEASED'
  });

  const onlineOrder = {
    orderId: 'PAY-OK',
    paymentMethod: 'mtn',
    paymentType: 'pay_now',
    paymentStatus: 'awaiting_payment',
    items: [{ ...simpleItem, quantity: 1 }],
    payment: {}
  };
  inventoryService.attachReservationMetadata(onlineOrder);
  productRepository.decrementStockForOrderItems(onlineOrder.items, {
    orderId: 'PAY-OK',
    reason: 'ORDER_RESERVED',
    mode: 'reserve'
  });
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 4, 'D. before payment success available is reserved down to 4');
  inventoryService.commitStockForOrder(onlineOrder, { reason: 'ONLINE_PAYMENT_SUCCESS' });
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 4, 'D. successful payment keeps available at 4');
  assert(simple.summary.reservedStock === 0, 'D. successful payment clears reserved');
  assert(simple.summary.soldStock === 1, 'D. successful payment records sold = 1');

  inventoryService.commitStockForOrder(onlineOrder, { reason: 'ONLINE_PAYMENT_SUCCESS' });
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 4, 'G. duplicate success does not deduct again');
  assert(simple.summary.soldStock === 1, 'G. duplicate success does not increase sold');

  inventoryService.restoreStockForOrder(onlineOrder, { reason: 'STOCK_RESTORED' });
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 5, 'cleanup after paid scenario restores to 5');

  const failOrder = {
    orderId: 'PAY-FAIL',
    paymentMethod: 'card',
    paymentType: 'pay_now',
    paymentStatus: 'awaiting_payment',
    items: [{ ...simpleItem, quantity: 1 }],
    payment: {}
  };
  inventoryService.attachReservationMetadata(failOrder);
  productRepository.decrementStockForOrderItems(failOrder.items, {
    orderId: 'PAY-FAIL',
    reason: 'ORDER_RESERVED',
    mode: 'reserve'
  });
  inventoryService.applyInventoryForPaymentOutcome(failOrder, 'failed');
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 5, 'E. failed payment releases stock');
  inventoryService.applyInventoryForPaymentOutcome(failOrder, 'failed');
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 5, 'E. duplicate fail does not restore twice');

  const cancelOrder = {
    orderId: 'PAY-CANCEL',
    paymentMethod: 'mtn',
    paymentType: 'pay_now',
    paymentStatus: 'awaiting_payment',
    items: [{ ...simpleItem, quantity: 1 }],
    payment: {}
  };
  inventoryService.attachReservationMetadata(cancelOrder);
  productRepository.decrementStockForOrderItems(cancelOrder.items, {
    orderId: 'PAY-CANCEL',
    reason: 'ORDER_RESERVED',
    mode: 'reserve'
  });
  inventoryService.applyInventoryForPaymentOutcome(cancelOrder, 'cancelled');
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 5, 'F. cancelled payment releases stock');

  db.prepare('UPDATE products SET stock = 1, metadata_json = ? WHERE catalog_id = 101')
    .run(JSON.stringify({ reservedStock: 0, soldStock: 0 }));
  let secondFailed = false;
  productRepository.decrementStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
    orderId: 'LAST-A',
    reason: 'ORDER_RESERVED',
    mode: 'reserve'
  });
  try {
    productRepository.decrementStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
      orderId: 'LAST-B',
      reason: 'ORDER_RESERVED',
      mode: 'reserve'
    });
  } catch (error) {
    secondFailed = error.code === 'INSUFFICIENT_STOCK';
  }
  simple = loadProduct(101);
  assert(secondFailed, 'H. second customer cannot take the last unit');
  assert(simple.summary.availableStock === 0, 'H. last unit is reserved for the first customer');
  productRepository.releaseReservedStockForOrderItems([{ ...simpleItem, quantity: 1 }], {
    orderId: 'LAST-A',
    reason: 'ORDER_CANCELLED'
  });

  const cancelReserved = {
    orderId: 'CANCEL-1',
    paymentMethod: 'cod',
    paymentType: 'cod',
    paymentStatus: 'awaiting_delivery_payment',
    items: [{ ...simpleItem, quantity: 1 }],
    payment: {}
  };
  db.prepare('UPDATE products SET stock = 5, metadata_json = ? WHERE catalog_id = 101')
    .run(JSON.stringify({ reservedStock: 0, soldStock: 0 }));
  inventoryService.attachReservationMetadata(cancelReserved);
  productRepository.decrementStockForOrderItems(cancelReserved.items, {
    orderId: 'CANCEL-1',
    reason: 'COD_ORDER_CREATED',
    mode: 'reserve'
  });
  inventoryService.releaseOrRestoreForCancellation(cancelReserved);
  inventoryService.releaseOrRestoreForCancellation(cancelReserved);
  simple = loadProduct(101);
  assert(simple.summary.availableStock === 5, 'I. cancelled COD releases stock exactly once');

  productRepository.decrementStockForOrderItems([grey40], {
    orderId: 'VAR-1',
    reason: 'COD_ORDER_CREATED',
    mode: 'reserve'
  });
  const grey40After = sizeStock(202, 'Grey', '40');
  const grey41After = sizeStock(202, 'Grey', '41');
  assert(grey40After.available === 1, 'J. Grey/40 available becomes 1');
  assert(grey41After.available === 4, 'J. Grey/41 remains 4');

  closeClient();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_error) {
    // temp cleanup is best-effort
  }
}

async function main() {
  checkSourceGuards();
  await runDatabaseScenarios();

  if (failures.length) {
    console.error('FAIL — Inventory stock flow verification\n');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS — Inventory stock flow verification');
  console.log(' - Cart does not deduct stock');
  console.log(' - COD reserve, online commit, fail/cancel release');
  console.log(' - Duplicate callbacks and last-unit locking');
  console.log(' - Variant SKU stock isolation');
}

main().catch((error) => {
  console.error('FAIL — Inventory stock flow verification crashed');
  console.error(error);
  process.exit(1);
});
