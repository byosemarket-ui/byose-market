/**
 * Variant cart payload validation.
 * Run: node scripts/validate-variant-cart-payload.js
 */

const {
  buildVariantCartPayload,
  formatVariantLineMeta,
  validateVariantSelection
} = await import('../js/variant-cart-payload.js');

const product = {
  id: 12,
  name: 'Premium Sneakers',
  price: 45000,
  oldPrice: 50000,
  sku: 'BM-00012',
  image: '/uploads/products/sneakers-main.jpg',
  variants: {
    mode: 'color_size',
    colorVariants: [
      {
        id: 'white',
        colorName: 'White',
        image: '/uploads/products/sneakers-white.jpg',
        sizes: [
          { size: '40', stock: 5 },
          { size: '41', stock: 0 },
          { size: '42', stock: 3 }
        ]
      }
    ]
  }
};

const validSelection = { Color: 'white', Size: '40' };
const invalidSizeSelection = { Color: 'white', Size: '41' };
const missingColorSelection = { Size: '40' };

const validCheck = validateVariantSelection(product, validSelection);
const invalidSizeCheck = validateVariantSelection(product, invalidSizeSelection);
const missingColorCheck = validateVariantSelection(product, missingColorSelection);
const payload = buildVariantCartPayload(product, 2, validSelection);

const checks = [
  ['valid color+size passes', validCheck.valid === true],
  ['invalid size blocked', invalidSizeCheck.valid === false],
  ['missing color blocked', missingColorCheck.valid === false],
  ['payload stores color name', payload.colorName === 'White'],
  ['payload stores size label', payload.sizeLabel === '40'],
  ['payload stores color image', payload.colorImage.includes('sneakers-white.jpg')],
  ['payload stores variant sku', payload.variantSku === 'BM-00012-white-40'],
  ['payload stores discount percent', payload.discountPercent === 10],
  ['payload stores available stock', payload.availableStock === 5],
  ['payload summary is human readable', formatVariantLineMeta(payload) === 'White · Size 40']
];

const failed = checks.filter(([, ok]) => !ok);

if (failed.length) {
  console.error('Variant cart payload validation failed:');
  failed.forEach(([label]) => console.error(` - ${label}`));
  process.exit(1);
}

console.log('Variant cart payload validation passed.');
checks.forEach(([label]) => console.log(`✓ ${label}`));
