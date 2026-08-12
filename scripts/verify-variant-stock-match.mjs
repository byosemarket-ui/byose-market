/**
 * Unit checks for size/color stock matching used at Place Order.
 * Run: node scripts/verify-variant-stock-match.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = require('../server/repositories/sqlite/product.repository.js');

const colorVariants = [{
  id: 'white-with-grey-details-black',
  colorName: 'White with Grey Details & Black',
  sizes: [{ size: '42', value: '42', stock: 1, label: '42' }]
}];

function resolve(item) {
  const colorTokens = repo.collectColorTokens(item);
  const sizeTokens = repo.collectSizeTokens(item);
  const color = repo.findColorVariantFromTokens(colorVariants, colorTokens)
    || (colorVariants.length === 1 ? colorVariants[0] : null);
  const sizeRow = color ? repo.findSizeRowFromTokens(color.sizes, sizeTokens) : null;
  return { colorTokens, sizeTokens, colorFound: Boolean(color), sizeFound: Boolean(sizeRow) };
}

const cases = [
  {
    name: 'display names',
    item: { colorName: 'White with Grey Details & Black', sizeLabel: '42' }
  },
  {
    name: 'Size-prefixed label',
    item: { colorName: 'White with Grey Details & Black', sizeLabel: 'Size 42' }
  },
  {
    name: 'stable ids only',
    item: {
      colorId: 'white-with-grey-details-black',
      sizeValue: '42',
      attributes: { Color: 'white-with-grey-details-black', Size: '42' }
    }
  },
  {
    name: 'variantKey only',
    item: { variantKey: 'Color:white-with-grey-details-black|Size:42' }
  },
  {
    name: 'ids survive buildOrderLine rewrite',
    item: {
      colorName: 'White with Grey Details & Black',
      sizeLabel: '42',
      colorId: 'white-with-grey-details-black',
      sizeValue: '42',
      attributes: {
        Color: 'white-with-grey-details-black',
        Size: '42',
        colorName: 'White with Grey Details & Black',
        sizeLabel: '42'
      }
    }
  }
];

let failed = 0;
for (const testCase of cases) {
  const result = resolve(testCase.item);
  try {
    assert.equal(result.colorFound, true, `${testCase.name}: color`);
    assert.equal(result.sizeFound, true, `${testCase.name}: size`);
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${testCase.name}`, result, error.message);
  }
}

if (failed) {
  console.error(`FAILED ${failed} case(s)`);
  process.exit(1);
}

console.log('PASS — variant stock match verification');
