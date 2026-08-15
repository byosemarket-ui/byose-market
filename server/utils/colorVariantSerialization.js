function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || '';
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveColorVariantImageUrl(entry = {}, normalizeUrl) {
    const image = String(entry?.image ?? entry?.thumbnail ?? '').trim();
    const imageStoragePath = String(entry?.imageStoragePath ?? entry?.imagePath ?? '').trim();
    const candidates = [image, imageStoragePath].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = String(normalizeUrl(candidate) || '').trim();
        if (resolved) {
            return resolved;
        }
    }

    return '';
}

function normalizeSizeRow(entry = {}) {
    const size = String(entry?.size ?? entry?.label ?? '').trim();
    const stock = Math.max(0, Math.floor(toNumber(entry?.stock, 0)));
    return { size, stock, value: slugify(size) || size };
}

function normalizeColorVariant(entry = {}, index = 0) {
    const colorName = String(entry?.colorName ?? entry?.name ?? entry?.label ?? '').trim();
    const id = String(entry?.id || slugify(colorName) || `color-${index + 1}`).trim();
    const imageStoragePath = String(entry?.imageStoragePath ?? entry?.imagePath ?? '').trim();
    const image = resolveColorVariantImageUrl(entry, (value) => value) || String(entry?.image ?? '').trim();
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

function enrichColorVariantsList(colorVariants = [], normalizeUrl) {
    return (Array.isArray(colorVariants) ? colorVariants : [])
        .map((entry, index) => {
            const imageStoragePath = String(entry?.imageStoragePath ?? entry?.imagePath ?? '').trim();
            const resolvedImage = resolveColorVariantImageUrl(entry, normalizeUrl);
            const normalized = normalizeColorVariant({
                ...entry,
                image: resolvedImage,
                imageStoragePath
            }, index);

            return {
                ...normalized,
                image: resolvedImage || normalized.image,
                imageStoragePath: imageStoragePath || normalized.imageStoragePath
            };
        })
        .filter((entry) => entry.colorName);
}

function computeProductTotalStock(colorVariants = [], fallbackQuantity = 0) {
    if (!Array.isArray(colorVariants) || !colorVariants.length) {
        return Math.max(0, Math.floor(toNumber(fallbackQuantity, 0)));
    }

    return colorVariants.reduce((sum, entry) => sum + Math.max(0, Number(entry?.totalStock) || 0), 0);
}

function buildFlatInventoryItems(colorVariants = []) {
    return (Array.isArray(colorVariants) ? colorVariants : []).flatMap((color) =>
        (Array.isArray(color?.sizes) ? color.sizes : []).map((sizeRow) => {
            const sizeValue = slugify(sizeRow.size) || sizeRow.size;
            const stock = Math.max(0, Math.floor(toNumber(sizeRow.stock, 0)));
            return {
                id: `${color.id}-${sizeValue}`,
                key: `Color:${color.id}|Size:${sizeValue}`,
                colorId: color.id,
                colorName: color.colorName,
                size: sizeRow.size,
                sizeValue,
                label: `${color.colorName} / ${sizeRow.size}`,
                image: color.image,
                stock,
                available: stock
            };
        })
    );
}

function buildAttributesFromColorVariants(colorVariants = []) {
    if (!Array.isArray(colorVariants) || !colorVariants.length) {
        return [];
    }

    const colorOptions = colorVariants.map((color) => ({
        label: color.colorName,
        value: color.id,
        image: color.image,
        swatch: '',
        stock: color.totalStock,
        availability: color.totalStock > 0 ? 'available' : 'out_of_stock'
    }));

    const uniqueSizes = new Map();
    colorVariants.forEach((color) => {
        color.sizes.forEach((sizeRow) => {
            const value = slugify(sizeRow.size) || sizeRow.size;
            const sizeStock = Math.max(0, Math.floor(toNumber(sizeRow.stock, 0)));
            const existing = uniqueSizes.get(value);
            if (!existing) {
                uniqueSizes.set(value, {
                    label: sizeRow.size,
                    value,
                    stock: sizeStock,
                    availability: sizeStock > 0 ? 'available' : 'out_of_stock'
                });
            } else {
                existing.stock += sizeStock;
                existing.availability = existing.stock > 0 ? 'available' : 'out_of_stock';
            }
        });
    });

    return [
        {
            name: 'Color',
            key: 'color',
            axis: 'color',
            type: 'color',
            required: true,
            options: colorOptions
        },
        {
            name: 'Size',
            key: 'size',
            axis: 'size',
            type: 'size',
            required: true,
            options: [...uniqueSizes.values()]
        }
    ];
}

function enrichSerializedProductColorVariants(payload, normalizeUrl) {
    if (!payload || typeof payload !== 'object') {
        return payload;
    }

    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const variants = payload.variants && typeof payload.variants === 'object' ? payload.variants : {};
    const sourceList = Array.isArray(variants.colorVariants) && variants.colorVariants.length
        ? variants.colorVariants
        : (Array.isArray(metadata.colorVariants) ? metadata.colorVariants : []);

    if (!sourceList.length) {
        return payload;
    }

    const colorVariants = enrichColorVariantsList(sourceList, normalizeUrl);
    const nextAttributes = buildAttributesFromColorVariants(colorVariants);
    const totalStock = computeProductTotalStock(colorVariants, payload.stock);

    return {
        ...payload,
        stock: totalStock,
        attributes: nextAttributes.length ? nextAttributes : payload.attributes,
        variants: {
            ...variants,
            mode: variants.mode || 'color_size',
            enabled: variants.enabled !== false,
            inventoryReady: true,
            imagePerColor: true,
            colorVariants,
            items: buildFlatInventoryItems(colorVariants)
        },
        metadata: {
            ...metadata,
            variantStockTotal: totalStock,
            stockStatus: totalStock <= 0 ? 'out_of_stock' : (totalStock <= 5 ? 'low_stock' : 'in_stock'),
            colorVariants: colorVariants.map((entry) => ({
                id: entry.id,
                clientKey: entry.clientKey || entry.id,
                colorName: entry.colorName,
                image: entry.image,
                imageStoragePath: entry.imageStoragePath || '',
                sizes: entry.sizes.map((row) => ({ size: row.size, stock: row.stock }))
            }))
        }
    };
}

module.exports = {
    enrichSerializedProductColorVariants,
    resolveColorVariantImageUrl
};
