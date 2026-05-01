const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { createApiResponse, normalizeEmail, getJwtSecret } = require('../utils/helpers');

function getAdminCredentials() {
    const email = normalizeEmail(process.env.ADMIN_EMAIL || '');
    const passwordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();

    if (!email || !passwordHash) {
        throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD_HASH must be set in .env');
    }

    return { email, passwordHash };
}

async function login(req, res) {
    try {
        const { email, password } = req.body || {};
        const normalizedEmail = normalizeEmail(email);
        const inputPassword = String(password || '');

        if (!normalizedEmail || !inputPassword) {
            return res.status(400).json(
                createApiResponse({ success: false, message: 'Email and password are required' })
            );
        }

        const adminCredentials = getAdminCredentials();

        if (normalizedEmail !== adminCredentials.email) {
            return res.status(401).json(
                createApiResponse({ success: false, message: 'Invalid credentials' })
            );
        }

        const isPasswordValid = await bcrypt.compare(inputPassword, adminCredentials.passwordHash);

        if (!isPasswordValid) {
            return res.status(401).json(
                createApiResponse({ success: false, message: 'Invalid credentials' })
            );
        }

        const token = jwt.sign(
            { email: normalizedEmail, role: 'admin' },
            getJwtSecret(),
            { expiresIn: '1d' }
        );

        return res.status(200).json(
            createApiResponse({
                message: 'Admin login successful',
                data: {
                    token,
                    admin: { email: normalizedEmail }
                }
            })
        );
    } catch (error) {
        return res.status(500).json(
            createApiResponse({ success: false, message: error.message || 'Server error' })
        );
    }
}

async function getProfile(req, res) {
    return res.status(200).json(
        createApiResponse({
            message: 'Admin session is valid',
            data: { admin: req.admin }
        })
    );
}

module.exports = { login, getProfile };