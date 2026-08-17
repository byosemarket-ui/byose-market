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
  resolveSmartColorSizeSelection,
  resolveConfirmationColorSizeSelection
} = await import('../js/color-variant-inventory.js');
const {
  buildVariantCartPayload,
  resolvePurchaseSelection
} = await import('../js/variant-cart-payload.js');

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
  id: 10,
  price: 15000,
  mainImage: '/uploads/red.jpg',
  stock: 5,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([{
      colorName: 'Red',
      image: '/uploads/red.jpg',
      sizes: [{ size: '40', stock: 5 }]
    }])
  }
};

const singleColorMultiSizeProduct = {
  id: 11,
  price: 18000,
  mainImage: '/uploads/red.jpg',
  stock: 10,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([{
      colorName: 'Red',
      image: '/uploads/red.jpg',
      sizes: [{ size: '40', stock: 3 }, { size: '41', stock: 7 }]
    }])
  }
};

const multiColorSingleSizeProduct = {
  id: 12,
  price: 20000,
  mainImage: '/uploads/red.jpg',
  stock: 10,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([
      { colorName: 'Red', image: '/uploads/red.jpg', sizes: [{ size: '40', stock: 5 }] },
      { colorName: 'Blue', image: '/uploads/blue.jpg', sizes: [{ size: '40', stock: 5 }] }
    ])
  }
};

const multiColorMultiSizeProduct = {
  id: 13,
  price: 22000,
  mainImage: '/uploads/red.jpg',
  stock: 20,
  variants: {
    mode: 'color_size',
    enabled: true,
    colorVariants: normalizeColorVariants([
      { colorName: 'Red', image: '/uploads/red.jpg', sizes: [{ size: '40', stock: 5 }, { size: '41', stock: 5 }] },
      { colorName: 'Blue', image: '/uploads/blue.jpg', sizes: [{ size: '40', stock: 5 }, { size: '42', stock: 5 }] }
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
  ['case3 auto size without color', (() => {
    const sel = resolveSmartColorSizeSelection(multiColorSingleSizeProduct, {});
    return !sel.Color && sel.Size === '40';
  })()],
  ['case4 manual both', (() => {
    const sel = resolveSmartColorSizeSelection(multiColorMultiSizeProduct, {});
    return !sel.Color && !sel.Size;
  })()],
  ['case4 does not auto-select first color', (() => {
    const sel = resolveSmartColorSizeSelection(multiColorMultiSizeProduct, {});
    return !sel.Color;
  })()],
  ['preserves valid manual size', (() => {
    const sel = resolveSmartColorSizeSelection(product, { Color: whiteId, Size: '41' });
    return sel.Color === whiteId && sel.Size === '41';
  })()],
  ['does not keep out-of-stock size', (() => {
    const sel = resolveSmartColorSizeSelection(product, { Color: whiteId, Size: '43' });
    return sel.Color === whiteId && !sel.Size;
  })()],
  ['test5 selected color with one in-stock size auto-selects it', (() => {
    const mixed = {
      variants: {
        mode: 'color_size',
        colorVariants: normalizeColorVariants([
          { colorName: 'White', sizes: [{ size: '39', stock: 2 }, { size: '40', stock: 3 }, { size: '41', stock: 0 }] },
          { colorName: 'Navy', sizes: [{ size: '41', stock: 4 }] }
        ])
      }
    };
    const navyId = mixed.variants.colorVariants[1].id;
    const sel = resolveSmartColorSizeSelection(mixed, { Color: navyId });
    return sel.Color === navyId && sel.Size === '41';
  })()],
  ['test6 selected color with multiple sizes stays manual', (() => {
    const sel = resolveSmartColorSizeSelection(product, { Color: whiteId });
    return sel.Color === whiteId && !sel.Size;
  })()],
  ['color change clears invalid previous size', (() => {
    const matrixProduct = {
      variants: {
        mode: 'color_size',
        colorVariants: normalizeColorVariants([
          { colorName: 'White', sizes: [{ size: '39', stock: 2 }, { size: '40', stock: 3 }, { size: '41', stock: 0 }] },
          { colorName: 'Black', sizes: [{ size: '39', stock: 0 }, { size: '40', stock: 2 }, { size: '41', stock: 4 }] }
        ])
      }
    };
    const white = matrixProduct.variants.colorVariants[0].id;
    const black = matrixProduct.variants.colorVariants[1].id;
    const afterWhite = resolveSmartColorSizeSelection(matrixProduct, { Color: white, Size: '39' });
    const afterBlack = resolveSmartColorSizeSelection(matrixProduct, { Color: black, Size: afterWhite.Size });
    return afterWhite.Size === '39' && !afterBlack.Size;
  })()],
  ['resolved purchase includes variant id and stock', (() => {
    const sel = resolveSmartColorSizeSelection(singleColorProduct, {});
    const resolved = resolvePurchaseSelection(singleColorProduct, sel);
    const payload = buildVariantCartPayload(singleColorProduct, 1, resolved.selection);
    return resolved.resolved
      && Boolean(payload.variantId)
      && payload.stock === 5
      && payload.colorId === sel.Color
      && payload.sizeValue === sel.Size;
  })()],
  ['payload includes required purchase fields', (() => {
    const sel = resolveSmartColorSizeSelection(singleColorProduct, {});
    const payload = buildVariantCartPayload(singleColorProduct, 2, sel);
    return payload.productId === 10
      && Boolean(payload.variantId)
      && payload.color === 'Red'
      && payload.sizeValue === '40'
      && payload.qty === 2
      && payload.price === 15000
      && Boolean(payload.image)
      && payload.stock === 5;
  })()],
  ['quantity cannot exceed variant stock', (() => {
    const sel = resolveSmartColorSizeSelection(singleColorMultiSizeProduct, { Size: '40' });
    const payload = buildVariantCartPayload(singleColorMultiSizeProduct, 9, sel);
    return sel.Size === '40' && payload.qty === 3 && payload.stock === 3;
  })()],
  ['invalid color/size combination is blocked', (() => {
    const redId = multiColorMultiSizeProduct.variants.colorVariants[0].id;
    const resolved = resolvePurchaseSelection(multiColorMultiSizeProduct, { Color: redId, Size: '42' });
    return resolved.resolved === false;
  })()],
  ['size change updates variant id', (() => {
    const redId = multiColorMultiSizeProduct.variants.colorVariants[0].id;
    const size40 = resolvePurchaseSelection(multiColorMultiSizeProduct, { Color: redId, Size: '40' });
    const size41 = resolvePurchaseSelection(multiColorMultiSizeProduct, { Color: redId, Size: '41' });
    const payload40 = buildVariantCartPayload(multiColorMultiSizeProduct, 1, size40.selection);
    const payload41 = buildVariantCartPayload(multiColorMultiSizeProduct, 1, size41.selection);
    return size40.resolved
      && size41.resolved
      && payload40.variantId !== payload41.variantId
      && payload40.sizeValue === '40'
      && payload41.sizeValue === '41';
  })()],
  ['color change does not keep previous variant payload', (() => {
    const redId = multiColorMultiSizeProduct.variants.colorVariants[0].id;
    const blueId = multiColorMultiSizeProduct.variants.colorVariants[1].id;
    const afterRed = resolveSmartColorSizeSelection(multiColorMultiSizeProduct, { Color: redId, Size: '41' });
    const afterBlue = resolveSmartColorSizeSelection(multiColorMultiSizeProduct, { Color: blueId, Size: afterRed.Size });
    const unresolved = resolvePurchaseSelection(multiColorMultiSizeProduct, afterBlue);
    return afterRed.Size === '41' && !afterBlue.Size && unresolved.resolved === false;
  })()],
  ['case A purchase resolves without extra choices', (() => {
    const resolved = resolvePurchaseSelection(singleColorProduct, {});
    return resolved.resolved && Boolean(resolved.selection.Color) && resolved.selection.Size === '40';
  })()],
  ['confirmation keeps unique in-stock options selected', (() => {
    const sel = resolveConfirmationColorSizeSelection(singleColorProduct, {});
    return Boolean(sel.Color) && sel.Size === '40';
  })()],
  ['confirmation still shows unique out-of-stock color and size', (() => {
    const oos = {
      variants: {
        mode: 'color_size',
        colorVariants: normalizeColorVariants([{
          colorName: 'White & Black',
          sizes: [{ size: '40', stock: 0 }]
        }])
      }
    };
    const sel = resolveConfirmationColorSizeSelection(oos, {});
    const resolved = resolvePurchaseSelection(oos, sel);
    return sel.Color === oos.variants.colorVariants[0].id
      && sel.Size === '40'
      && resolved.resolved === false;
  })()],
  ['confirmation does not auto-pick among multiple colors', (() => {
    const sel = resolveConfirmationColorSizeSelection(multiColorMultiSizeProduct, {});
    return !sel.Color && !sel.Size;
  })()],
  ['case B keeps size manual until chosen', (() => {
    const auto = resolvePurchaseSelection(singleColorMultiSizeProduct, {});
    const chosen = resolvePurchaseSelection(singleColorMultiSizeProduct, { ...auto.selection, Size: '41' });
    return auto.resolved === false && !auto.selection.Size && chosen.resolved && chosen.selection.Size === '41';
  })()],
  ['case C auto-selects the only size', (() => {
    const auto = resolvePurchaseSelection(multiColorSingleSizeProduct, {});
    const chosen = resolvePurchaseSelection(multiColorSingleSizeProduct, {
      ...auto.selection,
      Color: multiColorSingleSizeProduct.variants.colorVariants[1].id
    });
    return !auto.selection.Color
      && auto.selection.Size === '40'
      && chosen.resolved
      && chosen.selection.Size === '40';
  })()],
  ['case D requires both color and size', (() => {
    const auto = resolvePurchaseSelection(multiColorMultiSizeProduct, {});
    return auto.resolved === false && !auto.selection.Color && !auto.selection.Size;
  })()],
  ['out of stock variant cannot resolve for purchase', (() => {
    const resolved = resolvePurchaseSelection(product, { Color: whiteId, Size: '43' });
    return resolved.resolved === false;
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
