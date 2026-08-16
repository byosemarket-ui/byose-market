#!/usr/bin/env node
/**
 * Admin invoice + delivery confirmation verification.
 * Run: node scripts/verify-admin-invoice.js
 */

const fs = require('fs');
const path = require('path');
const invoiceVerification = require('../server/services/invoice-verification.service');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function makeOrder(overrides = {}) {
  return {
    orderId: 'BM-ORDER-A',
    id: 'BM-ORDER-A',
    customerId: 'CUST-A',
    customerName: 'Uwase Alice',
    customerPhone: '+250780000001',
    customerEmail: 'alice@example.com',
    date: '2026-08-01T08:15:00.000Z',
    createdAt: '2026-08-01T08:15:00.000Z',
    status: 'Pending',
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentMethodLabel: 'Cash on Delivery',
    paymentStatus: 'pending',
    paymentStatusLabel: 'Pending',
    currency: 'RWF',
    subtotal: 27000,
    deliveryFee: 2000,
    discount: 0,
    tax: 0,
    total: 29000,
    totalAmount: 29000,
    grandTotal: 29000,
    deliveryLabel: 'Delivery to address',
    deliveryMethod: 'delivery',
    shippingAddress: {
      fullName: 'Uwase Alice',
      phone: '+250780000001',
      provinceCity: 'Kigali City',
      district: 'Kicukiro',
      sector: 'Gikondo',
      cell: 'Nyakabanda',
      village: 'Karambo',
      note: 'KG 17 Ave, House No. 15. Call before arrival.'
    },
    fullAddress: {
      province: 'Kigali City',
      district: 'Kicukiro',
      sector: 'Gikondo',
      cell: 'Nyakabanda',
      village: 'Karambo',
      note: 'KG 17 Ave, House No. 15. Call before arrival.'
    },
    gpsLocation: {
      latitude: '-1.9706',
      longitude: '30.1044',
      googleMapsLink: 'https://www.google.com/maps?q=-1.9706,30.1044'
    },
    items: [
      {
        productId: 'P-100',
        productName: 'Classic Leather Shoe',
        sku: 'CLS-40-BLK',
        size: '40',
        color: 'Black',
        quantity: 1,
        price: 27000,
        lineTotal: 27000,
        image: '/uploads/products/shoe-a.jpg'
      }
    ],
    ...overrides
  };
}

async function main() {
  const ordersJs = read('admin/app/pages/orders.js');
  const invoiceJs = read('admin/app/services/invoice-document.service.js');
  const dataJs = read('admin/app/services/admin-data.service.js');
  const verifyPage = read('invoice-verify.js');
  const controller = read('server/controllers/invoicecontroller.js');
  const routes = read('server/routes/adminorders.js');

  const deploySh = read('scripts/deploy-vps.sh');
  assert(deploySh.includes('invoice-verify.html'), 'VPS deploy must publish invoice-verify.html to the Nginx web root');
  assert(deploySh.includes('invoice-verify.js'), 'VPS deploy must publish invoice-verify.js to the Nginx web root');
  assert(deploySh.includes('Required public invoice verification file'), 'deploy must fail if the verification page is not published');
  assert(ordersJs.includes('https://byosemarket.com/invoice-verify.html'), 'printed QR URLs must use the live HTTPS domain');
  assert(!ordersJs.includes('${origin}/invoice-verify.html'), 'QR URLs must not follow the Admin origin (localhost/IP)');
  assert(ordersJs.includes('prepareAndOpenInvoice'), 'selected-order invoice opener must exist');
  assert(ordersJs.includes('invoiceOrderMatchesRequested'), 'fresh order lookup must match the clicked order');
  assert(ordersJs.includes('getOrderById'), 'invoice must refresh the selected order');
  assert(ordersJs.includes('Promise.all'), 'invoice context fetch should run in parallel');
  assert(dataJs.includes('Order lookup did not return the requested order'), 'getOrderById must reject mismatched orders');
  assert(invoiceJs.includes('INVOICE &amp; DELIVERY CONFIRMATION') || invoiceJs.includes('INVOICE & DELIVERY CONFIRMATION'), 'document title must exist');
  assert(invoiceJs.includes('Customer Delivery Confirmation'), 'confirmation section must exist');
  assert(invoiceJs.includes('does not cancel'), 'confirmation must preserve return/refund rights');
  assert(invoiceJs.includes('inv-blank is-tall'), 'signature area must stay blank');
  assert(!/cursive|handwriting|signature\.png|fake signature/i.test(invoiceJs), 'must not generate a fake signature');
  assert(invoiceJs.includes('@media print'), 'print CSS must exist');
  assert(invoiceJs.includes('display: none !important'), 'print CSS must hide invoice toolbar');
  assert(invoiceJs.includes('data-verify-url'), 'QR must expose the verification URL for the selected order');
  assert(invoiceJs.includes('Received / Confirmed'), 'confirmed delivery state must be represented');
  assert(invoiceJs.includes('Amount Paid') && invoiceJs.includes('Amount Due'), 'payment amounts must be explicit');
  assert(controller.includes('getAdminInvoiceVerification'), 'admin verification endpoint must exist');
  assert(routes.includes('/:id/verification'), 'admin verification route must exist');
  assert(verifyPage.includes('/invoices/verify'), 'public verification page must call the signed endpoint');
  assert(verifyPage.includes('Customer Confirmation'), 'verification page shows confirmation without extra PII');

  const { buildInvoiceHtml } = await import('../admin/app/services/invoice-document.service.js');
  const { buildQrSvg } = await import('../admin/app/utils/qr-svg.js');

  const orderA = makeOrder();
  const orderB = makeOrder({
    orderId: 'BM-ORDER-B',
    id: 'BM-ORDER-B',
    customerId: 'CUST-B',
    customerName: 'Habimana Bob',
    customerPhone: '+250780000002',
    customerEmail: 'bob@example.com',
    paymentMethod: 'mtn',
    paymentMethodLabel: 'MTN MoMo',
    paymentStatus: 'paid',
    paymentStatusLabel: 'Paid',
    status: 'Delivered',
    orderStatus: 'delivered',
    subtotal: 54000,
    total: 56000,
    totalAmount: 56000,
    grandTotal: 56000,
    shippingAddress: {
      fullName: 'Habimana Bob',
      phone: '+250780000002',
      provinceCity: 'Southern Province',
      district: 'Huye',
      sector: 'Ngoma',
      cell: 'Butare',
      village: 'Cyarwa',
      note: 'Leave at the gate if not home.'
    },
    items: [
      {
        productId: 'P-200',
        productName: 'Runner White',
        sku: 'RN-42-WHT',
        size: '42',
        color: 'White',
        quantity: 2,
        price: 27000,
        lineTotal: 54000,
        image: '/uploads/products/shoe-b.jpg'
      }
    ]
  });
  const orderC = makeOrder({
    orderId: 'BM-ORDER-C',
    id: 'BM-ORDER-C',
    customerName: 'Mukamana Claire With A Very Long Customer Name For Wrapping',
    customerEmail: 'claire.very.long.email.address@byosemarket.example.com',
    paymentMethod: 'card',
    paymentStatus: 'pending',
    items: [
      { productId: 'P-1', productName: 'Item One', sku: 'SKU-1', size: '39', color: 'Red', quantity: 1, price: 10000, lineTotal: 10000, image: '' },
      { productId: 'P-2', productName: 'Item Two Historical', sku: 'SKU-2', size: '40', color: 'Blue', quantity: 3, price: 7000, lineTotal: 21000, image: '/uploads/products/two.jpg' },
      { productId: 'P-3', productName: 'Item Three', sku: 'SKU-3', quantity: 1, price: 5000, lineTotal: 5000 }
    ],
    subtotal: 36000,
    total: 38000,
    totalAmount: 38000,
    grandTotal: 38000,
    gpsLocation: {},
    customerId: '',
    customerPhone: '',
    shippingAddress: {
      fullName: 'Mukamana Claire With A Very Long Customer Name For Wrapping',
      provinceCity: 'Kigali City',
      district: 'Gasabo',
      sector: 'Remera',
      note: 'Please call on arrival and wait five minutes near the blue gate beside the long building on KG 17 Ave.'
    }
  });

  const sigA = invoiceVerification.signOrderRef(orderA.orderId);
  const sigB = invoiceVerification.signOrderRef(orderB.orderId);
  assert(Boolean(sigA) && Boolean(sigB) && sigA !== sigB, 'QR signatures must be unique per order');
  assert(invoiceVerification.verifyOrderRef(orderA.orderId, sigA), 'Order A signature must verify Order A');
  assert(!invoiceVerification.verifyOrderRef(orderA.orderId, sigB), 'Order B signature must not verify Order A');
  assert(!invoiceVerification.verifyOrderRef(orderB.orderId, sigA), 'Order A signature must not verify Order B');

  const urlA = `https://byosemarket.com/invoice-verify.html?ref=${encodeURIComponent(orderA.orderId)}&sig=${sigA}`;
  const urlB = `https://byosemarket.com/invoice-verify.html?ref=${encodeURIComponent(orderB.orderId)}&sig=${sigB}`;
  assert(!/alice@example.com|Uwase Alice|\+250780000001|Kicukiro/i.test(urlA), 'QR URL must not contain customer PII');

  const htmlA = buildInvoiceHtml(orderA, { verificationUrl: urlA, company: { storeName: 'BYOSE Market', companyName: 'BYOSE Market Ltd', origin: 'https://byosemarket.com', currency: 'RWF', primary: '#00B894', logo: 'https://byosemarket.com/img/logo.png' } });
  const htmlB = buildInvoiceHtml(orderB, { verificationUrl: urlB, company: { storeName: 'BYOSE Market', companyName: 'BYOSE Market Ltd', origin: 'https://byosemarket.com', currency: 'RWF', primary: '#00B894', logo: 'https://byosemarket.com/img/logo.png' } });
  const htmlC = buildInvoiceHtml(orderC, { company: { storeName: 'BYOSE Market', origin: 'https://byosemarket.com', currency: 'RWF', primary: '#00B894' } });

  assert(htmlA.includes('data-invoice-order="BM-ORDER-A"'), 'invoice A must be tagged with order A');
  assert(htmlB.includes('data-invoice-order="BM-ORDER-B"'), 'invoice B must be tagged with order B');
  assert(htmlA.includes('Uwase Alice') && htmlA.includes('Classic Leather Shoe') && htmlA.includes('Cash on Delivery'), 'invoice A must use order A data');
  assert(htmlB.includes('Habimana Bob') && htmlB.includes('Runner White') && htmlB.includes('MTN MoMo'), 'invoice B must use order B data');
  assert(!htmlA.includes('Habimana Bob') && !htmlA.includes('Runner White'), 'invoice A must not contain order B customer/product');
  assert(!htmlB.includes('Uwase Alice') && !htmlB.includes('Classic Leather Shoe'), 'invoice B must not contain order A customer/product');
  assert(htmlA.includes('Pending') && htmlA.includes('Amount Due') && htmlA.includes('RWF 29,000'), 'COD pending invoice must keep pending amount due');
  assert(htmlB.includes('Paid') && htmlB.includes('Amount Paid') && htmlB.includes('Received / Confirmed'), 'delivered paid invoice must show paid + received');
  assert(htmlA.includes('Customer Confirmation') && htmlA.includes('Pending'), 'undelivered invoice confirmation stays pending');
  assert(htmlA.includes('inv-blank is-tall') && !htmlA.includes('font-family:cursive'), 'signature remains blank');
  assert(htmlA.includes('Kicukiro') && htmlA.includes('Gikondo') && htmlA.includes('Nyakabanda') && htmlA.includes('Karambo'), 'full Rwanda address hierarchy must display');
  assert(htmlA.includes('View Location on Map') && htmlA.includes('-1.9706'), 'valid map/GPS must display when stored');
  assert(!htmlC.includes('View Location on Map'), 'missing GPS must not invent a map link');
  assert(htmlC.includes('Item One') && htmlC.includes('Item Two Historical') && htmlC.includes('Item Three'), 'all products must render');
  assert(htmlC.includes('RWF 7,000') && htmlC.includes('RWF 21,000'), 'historical unit price and line total must be used');
  assert(htmlC.includes('Not provided') || !htmlC.includes('undefined'), 'missing phone handled cleanly');
  assert(!htmlA.includes('undefined') && !htmlA.includes('null') && !htmlA.includes('[object Object]') && !htmlC.includes('NaN'), 'no raw empty values');
  const verifyUrlFrom = (html) => {
    const match = String(html || "").match(/data-verify-url="([^"]+)"/);
    return match ? match[1].replace(/&amp;/g, "&") : "";
  };
  const qrUrlA = verifyUrlFrom(htmlA);
  const qrUrlB = verifyUrlFrom(htmlB);
  assert(qrUrlA === urlA, 'QR for order A encodes order A verification URL');
  assert(qrUrlB === urlB, 'QR for order B encodes order B verification URL');
  assert(!htmlA.includes('BM-ORDER-B') && !htmlB.includes('BM-ORDER-A'), 'QR URLs must not be swapped');
  assert(htmlA.includes('@media print') && htmlA.includes('.inv-toolbar, .inv-toolbar-actions, .inv-toolbar button { display: none !important; }'), 'print CSS hides toolbar');
  assert(htmlA.includes('does not cancel my rights'), 'return/refund rights remain');

  const htmlOutForDelivery = buildInvoiceHtml(makeOrder({
    orderId: 'BM-ORDER-OUT',
    id: 'BM-ORDER-OUT',
    status: 'Out for Delivery',
    orderStatus: 'out_for_delivery',
    deliveryStatus: 'out_for_delivery',
    paymentMethod: 'mtn_momo',
    paymentMethodLabel: '',
    paymentStatus: 'paid',
    paymentStatusLabel: 'Paid'
  }), { company: { storeName: 'BYOSE Market', origin: 'https://byosemarket.com', currency: 'RWF', primary: '#00B894' } });
  assert(htmlOutForDelivery.includes('MTN MoMo'), 'mtn_momo maps to MTN MoMo');
  assert(htmlOutForDelivery.includes('Pending') && !htmlOutForDelivery.includes('Received / Confirmed'), 'out for delivery must not auto-confirm receipt');
  assert(invoiceVerification.toLimitedVerification({
    orderId: 'BM-ORDER-OUT',
    orderStatus: 'out_for_delivery',
    status: 'Out for Delivery',
    paymentStatus: 'paid',
    total: 29000
  }).customerConfirmation === 'Pending', 'public verification keeps out-for-delivery as pending confirmation');

  const manyItems = Array.from({ length: 18 }, (_, index) => ({
    productId: `P-MANY-${index + 1}`,
    productName: `Bulk Item ${index + 1}`,
    sku: `BLK-${index + 1}`,
    quantity: 1,
    price: 1000 + index,
    lineTotal: 1000 + index
  }));
  const htmlMany = buildInvoiceHtml(makeOrder({
    orderId: 'BM-ORDER-MANY',
    id: 'BM-ORDER-MANY',
    items: manyItems,
    subtotal: manyItems.reduce((sum, item) => sum + item.lineTotal, 0),
    total: 20000,
    totalAmount: 20000,
    grandTotal: 20000
  }), { verificationUrl: urlA, company: { storeName: 'BYOSE Market', origin: 'https://byosemarket.com', currency: 'RWF', primary: '#00B894' } });
  assert(htmlMany.includes('Bulk Item 1') && htmlMany.includes('Bulk Item 18'), 'long invoices must include every product row');
  assert(htmlMany.includes('page-break-inside: avoid') && htmlMany.includes('size: A4'), 'multi-page print rules and A4 page size must exist');

  const limitedA = invoiceVerification.toLimitedVerification(orderA);
  const limitedB = invoiceVerification.toLimitedVerification(orderB);
  assert(limitedA.orderNumber === 'BM-ORDER-A' && limitedB.orderNumber === 'BM-ORDER-B', 'verification payload is order-specific');
  assert(limitedA.customerConfirmation === 'Pending' && limitedB.customerConfirmation === 'Received', 'confirmation status follows delivery, not invoice open');
  assert(!JSON.stringify(limitedA).includes('alice@example.com'), 'public verification payload must omit customer email');
  assert(!JSON.stringify(limitedA).includes('Kicukiro'), 'public verification payload must omit address');

  const qrSvg = buildQrSvg(urlA);
  assert(qrSvg.includes('<svg') && (qrSvg.match(/<rect/g) || []).length > 50, 'QR SVG must contain scannable modules');

  let serverQr = '';
  try {
    serverQr = await invoiceVerification.buildQrSvg(urlA);
  } catch (_error) {
    serverQr = '';
  }
  if (serverQr) {
    assert(serverQr.includes('<svg'), 'server QR generator should return SVG when qrcode is available');
  }

  const missing = buildInvoiceHtml({
    orderId: 'BM-EMPTY',
    items: [],
    paymentStatus: 'pending',
    status: 'Pending'
  }, { company: { storeName: 'BYOSE Market', origin: 'https://byosemarket.com', currency: 'RWF' } });
  assert(!missing.includes('undefined') && !missing.includes('[object Object]'), 'sparse orders stay professional');

  await runBrowserInvoiceChecks({ htmlA, htmlB, htmlMany, urlA, urlB, assert });

  if (failures.length) {
    console.error('FAIL verify-admin-invoice');
    failures.forEach((item) => console.error(` - ${item}`));
    process.exit(1);
  }

  console.log('PASS verify-admin-invoice');
  console.log(' - Selected-order isolation');
  console.log(' - Historical prices and multi-product rows');
  console.log(' - COD pending vs paid/delivered confirmation');
  console.log(' - QR order-specific signed URLs without PII');
  console.log(' - Print CSS, PDF, and blank signatures');
}

async function runBrowserInvoiceChecks({ htmlA, htmlB, htmlMany, urlA, urlB, assert }) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (_error) {
    console.log('SKIP browser invoice checks: playwright module not available');
    return;
  }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let browser;
  const launchers = [
    () => playwright.chromium.launch({ headless: true }),
    () => playwright.chromium.launch({ headless: true, channel: "chrome" }),
    () => playwright.chromium.launch({ headless: true, channel: "msedge" })
  ];
  let launchError = null;
  for (const launch of launchers) {
    try {
      browser = await launch();
      launchError = null;
      break;
    } catch (error) {
      launchError = error;
    }
  }
  if (!browser) {
    console.log(`SKIP browser invoice checks: ${launchError?.message || "no browser available"}`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'byose-invoice-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await page.setContent(htmlA, { waitUntil: 'domcontentloaded' });
    const orderTag = await page.locator('[data-invoice-order]').getAttribute('data-invoice-order');
    assert(orderTag === 'BM-ORDER-A', 'browser invoice A renders order A');
    assert(await page.locator('.inv-toolbar').isVisible(), 'screen invoice shows print toolbar');
    assert(await page.locator('.inv-qr').getAttribute('data-verify-url') === urlA, 'browser QR URL is order A');
    assert((await page.getByText('Uwase Alice').count()) > 0, 'browser invoice shows customer A');
    assert((await page.getByText('All Orders').count()) === 0, 'invoice window must not include Admin Orders UI');
    assert((await page.locator('.inv-blank.is-tall').count()) >= 2, 'browser signature lines stay blank');

    await page.emulateMedia({ media: 'print' });
    const toolbarDisplay = await page.locator('.inv-toolbar').evaluate((el) => getComputedStyle(el).display);
    assert(toolbarDisplay === 'none', 'print media hides invoice toolbar');
    const qrBox = await page.locator('.inv-qr svg').boundingBox();
    assert(Boolean(qrBox && qrBox.width >= 90 && qrBox.height >= 90), 'print QR is large enough to scan');

    const pdfA = path.join(tmp, 'invoice-a.pdf');
    await page.pdf({
      path: pdfA,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    });
    const pdfStat = fs.statSync(pdfA);
    assert(pdfStat.size > 8000, 'Save as PDF output must contain a real A4 document');

    const pageB = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    await pageB.setContent(htmlB, { waitUntil: 'domcontentloaded' });
    assert(await pageB.locator('[data-invoice-order]').getAttribute('data-invoice-order') === 'BM-ORDER-B', 'browser invoice B renders order B after invoice A');
    assert((await pageB.getByText('Uwase Alice').count()) === 0 && (await pageB.getByText('Habimana Bob').count()) > 0, 'opening invoice B must not keep invoice A customer data');
    assert(await pageB.locator('.inv-qr').getAttribute('data-verify-url') === urlB, 'browser QR URL is order B');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.setContent(htmlA, { waitUntil: 'domcontentloaded' });
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 24, 'mobile invoice should not break the page with horizontal overflow');
    assert(await mobile.locator('.inv-qr svg').isVisible(), 'mobile invoice keeps the QR visible');
    assert(await mobile.locator('.inv-blank.is-tall').first().isVisible(), 'mobile signature remains accessible');

    const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await tablet.setContent(htmlA, { waitUntil: 'domcontentloaded' });
    assert(await tablet.locator('.inv-title').isVisible(), 'tablet invoice remains readable');

    const manyPage = await browser.newPage();
    await manyPage.setContent(htmlMany, { waitUntil: 'domcontentloaded' });
    assert((await manyPage.locator('.inv-items tbody tr').count()) === 18, 'browser renders all 18 product rows');
    const pdfMany = path.join(tmp, 'invoice-many.pdf');
    await manyPage.pdf({ path: pdfMany, format: 'A4', printBackground: true });
    assert(fs.statSync(pdfMany).size > 8000, 'multi-product invoice PDF is generated');

    await page.close();
    await pageB.close();
    await mobile.close();
    await tablet.close();
    await manyPage.close();
    console.log(' - Browser print/PDF/mobile checks');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL verify-admin-invoice');
  console.error(error);
  process.exit(1);
});
