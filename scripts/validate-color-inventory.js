/**
 * Color variant inventory validation.
 * Run: node scripts/validate-color-inventory.js
 */

import { createRequire } from 'node:module';

const { enrichSerializedProductColorVariants } = createRequire(import.meta.url)('../server/utils/colorVariantSerialization.js');

const {
  buildAttributesFromColorVariants,
  buildFlatInventoryItems,
  computeColorTotalStock,
  computeProductTotalStock,
  getSizesForColor,
  getStockForColorSize,
  hasPurchasableVariant,
  normalizeColorVariants,
  resolveMatrixStock,
  resolveSmartColorSizeSelection
} = await import('../js/color-variant-inventory.js');

const sampleColors = normalizeColorVariants([
  {
    colorName: 'White',
    image: '/uploads/white.jpg',
    sizes: [
      { size: '40', stock: 5 },
      { size: '41', stock: 4 },
      { size: '42', stock: 6 },
      { size: '43', stock: 0 }
    ]
  },
  {
    colorName: 'Black',
    image: '/uploads/black.jpg',
    sizes: [
      { size: '40', stock: 3 },
      { size: '41', stock: 5 },
      { size: '42', stock: 4 }
    ]
  },
  {
    colorName: 'Blue',
    image: '/uploads/blue.jpg',
    sizes: [
      { size: '40', stock: 8 },
      { size: '41', stock: 7 },
      { size: '42', stock: 5 }
    ]
  }
]);

const whiteTotal = computeColorTotalStock(sampleColors[0]);
const productTotal = computeProductTotalStock(sampleColors);
const flatItems = buildFlatInventoryItems(sampleColors);
const attributes = buildAttributesFromColorVariants(sampleColors);

const product = {
  stock: productTotal,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: sampleColors,
    items: flatItems
  },
  attributes
};

const whiteId = sampleColors[0].id;
const blackId = sampleColors[1].id;
const whiteSizes = getSizesForColor(product, whiteId);

const checks = [
  ['white color total stock', whiteTotal === 15],
  ['product total stock', productTotal === 47],
  ['flat inventory item count', flatItems.length === 10],
  ['color attribute options', attributes[0]?.options?.length === 3],
  ['white sizes listed', whiteSizes.length === 4],
  ['white includes zero-stock size', whiteSizes.some((entry) => entry.label === '43' && entry.stock === 0)],
  ['black size 41 stock', getStockForColorSize(product, blackId, '41') === 5],
  ['white size 41 stock', getStockForColorSize(product, whiteId, '41') === 4],
  ['matrix stock resolution', resolveMatrixStock(product, { Color: whiteId, Size: '41' }) === 4],
  ['purchasable when a variant has stock', hasPurchasableVariant(product) === true]
];

const singleColorProduct = {
  stock: 5,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([{
      colorName: 'Red',
      sizes: [{ size: '40', stock: 5 }]
    }])
  }
};

const singleColorMultiSizeProduct = {
  stock: 10,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([{
      colorName: 'Red',
      sizes: [{ size: '40', stock: 5 }, { size: '41', stock: 5 }]
    }])
  }
};

const multiColorSingleSizeProduct = {
  stock: 10,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([
      { colorName: 'Red', sizes: [{ size: '40', stock: 5 }] },
      { colorName: 'Blue', sizes: [{ size: '40', stock: 5 }] }
    ])
  }
};

const multiColorMultiSizeProduct = {
  stock: 20,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([
      { colorName: 'Red', sizes: [{ size: '40', stock: 5 }, { size: '41', stock: 5 }] },
      { colorName: 'Blue', sizes: [{ size: '40', stock: 5 }, { size: '42', stock: 5 }] }
    ])
  }
};

const redId = multiColorSingleSizeProduct.variants.colorVariants[0].id;
const blueId = multiColorSingleSizeProduct.variants.colorVariants[1].id;

checks.push(
  ['case1 auto color+size', (() => {
    const sel = resolveSmartColorSizeSelection(singleColorProduct, {});
    return Boolean(sel.Color && sel.Size === '40');
  })()],
  ['case2 auto color only', (() => {
    const sel = resolveSmartColorSizeSelection(singleColorMultiSizeProduct, {});
    return Boolean(sel.Color) && !sel.Size;
  })()],
  ['case3 auto size after color', (() => {
    const sel = resolveSmartColorSizeSelection(multiColorSingleSizeProduct, { Color: blueId });
    return sel.Color === blueId && sel.Size === '40';
  })()],
  ['case4 manual both', (() => {
    const sel = resolveSmartColorSizeSelection(multiColorMultiSizeProduct, {});
    return !sel.Color && !sel.Size;
  })()],
  ['case4 no auto size without color', (() => {
    const sel = resolveSmartColorSizeSelection(multiColorSingleSizeProduct, {});
    return !sel.Size;
  })()],
  ['preserves valid manual size', (() => {
    const sel = resolveSmartColorSizeSelection(product, { Color: whiteId, Size: '41' });
    return sel.Color === whiteId && sel.Size === '41';
  })()],
  ['size attribute stock is summed across colors', attributes[1]?.options?.find((entry) => entry.value === '40')?.stock === 16],
  ['size attribute not marked future when in stock', attributes[1]?.options?.every((entry) => entry.availability !== 'future')],
  ['fully out-of-stock product is not purchasable', hasPurchasableVariant({
    stock: 12,
    variants: {
      mode: 'color_size',
      colorVariants: normalizeColorVariants([{
        colorName: 'White -Navy- Red',
        sizes: [{ size: '40', stock: 0 }]
      }]),
      items: [{ stock: 1, available: 1, colorId: 'white-navy-red', size: '40' }]
    }
  }) === false],
  ['partially available product stays purchasable', hasPurchasableVariant({
    stock: 0,
    variants: {
      mode: 'color_size',
      colorVariants: normalizeColorVariants([
        { colorName: 'Out Color', sizes: [{ size: '40', stock: 0 }] },
        { colorName: 'In Color', sizes: [{ size: '41', stock: 2 }] }
      ])
    }
  }) === true],
  ['serialization rebuilds stale variant items from color stock', (() => {
    const serialized = enrichSerializedProductColorVariants({
      stock: 12,
      variants: {
        mode: 'color_size',
        colorVariants: [{ id: 'white-navy-red', colorName: 'White -Navy- Red', sizes: [{ size: '40', stock: 0 }] }],
        items: [{ id: 'white-navy-red-40', stock: 1, available: 1 }]
      },
      metadata: { variantStockTotal: 1, stockStatus: 'low_stock' }
    }, (value) => value);
    return serialized.stock === 0
      && serialized.variants.items[0].stock === 0
      && serialized.metadata.stockStatus === 'out_of_stock'
      && serialized.attributes[0].options[0].availability === 'out_of_stock';
  })()]
);

const failed = checks.filter(([, ok]) => !ok);

if (failed.length) {
  console.error('Color inventory validation failed:');
  failed.forEach(([label]) => console.error(` - ${label}`));
  process.exit(1);
}

console.log('Color inventory validation passed.');
checks.forEach(([label]) => console.log(`✓ ${label}`));
