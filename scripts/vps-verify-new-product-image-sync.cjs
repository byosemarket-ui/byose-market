#!/usr/bin/env node
/**
 * Live VPS verification:
 * 1) Mint short-lived admin JWT
 * 2) Copy an existing product original into a new upload filename
 * 3) Create product pointing at that image
 * 4) Assert card WebP exists + catalog card URL uses /products/cards/
 * 5) Assert product:created is in recent catalog events
 * 6) Delete product and assert product:deleted
 *
 * Does not print secrets or tokens.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/root/BYOSESEMARKET4';
const UPLOADS = '/var/lib/byosemarket/uploads';

function loadEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx < 0) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  });
  return out;
}

function request(method, urlPath, { token = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path: urlPath,
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      timeout: 45000
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(raw || '{}'); } catch (_e) { json = { raw: String(raw || '').slice(0, 400) }; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function cryptoRandomId(email) {
  return crypto.createHash('sha256').update(String(email || 'admin')).digest('hex').slice(0, 24);
}

function pickSourceOriginal() {
  const productsDir = path.join(UPLOADS, 'products');
  const entries = fs.readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
    .map((entry) => entry.name);
  if (!entries.length) {
    throw new Error('no_source_original');
  }
  return path.join(productsDir, entries[0]);
}

(async () => {
  const env = loadEnv(path.join(ROOT, '.env'));
  Object.assign(process.env, env);

  const { generateToken } = require(path.join(ROOT, 'server/utils/token'));
  const productCardImage = require(path.join(ROOT, 'server/services/product-card-image.service'));

  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!adminEmail || !process.env.JWT_SECRET) {
    console.log(JSON.stringify({ ok: false, reason: 'missing_admin_email_or_jwt_secret' }));
    process.exit(2);
  }

  let adminId = cryptoRandomId(adminEmail);
  try {
    const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
    const dbPath = process.env.SQLITE_DB_PATH || path.join(ROOT, 'server/database/byosemarket.sqlite');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT public_id FROM users WHERE lower(email) = ? AND role = 'admin' LIMIT 1").get(adminEmail);
    if (row?.public_id) adminId = row.public_id;
    db.close();
  } catch (_e) {
    // Keep hash-based id.
  }

  const token = generateToken({ id: adminId, email: adminEmail, role: 'admin' }, { expiresIn: '10m' });
  const stamp = Date.now();
  const source = pickSourceOriginal();
  const ext = path.extname(source) || '.jpg';
  const fileName = `sync-img-${stamp}${ext}`;
  const managedPath = `products/${fileName}`;
  const dest = path.join(UPLOADS, 'products', fileName);
  fs.copyFileSync(source, dest);

  const t0 = Date.now();
  const create = await request('POST', '/api/admin/products', {
    token,
    body: {
      name: `Image Sync Test ${stamp}`,
      title: `Image Sync Test ${stamp}`,
      price: 2500,
      stock: 3,
      visibility: 'both',
      status: 'active',
      category: 'shoes',
      image: managedPath,
      mainImage: managedPath,
      gallery: [managedPath]
    }
  });
  const createMs = Date.now() - t0;

  if (create.status >= 400 || !create.json?.success) {
    console.log(JSON.stringify({
      ok: false,
      reason: 'create_failed',
      status: create.status,
      message: create.json?.message || null,
      createMs
    }));
    process.exit(4);
  }

  const product = create.json.product || {};
  const productId = product.id || product.catalogId;
  const cardFromCreate = String(product.cardImage || '');
  const cardManaged = productCardImage.ensureCardImage(managedPath);
  const cardAbsolute = cardManaged
    ? path.join(UPLOADS, cardManaged.replace(/\//g, path.sep))
    : '';
  const cardFileReady = Boolean(cardAbsolute && fs.existsSync(cardAbsolute) && fs.statSync(cardAbsolute).size > 0);

  await new Promise((r) => setTimeout(r, 400));

  const list = await request('GET', '/api/products?limit=500&fields=card');
  const listed = (list.json?.products || []).find((entry) => Number(entry.id) === Number(productId)
    || Number(entry.catalogId) === Number(productId));
  const listedImage = String(listed?.cardImage || listed?.mainImage || listed?.image || '');
  const listedIsCard = /\/products\/cards\/[^/?#]+\.webp/i.test(listedImage);

  const events = await request('GET', `/api/realtime/catalog-events?since=${stamp - 5000}&limit=40`);
  const eventTypes = (events.json?.events || []).map((event) => String(event.type || ''));
  const sawCreated = eventTypes.includes('product:created');

  const del = await request('DELETE', `/api/admin/products/${encodeURIComponent(String(productId))}`, { token });
  await new Promise((r) => setTimeout(r, 400));
  const eventsAfter = await request('GET', `/api/realtime/catalog-events?since=${stamp - 5000}&limit=40`);
  const typesAfter = (eventsAfter.json?.events || []).map((event) => String(event.type || ''));
  const sawDeleted = typesAfter.includes('product:deleted');

  const listAfter = await request('GET', '/api/products?limit=500&fields=card');
  const stillListed = (listAfter.json?.products || []).some((entry) => Number(entry.id) === Number(productId)
    || Number(entry.catalogId) === Number(productId));

  // Cleanup copied original + card if present.
  try { fs.unlinkSync(dest); } catch (_e) { /* ignore */ }
  if (cardAbsolute) {
    try { fs.unlinkSync(cardAbsolute); } catch (_e) { /* ignore */ }
  }

  const ok = Boolean(
    productId
    && cardFileReady
    && listed
    && listedIsCard
    && sawCreated
    && del.json?.success
    && sawDeleted
    && !stillListed
  );

  console.log(JSON.stringify({
    ok,
    productId,
    createMs,
    cardsReady: Boolean(create.json?.product?.cardImage),
    cardFromCreateIsCard: /\/products\/cards\//i.test(cardFromCreate),
    cardFileReady,
    listedIsCard,
    listedImageTail: listedImage.slice(-80),
    sawCreated,
    sawDeleted,
    deletedOk: Boolean(del.json?.success),
    stillListed,
    commitHint: 'check git rev-parse --short HEAD'
  }, null, 2));

  process.exit(ok ? 0 : 5);
})().catch((error) => {
  console.log(JSON.stringify({ ok: false, reason: String(error && error.message || error) }));
  process.exit(1);
});
