/**
 * STEP 5 end-to-end probe: pages, APIs, cart, orders, security posture.
 * Run: node scripts/verify-e2e-step5.mjs
 * Env: BYOSE_SITE_ORIGIN=http://127.0.0.1:5000
 */

const SITE = (process.env.BYOSE_SITE_ORIGIN || 'http://127.0.0.1:5000').replace(/\/+$/, '');

const PAGES = [
  '/',
  '/index.html',
  '/shop.html',
  '/products.html',
  '/search.html',
  '/categories.html',
  '/cart.html',
  '/checkout.html',
  '/contact.html',
  '/login.html',
  '/signup.html',
  '/forgot-password.html',
  '/product-details1.html',
  '/details/product-details1.html',
  '/account/account.html',
  '/account/pages/wishlist.html',
  '/account/orders/all.html',
  '/account/settings/profile.html',
  '/orders/shipping.html',
  '/orders/checkout.html',
  '/orders/payment.html',
  '/orders/order-success.html',
  '/admin/dashboard.html',
  '/admin/products/index.html',
  '/admin/orders/index.html',
  '/admin/customers/index.html',
  '/admin/categories/index.html',
  '/admin/settings/index.html',
  '/admin/admin-login.html',
  '/admin/analytics.html',
  '/admin/messages/index.html'
];

const failures = [];
const warnings = [];
const results = [];

function record(ok, name, detail = '') {
  results.push({ ok, name, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

async function probe(method, path, options = {}) {
  const started = Date.now();
  const url = path.startsWith('http') ? path : `${SITE}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: '*/*',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: 'manual'
    });
    const contentType = String(response.headers.get('content-type') || '');
    let body = null;
    const text = await response.text();
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch (_error) {
        body = null;
      }
    }
    return {
      status: response.status,
      ok: response.ok,
      ms: Date.now() - started,
      headers: response.headers,
      text,
      body,
      location: response.headers.get('location') || ''
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      ms: Date.now() - started,
      error: String(error?.message || error)
    };
  }
}

function expectStatus(name, response, allowed) {
  const codes = Array.isArray(allowed) ? allowed : [allowed];
  if (!response || response.error) {
    record(false, name, response?.error || 'no response');
    return false;
  }
  if (!codes.includes(response.status)) {
    record(false, name, `status ${response.status}, expected ${codes.join('|')}`);
    return false;
  }
  record(true, name, `${response.status} in ${response.ms}ms`);
  return true;
}

async function main() {
  console.log(`[verify-e2e-step5] Probing ${SITE}`);

  // Health / security posture
  const healthz = await probe('GET', '/healthz');
  expectStatus('GET /healthz', healthz, 200);
  if (healthz.body?.database || healthz.body?.uploads?.rootDir) {
    record(false, 'healthz.no_sensitive_paths', 'leaks database/uploads paths');
  } else {
    record(true, 'healthz.no_sensitive_paths', 'slim payload');
  }

  const envLeak = await probe('GET', '/.env');
  expectStatus('block /.env', envLeak, [404, 403]);

  const serverLeak = await probe('GET', '/server/server.js');
  expectStatus('block /server/server.js', serverLeak, [404, 403]);

  const sqliteLeak = await probe('GET', '/server/database/byosemarket.sqlite');
  expectStatus('block sqlite', sqliteLeak, [404, 403]);

  const metrics = await probe('GET', '/metrics');
  if (![200, 401, 404].includes(metrics.status)) {
    record(false, 'GET /metrics', `unexpected ${metrics.status}`);
  } else {
    record(true, 'GET /metrics', String(metrics.status));
  }

  // Pages
  for (const page of PAGES) {
    const response = await probe('GET', page);
    const allowed = page === '/' ? [200] : [200, 301, 302, 307, 308];
    if (!response.error && allowed.includes(response.status)) {
      record(true, `page ${page}`, `${response.status} ${response.ms}ms`);
      if (response.ms > 2000) {
        warnings.push(`slow page ${page}: ${response.ms}ms`);
      }
    } else {
      record(false, `page ${page}`, response.error || `status ${response.status}`);
    }
  }

  // Public product APIs
  const productsCard = await probe('GET', '/api/products?limit=50&fields=card');
  expectStatus('GET /api/products?fields=card', productsCard, 200);
  const productCount = Array.isArray(productsCard.body?.products) ? productsCard.body.products.length : 0;
  if (productCount < 1) {
    warnings.push('catalog has 0 products — seeded samples may be missing');
  } else {
    record(true, 'products.visible', `${productCount} products`);
  }

  const categoryFilter = await probe('GET', '/api/products?category=phones&fields=card');
  expectStatus('GET /api/products?category=phones', categoryFilter, 200);

  const page1 = await probe('GET', '/api/products?page=1&limit=1&fields=card');
  const page2 = await probe('GET', '/api/products?page=2&limit=1&fields=card');
  expectStatus('pagination page1', page1, 200);
  expectStatus('pagination page2', page2, 200);

  const search = await probe('GET', '/api/products/search?q=samsung&limit=10');
  expectStatus('search samsung', search, 200);

  const suggestions = await probe('GET', '/api/products/search/suggestions?q=sam&limit=5');
  expectStatus('search suggestions', suggestions, 200);

  const popular = await probe('GET', '/api/products/search/popular');
  expectStatus('search popular', popular, 200);

  const productId = productsCard.body?.products?.[0]?.id || productsCard.body?.products?.[0]?.catalogId || 9001;
  const productOne = await probe('GET', `/api/products/${productId}`);
  expectStatus(`GET /api/products/${productId}`, productOne, [200, 404]);

  // Auth / admin protection
  const adminDash = await probe('GET', '/api/admin/dashboard');
  expectStatus('admin dashboard protected', adminDash, 401);

  const adminProducts = await probe('GET', '/api/admin/products');
  expectStatus('admin products protected', adminProducts, 401);

  const adminOrders = await probe('GET', '/api/admin/orders');
  expectStatus('admin orders protected', adminOrders, 401);

  const adminCustomers = await probe('GET', '/api/admin/customers');
  expectStatus('admin customers protected', adminCustomers, 401);

  const adminSettings = await probe('GET', '/api/admin/settings');
  expectStatus('admin settings protected', adminSettings, 401);

  const uploadConfig = await probe('GET', '/api/uploads/config');
  expectStatus('upload config protected', uploadConfig, 401);

  const uploadHealth = await probe('GET', '/api/uploads/health');
  expectStatus('upload health public', uploadHealth, 200);
  if (uploadHealth.body?.uploads?.rootDir || uploadHealth.body?.uploads?.buckets?.[0]?.directory) {
    record(false, 'upload health no paths', 'still exposes directories');
  } else {
    record(true, 'upload health no paths', 'paths stripped');
  }

  // Auth validation
  const badLogin = await probe('POST', '/api/auth/login', {
    body: { identifier: 'nobody@example.com', password: 'wrong-password-123' }
  });
  expectStatus('login invalid credentials', badLogin, [401, 429]);
  if (badLogin.body?.message && /account not found|incorrect password/i.test(badLogin.body.message)) {
    record(false, 'login enumeration', badLogin.body.message);
  } else if (badLogin.status === 401) {
    record(true, 'login enumeration', badLogin.body?.message || 'uniform message');
  }

  // Cart flow (guest)
  const guestHeaders = { 'X-Guest-Id': `e2e-${Date.now()}` };
  const cartAdd = await probe('POST', '/api/cart/add', {
    headers: guestHeaders,
    body: {
      productId: String(productId),
      quantity: 1,
      name: 'E2E Product',
      price: 1000
    }
  });
  if (![200, 201, 400, 401, 404].includes(cartAdd.status)) {
    record(false, 'cart add', `status ${cartAdd.status}`);
  } else {
    record(true, 'cart add', `${cartAdd.status} ${cartAdd.ms}ms`);
  }

  const cartGet = await probe('GET', '/api/cart', { headers: guestHeaders });
  expectStatus('cart get', cartGet, [200, 401]);

  // Contact form
  const contact = await probe('POST', '/api/messages', {
    body: {
      name: 'E2E Tester',
      email: 'e2e@example.com',
      phone: '0780000000',
      subject: 'E2E contact',
      message: 'Automated end-to-end contact message for verification.'
    }
  });
  expectStatus('contact message', contact, [200, 201, 400]);

  // Order create validation (missing payload should fail safely)
  const orderBad = await probe('POST', '/api/orders', { body: {} });
  expectStatus('order validation', orderBad, [400, 401, 422]);

  // Order create with valid storefront-shaped payload
  if (productCount > 0) {
    const orderId = `E2E-${Date.now()}`;
    const orderOk = await probe('POST', '/api/orders', {
      body: {
        orderId,
        id: orderId,
        customerName: 'E2E Buyer',
        customerPhone: '0780111222',
        phoneNumber: '0780111222',
        email: 'buyer@example.com',
        deliveryAddress: 'Kigali, Rwanda',
        paymentMethod: 'cash_on_delivery',
        paymentType: 'cod',
        items: [
          {
            productId: String(productId),
            id: String(productId),
            name: productsCard.body.products[0]?.name || 'Product',
            price: Number(productsCard.body.products[0]?.price || 1000),
            quantity: 1,
            qty: 1
          }
        ],
        totalAmount: Number(productsCard.body.products[0]?.price || 1000)
      }
    });
    expectStatus('order create', orderOk, [200, 201]);
    if (orderOk.body?.success && (orderOk.body?.order?.orderId || orderOk.body?.order?.id)) {
      record(true, 'order persisted', orderOk.body.order.orderId || orderOk.body.order.id);
    } else if (orderOk.status === 200 || orderOk.status === 201) {
      record(false, 'order persisted', JSON.stringify(orderOk.body || {}).slice(0, 200));
    }
  }

  // Security headers on HTML
  const shop = await probe('GET', '/shop.html');
  const csp = shop.headers?.get?.('content-security-policy') || '';
  if (csp) {
    record(true, 'CSP header', 'present');
  } else {
    warnings.push('CSP header missing on /shop.html');
  }

  const nosniff = shop.headers?.get?.('x-content-type-options') || '';
  record(Boolean(nosniff), 'X-Content-Type-Options', nosniff || 'missing');

  // Performance summary for key APIs
  const perfTargets = [
    ['products card', productsCard],
    ['search', search],
    ['product one', productOne],
    ['healthz', healthz]
  ];
  for (const [label, response] of perfTargets) {
    if (response?.ms > 1500) {
      warnings.push(`slow ${label}: ${response.ms}ms`);
    }
  }

  console.log('\nResults:');
  for (const entry of results) {
    console.log(`  ${entry.ok ? 'OK  ' : 'FAIL'} ${entry.name} -> ${entry.detail}`);
  }

  if (warnings.length) {
    console.log('\nWarnings:');
    warnings.forEach((entry) => console.log(`  WARN ${entry}`));
  }

  if (failures.length) {
    console.error(`\n[verify-e2e-step5] FAIL (${failures.length})`);
    failures.forEach((entry) => console.error(`  - ${entry}`));
    process.exit(1);
  }

  console.log(`\n[verify-e2e-step5] PASS (${results.length} checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
