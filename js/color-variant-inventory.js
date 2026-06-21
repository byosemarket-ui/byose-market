/**
 * Hierarchical color → size → stock inventory for products with color variants.
 * Used by admin wizard, API payload builders, and storefront PDP/cart.
 */

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const COLOR_SIZE_MODE = "color_size";
export const COLOR_ATTR_NAME = "Color";
export const SIZE_ATTR_NAME = "Size";

export function normalizeSizeRow(entry = {}) {
  const size = String(entry?.size ?? entry?.label ?? "").trim();
  const stock = Math.max(0, Math.floor(toNumber(entry?.stock, 0)));
  return { size, stock, value: slugify(size) || size };
}

export function normalizeColorVariant(entry = {}, index = 0) {
  const colorName = String(entry?.colorName ?? entry?.name ?? entry?.label ?? "").trim();
  const id = String(entry?.id || slugify(colorName) || `color-${index + 1}`).trim();
  const image = String(entry?.image ?? entry?.thumbnail ?? "").trim();
  const imageStoragePath = String(entry?.imageStoragePath ?? entry?.imagePath ?? "").trim();
  const clientKey = String(entry?.clientKey || id || `color-${index + 1}`).trim();
  const sizes = (Array.isArray(entry?.sizes) ? entry.sizes : [])
    .map(normalizeSizeRow)
    .filter((row) => row.size);
  const totalStock = sizes.reduce((sum, row) => sum + row.stock, 0);

  return {
    id,
    clientKey,
    colorName: colorName || `Color ${index + 1}`,
    image,
    imageStoragePath,
    sizes,
    totalStock
  };
}

export function getColorVariantImage(product, colorId) {
  const target = String(colorId || "").trim();
  if (!target) {
    return "";
  }

  const colorVariants = extractColorVariantsFromProduct(product);
  const color = colorVariants.find((entry) => entry.id === target);
  return String(color?.image || "").trim();
}

export function normalizeColorVariants(source = []) {
  return (Array.isArray(source) ? source : [])
    .map((entry, index) => normalizeColorVariant(entry, index))
    .filter((entry) => entry.colorName);
}

export function computeColorTotalStock(colorVariant) {
  const sizes = Array.isArray(colorVariant?.sizes) ? colorVariant.sizes : [];
  return sizes.reduce((sum, row) => sum + Math.max(0, Math.floor(toNumber(row?.stock, 0))), 0);
}

export function computeProductTotalStock(colorVariants = [], fallbackQuantity = 0) {
  const normalized = normalizeColorVariants(colorVariants);
  if (!normalized.length) {
    return Math.max(0, Math.floor(toNumber(fallbackQuantity, 0)));
  }
  return normalized.reduce((sum, entry) => sum + computeColorTotalStock(entry), 0);
}

export function migrateLegacyToColorVariants(variants = [], sizes = []) {
  const legacy = Array.isArray(variants) ? variants : [];
  if (!legacy.length) {
    return [];
  }

  const globalSizes = (Array.isArray(sizes) ? sizes : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return legacy.map((entry, index) => {
    const colorName = String(entry?.colorName || entry?.label || "").trim() || `Color ${index + 1}`;
    const stock = Math.max(0, Math.floor(toNumber(entry?.stock, 0)));
    let sizeRows = [];

    if (globalSizes.length) {
      sizeRows = globalSizes.map((size, sizeIndex) => ({
        size,
        stock: sizeIndex === 0 ? stock : 0
      }));
    } else {
      sizeRows = [{ size: "One Size", stock }];
    }

    return normalizeColorVariant({
      id: slugify(colorName) || `color-${index + 1}`,
      colorName,
      image: entry?.image || "",
      sizes: sizeRows
    }, index);
  });
}

export function extractColorVariantsFromProduct(product) {
  const variants = product?.variants && typeof product.variants === "object" ? product.variants : {};
  const metadata = product?.metadata && typeof product.metadata === "object" ? product.metadata : {};
  const metadataColorVariants = Array.isArray(metadata.colorVariants) ? metadata.colorVariants : [];

  if (Array.isArray(variants.colorVariants) && variants.colorVariants.length) {
    return normalizeColorVariants(variants.colorVariants.map((entry) => ({
      ...entry,
      imageStoragePath: entry?.imageStoragePath || entry?.imagePath || ""
    })));
  }

  if (metadataColorVariants.length) {
    return normalizeColorVariants(metadataColorVariants.map((entry) => ({
      ...entry,
      imageStoragePath: entry?.imageStoragePath || entry?.imagePath || ""
    })));
  }

  const flatItems = Array.isArray(variants.items) ? variants.items : [];
  if (flatItems.length && flatItems.some((entry) => entry?.colorId || entry?.size)) {
    const grouped = new Map();
    flatItems.forEach((entry, index) => {
      const colorId = String(entry?.colorId || slugify(entry?.colorName || entry?.label || `color-${index + 1}`)).trim();
      const colorName = String(entry?.colorName || entry?.label || colorId).trim();
      if (!grouped.has(colorId)) {
        grouped.set(colorId, {
          id: colorId,
          colorName,
          image: String(entry?.image || "").trim(),
          sizes: []
        });
      }
      const bucket = grouped.get(colorId);
      if (!bucket.image && entry?.image) {
        bucket.image = String(entry.image).trim();
      }
      const size = String(entry?.size || entry?.sizeLabel || "").trim();
      if (size) {
        bucket.sizes.push({
          size,
          stock: Math.max(0, Math.floor(toNumber(entry?.stock ?? entry?.available, 0)))
        });
      }
    });
    return normalizeColorVariants([...grouped.values()]);
  }

  const legacyVariants = flatItems.map((entry) => ({
    label: entry?.label,
    colorName: entry?.colorName || entry?.color,
    image: entry?.image,
    stock: entry?.stock ?? entry?.available
  }));

  const sizeAttribute = Array.isArray(product?.attributes)
    ? product.attributes.find((entry) => String(entry?.type || entry?.axis || "").toLowerCase() === "size")
    : null;
  const globalSizes = Array.isArray(sizeAttribute?.options)
    ? sizeAttribute.options.map((option) => String(option?.label || option?.value || "").trim()).filter(Boolean)
    : [];

  return migrateLegacyToColorVariants(legacyVariants, globalSizes);
}

export function isColorSizeInventory(product) {
  const variants = product?.variants;
  if (variants?.mode === COLOR_SIZE_MODE) {
    return true;
  }
  return extractColorVariantsFromProduct(product).some((entry) => entry.sizes.length > 0);
}

export function buildFlatInventoryItems(colorVariants = []) {
  return normalizeColorVariants(colorVariants).flatMap((color) =>
    color.sizes.map((sizeRow) => {
      const sizeValue = slugify(sizeRow.size) || sizeRow.size;
      const key = `${COLOR_ATTR_NAME}:${color.id}|${SIZE_ATTR_NAME}:${sizeValue}`;
      return {
        id: `${color.id}-${sizeValue}`,
        key,
        colorId: color.id,
        colorName: color.colorName,
        size: sizeRow.size,
        sizeValue,
        label: `${color.colorName} / ${sizeRow.size}`,
        image: color.image,
        stock: sizeRow.stock,
        available: sizeRow.stock
      };
    })
  );
}

export function buildAttributesFromColorVariants(colorVariants = []) {
  const normalized = normalizeColorVariants(colorVariants);
  if (!normalized.length) {
    return [];
  }

  const colorOptions = normalized.map((color) => ({
    label: color.colorName,
    value: color.id,
    image: color.image,
    swatch: "",
    stock: color.totalStock,
    availability: color.totalStock > 0 ? "available" : "out_of_stock"
  }));

  const uniqueSizes = new Map();
  normalized.forEach((color) => {
    color.sizes.forEach((sizeRow) => {
      const value = slugify(sizeRow.size) || sizeRow.size;
      if (!uniqueSizes.has(value)) {
        uniqueSizes.set(value, {
          label: sizeRow.size,
          value,
          stock: 0,
          availability: "future"
        });
      }
    });
  });

  return [
    {
      name: COLOR_ATTR_NAME,
      key: "color",
      axis: "color",
      type: "color",
      required: true,
      options: colorOptions
    },
    {
      name: SIZE_ATTR_NAME,
      key: "size",
      axis: "size",
      type: "size",
      required: true,
      options: [...uniqueSizes.values()]
    }
  ];
}

export function getColorVariantMatrix(product) {
  const colorVariants = extractColorVariantsFromProduct(product);
  return buildFlatInventoryItems(colorVariants);
}

export function getSizesForColor(product, colorId) {
  const target = String(colorId || "").trim();
  if (!target) {
    return [];
  }

  const colorVariants = extractColorVariantsFromProduct(product);
  const color = colorVariants.find((entry) => entry.id === target);
  if (!color) {
    return [];
  }

  return color.sizes
    .map((row) => ({
      label: row.size,
      value: slugify(row.size) || row.size,
      stock: row.stock,
      availability: row.stock > 0 ? "available" : "out_of_stock"
    }))
    .filter((row) => row.stock > 0);
}

export function getStockForColorSize(product, colorId, sizeValue) {
  const matrix = getColorVariantMatrix(product);
  const colorKey = String(colorId || "").trim();
  const sizeKey = String(sizeValue || "").trim();
  if (!colorKey || !sizeKey) {
    return null;
  }

  const match = matrix.find((entry) => (
    entry.colorId === colorKey
    && (entry.sizeValue === sizeKey || entry.size === sizeKey)
  ));

  if (!match) {
    return null;
  }

  return Math.max(0, Math.floor(toNumber(match.stock, 0)));
}

export function getColorTotalStock(product, colorId) {
  const colorVariants = extractColorVariantsFromProduct(product);
  const color = colorVariants.find((entry) => entry.id === String(colorId || "").trim());
  return color ? computeColorTotalStock(color) : null;
}

export function resolveMatrixStock(product, selectedAttributes = {}) {
  if (!isColorSizeInventory(product)) {
    return null;
  }

  const colorName = COLOR_ATTR_NAME;
  const sizeName = SIZE_ATTR_NAME;
  const colorId = selectedAttributes?.[colorName];
  const sizeValue = selectedAttributes?.[sizeName];

  if (colorId && sizeValue) {
    const stock = getStockForColorSize(product, colorId, sizeValue);
    return Number.isFinite(stock) ? stock : 0;
  }

  if (colorId) {
    const total = getColorTotalStock(product, colorId);
    return Number.isFinite(total) ? total : null;
  }

  const productStock = Number(product?.stock ?? product?.stockCount);
  return Number.isFinite(productStock) ? Math.max(0, productStock) : null;
}

export function applyColorSizeSelection(attributes, product, selectedAttributes = {}) {
  if (!isColorSizeInventory(product)) {
    return attributes;
  }

  const colorId = selectedAttributes?.[COLOR_ATTR_NAME];
  const filteredSizes = getSizesForColor(product, colorId);

  return attributes.map((attribute) => {
    if (attribute.name !== SIZE_ATTR_NAME && attribute.key !== "size") {
      return attribute;
    }

    if (!colorId) {
      return {
        ...attribute,
        options: [],
        required: true
      };
    }

    return {
      ...attribute,
      options: filteredSizes,
      required: true
    };
  });
}

export function buildVariantFoundationForColorSize(colorVariants = []) {
  const normalized = normalizeColorVariants(colorVariants);
  const colorTokens = normalized.map((color) => [
    color.colorName,
    color.id,
    "",
    color.image
  ].filter(Boolean).join("|"));

  const sizeTokens = [...new Set(
    normalized.flatMap((color) => color.sizes.map((row) => row.size))
  )].map((size) => [size, slugify(size)].join("|"));

  return {
    enabled: normalized.length > 0,
    mode: COLOR_SIZE_MODE,
    optionMode: "structured",
    imagePerColor: true,
    pricingPerVariant: false,
    inventoryReady: true,
    skuPerVariant: false,
    colorVariants: normalized,
    groups: {
      color: {
        enabled: true,
        label: COLOR_ATTR_NAME,
        type: "color",
        required: true,
        optionTokens: colorTokens
      },
      size: {
        enabled: true,
        label: SIZE_ATTR_NAME,
        type: "size",
        required: true,
        optionTokens: sizeTokens
      }
    }
  };
}

export { slugify, toNumber };
