function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data: https://cdnjs.cloudflare.com https://fonts.gstatic.com",
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
            "connect-src 'self' https: wss:",
            "media-src 'self' data: blob:",
            "form-action 'self'"
        ].join('; ')
    );

    if (req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    next();
}

module.exports = securityHeaders;
