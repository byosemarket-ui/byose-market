function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('X-XSS-Protection', '0');

    if (req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    next();
}

module.exports = securityHeaders;
