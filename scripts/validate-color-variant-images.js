/**
 * Color variant image upload validation.
 * Run: node scripts/validate-color-variant-images.js
 */

const {
  buildAttributesFromColorVariants,
  normalizeColorVariants
} = await import('../js/color-variant-inventory.js');

const { isPersistableAssetUrl } = await import('../admin/app/pages/products/utils.js');

const sampleColors = normalizeColorVariants([
  {
    clientKey: 'color-white',
    colorName: 'White',
    image: '/uploads/products/white-shoe.jpg',
    imageStoragePath: 'products/white-shoe.jpg',
    sizes: [{ size: '41', stock: 4 }]
  }
]);

const attributes = buildAttributesFromColorVariants(sampleColors);
const colorOption = attributes[0]?.options?.[0];

const checks = [
  ['stores imageStoragePath', Boolean(sampleColors[0]?.imageStoragePath)],
  ['persists image url', isPersistableAssetUrl(sampleColors[0]?.image)],
  ['attribute option includes image', Boolean(colorOption?.image)],
  ['client key preserved', sampleColors[0]?.clientKey === 'color-white']
];

const failed = checks.filter(([, ok]) => !ok);

if (failed.length) {
  console.error('Color variant image validation failed:');
  failed.forEach(([label]) => console.error(` - ${label}`));
  process.exit(1);
}

console.log('Color variant image validation passed.');
checks.forEach(([label]) => console.log(`✓ ${label}`));
