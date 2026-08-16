const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    buildPublicUrlFromPath,
    normalizeManagedPath,
    resolveManagedAbsolutePath
} = require('./uploadstorage.service');

const CARD_MAX_EDGE = 640;
const CARD_QUALITY = 78;
const CARD_SUBDIR = 'cards';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

const existenceCache = new Map();

function toPosix(value) {
    return String(value || '').replace(/\\/g, '/');
}

function isProductManagedPath(managedPath) {
    const normalized = toPosix(normalizeManagedPath(managedPath));
    return /^products\/(?!cards\/)[^/]+\.[a-z0-9]+$/i.test(normalized);
}

function getCardManagedPath(originalValue) {
    const managedPath = toPosix(normalizeManagedPath(originalValue));
    if (!isProductManagedPath(managedPath)) {
        return '';
    }

    const fileName = path.posix.basename(managedPath, path.posix.extname(managedPath));
    if (!fileName) {
        return '';
    }

    return `products/${CARD_SUBDIR}/${fileName}.webp`;
}

function getCardAbsolutePath(originalValue) {
    const cardPath = getCardManagedPath(originalValue);
    return cardPath ? resolveManagedAbsolutePath(cardPath) : '';
}

function cardExists(originalValue) {
    const cardPath = getCardManagedPath(originalValue);
    if (!cardPath) {
        return false;
    }

    const cached = existenceCache.get(cardPath);
    if (cached !== undefined) {
        return cached;
    }

    const absolutePath = resolveManagedAbsolutePath(cardPath);
    const exists = Boolean(absolutePath && fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0);
    existenceCache.set(cardPath, exists);
    return exists;
}

function rememberCardExists(cardManagedPath, exists) {
    if (cardManagedPath) {
        existenceCache.set(cardManagedPath, Boolean(exists));
    }
}

function commandSucceeds(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20000
    });
    return result.status === 0;
}

function generateWithMagick(sourcePath, destinationPath) {
    const resize = `${CARD_MAX_EDGE}x${CARD_MAX_EDGE}>`;
    const magickArgs = [sourcePath, '-resize', resize, '-strip', '-quality', String(CARD_QUALITY), destinationPath];
    if (commandSucceeds('magick', magickArgs)) {
        return true;
    }
    return commandSucceeds('convert', magickArgs);
}

function generateWithFfmpeg(sourcePath, destinationPath) {
    return commandSucceeds('ffmpeg', [
        '-y',
        '-loglevel', 'error',
        '-i', sourcePath,
        '-vf', `scale='min(${CARD_MAX_EDGE},iw)':-2`,
        '-frames:v', '1',
        '-q:v', '4',
        destinationPath
    ]);
}

function generateWithCwebp(sourcePath, destinationPath) {
    return commandSucceeds('cwebp', [
        '-quiet',
        '-q', String(CARD_QUALITY),
        '-resize', String(CARD_MAX_EDGE), '0',
        sourcePath,
        '-o', destinationPath
    ]);
}

function generateWithPython(sourcePath, destinationPath) {
    const script = [
        'import sys',
        'src, dest, max_edge = sys.argv[1], sys.argv[2], int(sys.argv[3])',
        'from PIL import Image',
        'image = Image.open(src)',
        'image = image.convert("RGB") if image.mode not in ("RGB", "L") else image',
        'image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)',
        'image.save(dest, "WEBP", quality=int(sys.argv[4]), method=6)'
    ].join('; ');

    return commandSucceeds('python3', [ '-c', script, sourcePath, destinationPath, String(CARD_MAX_EDGE), String(CARD_QUALITY) ])
        || commandSucceeds('python', [ '-c', script, sourcePath, destinationPath, String(CARD_MAX_EDGE), String(CARD_QUALITY) ]);
}

function ensureCardImage(originalValue) {
    const sourcePath = resolveManagedAbsolutePath(originalValue);
    const cardManagedPath = getCardManagedPath(originalValue);
    const destinationPath = getCardAbsolutePath(originalValue);
    if (!sourcePath || !destinationPath || !fs.existsSync(sourcePath)) {
        return '';
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
        return '';
    }

    if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
        rememberCardExists(cardManagedPath, true);
        return cardManagedPath;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    const generated = generateWithMagick(sourcePath, destinationPath)
        || generateWithCwebp(sourcePath, destinationPath)
        || generateWithFfmpeg(sourcePath, destinationPath)
        || generateWithPython(sourcePath, destinationPath);

    const exists = generated && fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0;
    rememberCardExists(cardManagedPath, exists);
    return exists ? cardManagedPath : '';
}

function resolveCardPublicUrl(originalValue) {
    const originalManaged = normalizeManagedPath(originalValue);
    if (!originalManaged || !cardExists(originalManaged)) {
        return '';
    }

    return buildPublicUrlFromPath(getCardManagedPath(originalManaged));
}

function collectCardDerivativePaths(values = []) {
    const candidates = Array.isArray(values) ? values : [values];
    return Array.from(new Set(candidates.map((entry) => getCardManagedPath(entry)).filter(Boolean)));
}

function generateMissingProductCards(limit = 500) {
    const productsDir = resolveManagedAbsolutePath('products');
    if (!productsDir || !fs.existsSync(productsDir)) {
        return { generated: 0, skipped: 0, failed: 0 };
    }

    const summary = { generated: 0, skipped: 0, failed: 0 };
    const entries = fs.readdirSync(productsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .slice(0, Math.max(1, Number(limit) || 500));

    entries.forEach((entry) => {
        const managedPath = `products/${entry.name}`;
        const cardPath = getCardAbsolutePath(managedPath);
        if (cardPath && fs.existsSync(cardPath) && fs.statSync(cardPath).size > 0) {
            summary.skipped += 1;
            return;
        }

        if (ensureCardImage(managedPath)) {
            summary.generated += 1;
            return;
        }

        summary.failed += 1;
    });

    return summary;
}

module.exports = {
    CARD_MAX_EDGE,
    collectCardDerivativePaths,
    ensureCardImage,
    generateMissingProductCards,
    getCardManagedPath,
    resolveCardPublicUrl
};
