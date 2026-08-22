const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    buildPublicUrlFromPath,
    normalizeManagedPath,
    resolveManagedAbsolutePath
} = require('./uploadstorage.service');

const HERO_MAX_EDGE = 1280;
const HERO_QUALITY = 82;
const OPTIMIZED_SUBDIR = 'optimized';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

const existenceCache = new Map();

function toPosix(value) {
    return String(value || '').replace(/\\/g, '/');
}

function isHeroManagedPath(managedPath) {
    const normalized = toPosix(normalizeManagedPath(managedPath));
    return /^hero\/(?!optimized\/)[^/]+\.[a-z0-9]+$/i.test(normalized);
}

function getOptimizedManagedPath(originalValue) {
    const managedPath = toPosix(normalizeManagedPath(originalValue));
    if (!isHeroManagedPath(managedPath)) {
        return '';
    }

    const fileName = path.posix.basename(managedPath, path.posix.extname(managedPath));
    if (!fileName) {
        return '';
    }

    return `hero/${OPTIMIZED_SUBDIR}/${fileName}.webp`;
}

function getOptimizedAbsolutePath(originalValue) {
    const optimizedPath = getOptimizedManagedPath(originalValue);
    return optimizedPath ? resolveManagedAbsolutePath(optimizedPath) : '';
}

function optimizedExists(originalValue) {
    const optimizedPath = getOptimizedManagedPath(originalValue);
    if (!optimizedPath) {
        return false;
    }

    const cached = existenceCache.get(optimizedPath);
    if (cached !== undefined) {
        return cached;
    }

    const absolutePath = resolveManagedAbsolutePath(optimizedPath);
    const exists = Boolean(absolutePath && fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0);
    existenceCache.set(optimizedPath, exists);
    return exists;
}

function rememberOptimizedExists(optimizedManagedPath, exists) {
    if (optimizedManagedPath) {
        existenceCache.set(optimizedManagedPath, Boolean(exists));
    }
}

function commandSucceeds(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000
    });
    return result.status === 0;
}

function generateWithMagick(sourcePath, destinationPath) {
    const resize = `${HERO_MAX_EDGE}x${HERO_MAX_EDGE}>`;
    const magickArgs = [sourcePath, '-resize', resize, '-strip', '-quality', String(HERO_QUALITY), destinationPath];
    if (commandSucceeds('magick', magickArgs)) {
        return true;
    }
    return commandSucceeds('convert', magickArgs);
}

function generateWithCwebp(sourcePath, destinationPath) {
    return commandSucceeds('cwebp', [
        '-quiet',
        '-q', String(HERO_QUALITY),
        '-resize', String(HERO_MAX_EDGE), '0',
        sourcePath,
        '-o', destinationPath
    ]);
}

function generateWithFfmpeg(sourcePath, destinationPath) {
    return commandSucceeds('ffmpeg', [
        '-y',
        '-loglevel', 'error',
        '-i', sourcePath,
        '-vf', `scale='min(${HERO_MAX_EDGE},iw)':-2`,
        '-frames:v', '1',
        '-q:v', '4',
        destinationPath
    ]);
}

function ensureOptimizedHeroImage(originalValue) {
    const sourcePath = resolveManagedAbsolutePath(originalValue);
    const optimizedManagedPath = getOptimizedManagedPath(originalValue);
    const destinationPath = getOptimizedAbsolutePath(originalValue);
    if (!sourcePath || !destinationPath || !fs.existsSync(sourcePath)) {
        return '';
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
        return '';
    }

    if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
        rememberOptimizedExists(optimizedManagedPath, true);
        return optimizedManagedPath;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    const generated = generateWithMagick(sourcePath, destinationPath)
        || generateWithCwebp(sourcePath, destinationPath)
        || generateWithFfmpeg(sourcePath, destinationPath);

    const exists = generated && fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0;
    rememberOptimizedExists(optimizedManagedPath, exists);
    return exists ? optimizedManagedPath : '';
}

function resolveOptimizedPublicUrl(originalValue) {
    const originalManaged = normalizeManagedPath(originalValue);
    if (!originalManaged || !optimizedExists(originalManaged)) {
        return '';
    }

    return buildPublicUrlFromPath(getOptimizedManagedPath(originalManaged));
}

function generateMissingHeroImages(limit = 50) {
    const heroDir = resolveManagedAbsolutePath('hero');
    if (!heroDir || !fs.existsSync(heroDir)) {
        return { generated: 0, skipped: 0, failed: 0 };
    }

    const summary = { generated: 0, skipped: 0, failed: 0 };
    const entries = fs.readdirSync(heroDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .slice(0, Math.max(1, Number(limit) || 50));

    entries.forEach((entry) => {
        const managedPath = `hero/${entry.name}`;
        const optimizedPath = getOptimizedAbsolutePath(managedPath);
        if (optimizedPath && fs.existsSync(optimizedPath) && fs.statSync(optimizedPath).size > 0) {
            summary.skipped += 1;
            return;
        }

        if (ensureOptimizedHeroImage(managedPath)) {
            summary.generated += 1;
            return;
        }

        summary.failed += 1;
    });

    return summary;
}

module.exports = {
    HERO_MAX_EDGE,
    ensureOptimizedHeroImage,
    generateMissingHeroImages,
    getOptimizedManagedPath,
    resolveOptimizedPublicUrl
};
