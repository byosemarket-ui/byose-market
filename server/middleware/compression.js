const zlib = require('zlib');

const COMPRESSIBLE = /json|text|javascript|css|svg\+xml|xml|html/i;
const MIN_SIZE = 1024;

function compressionMiddleware(req, res, next) {
    const accept = String(req.headers['accept-encoding'] || '');
    if (req.method === 'HEAD' || !/\bgzip\b/i.test(accept)) {
        return next();
    }

    const chunks = [];
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let ended = false;

    res.write = function write(chunk, encoding, callback) {
        if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
        }
        if (typeof encoding === 'function') {
            encoding();
        } else if (typeof callback === 'function') {
            callback();
        }
        return true;
    };

    res.end = function end(chunk, encoding, callback) {
        if (ended) {
            return res;
        }
        ended = true;

        if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
        }

        const body = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
        const type = String(res.getHeader('Content-Type') || '');
        const alreadyEncoded = Boolean(res.getHeader('Content-Encoding'));

        const finish = (payload) => {
            res.write = originalWrite;
            res.end = originalEnd;
            if (typeof encoding === 'function') {
                return originalEnd(payload, encoding);
            }
            return originalEnd(payload, encoding, callback);
        };

        if (alreadyEncoded || body.length < MIN_SIZE || !COMPRESSIBLE.test(type)) {
            if (!res.getHeader('Content-Length') && body.length) {
                res.setHeader('Content-Length', body.length);
            }
            return finish(body);
        }

        zlib.gzip(body, (error, compressed) => {
            if (error || !compressed) {
                return finish(body);
            }

            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Vary', 'Accept-Encoding');
            res.removeHeader('Content-Length');
            res.setHeader('Content-Length', compressed.length);
            return finish(compressed);
        });

        return res;
    };

    return next();
}

module.exports = compressionMiddleware;
