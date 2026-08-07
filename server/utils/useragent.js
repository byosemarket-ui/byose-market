function normalizeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

function parseUserAgent(userAgent) {
    const ua = normalizeText(userAgent);
    const lower = ua.toLowerCase();

    let browser = 'Unknown Browser';
    if (/edg\//i.test(ua)) browser = 'Microsoft Edge';
    else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
    else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
    else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';
    else if (/firefox\//i.test(ua)) browser = 'Firefox';
    else if (/msie|trident/i.test(ua)) browser = 'Internet Explorer';

    let os = 'Unknown OS';
    if (/windows nt 10/i.test(ua)) os = 'Windows 10/11';
    else if (/windows nt 6\.3/i.test(ua)) os = 'Windows 8.1';
    else if (/windows nt 6\.1/i.test(ua)) os = 'Windows 7';
    else if (/windows/i.test(ua)) os = 'Windows';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
    else if (/mac os x/i.test(ua)) os = 'macOS';
    else if (/cros/i.test(ua)) os = 'Chrome OS';
    else if (/linux/i.test(ua)) os = 'Linux';

    let deviceName = 'Desktop';
    if (/ipad|tablet/i.test(ua)) deviceName = 'Tablet';
    else if (/mobi|iphone|android/i.test(ua)) deviceName = 'Mobile';
    else if (/macintosh|mac os x/i.test(ua)) deviceName = 'Mac';
    else if (/windows/i.test(ua)) deviceName = 'Windows PC';
    else if (/linux/i.test(ua)) deviceName = 'Linux PC';

    return {
        browser,
        os,
        deviceName,
        isMobile: /mobi|iphone|android|ipad|tablet/i.test(lower)
    };
}

function resolveApproximateLocation(req) {
    const headers = req?.headers || {};
    const country = normalizeText(
        headers['cf-ipcountry']
        || headers['x-vercel-ip-country']
        || headers['x-country-code']
        || headers['cloudfront-viewer-country']
    ).toUpperCase();
    const city = normalizeText(
        headers['cf-ipcity']
        || headers['x-vercel-ip-city']
        || headers['x-city']
    );

    return {
        country: country && country !== 'XX' ? country : '',
        city
    };
}

function buildDeviceLabel({ deviceName = '', browser = '', os = '' } = {}) {
    const parts = [normalizeText(deviceName), normalizeText(browser), normalizeText(os)].filter(Boolean);
    return parts.join(' · ') || 'Unknown device';
}

module.exports = {
    buildDeviceLabel,
    parseUserAgent,
    resolveApproximateLocation
};
