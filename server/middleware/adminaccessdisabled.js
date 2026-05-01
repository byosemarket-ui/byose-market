function adminAccessDisabled(req, res) {
    return res.status(503).json({
        success: false,
        message: 'Admin authentication is not configured. Rebuild the admin login system before using admin-only API routes.'
    });
}

module.exports = adminAccessDisabled;