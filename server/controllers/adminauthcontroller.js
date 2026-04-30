const { comparePasswords } = require('../utils/hash');
const { generateToken } = require('../utils/token');
const { ADMIN_ACCOUNT, normalizeEmail, isConfiguredAdminRecord } = require('../config/admin-account');
const User = require('../models/user');

function sanitizeAdmin(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
    };
}

async function ensureAdminAccount() {
    await User.updateMany(
        {
            role: 'admin',
            $or: [
                { email: { $ne: normalizeEmail(ADMIN_ACCOUNT.email) } },
                { id: { $ne: ADMIN_ACCOUNT.id } }
            ]
        },
        {
            $set: { role: 'user' }
        }
    );

    const existingAdmin = await User.findOne({
        $or: [
            { email: normalizeEmail(ADMIN_ACCOUNT.email) },
            { id: ADMIN_ACCOUNT.id }
        ]
    });

    if (!existingAdmin) {
        await User.create({
            id: ADMIN_ACCOUNT.id,
            name: ADMIN_ACCOUNT.name,
            email: normalizeEmail(ADMIN_ACCOUNT.email),
            password: ADMIN_ACCOUNT.passwordHash,
            role: ADMIN_ACCOUNT.role
        });
        return;
    }

    let shouldSave = false;

    if (existingAdmin.id !== ADMIN_ACCOUNT.id) {
        existingAdmin.id = ADMIN_ACCOUNT.id;
        shouldSave = true;
    }

    if (existingAdmin.name !== ADMIN_ACCOUNT.name) {
        existingAdmin.name = ADMIN_ACCOUNT.name;
        shouldSave = true;
    }

    if (existingAdmin.email !== normalizeEmail(ADMIN_ACCOUNT.email)) {
        existingAdmin.email = normalizeEmail(ADMIN_ACCOUNT.email);
        shouldSave = true;
    }

    if (existingAdmin.password !== ADMIN_ACCOUNT.passwordHash) {
        existingAdmin.password = ADMIN_ACCOUNT.passwordHash;
        shouldSave = true;
    }

    if (existingAdmin.role !== ADMIN_ACCOUNT.role) {
        existingAdmin.role = ADMIN_ACCOUNT.role;
        shouldSave = true;
    }

    if (shouldSave) {
        await existingAdmin.save();
    }
}

async function login(req, res) {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const normalizedEmail = normalizeEmail(email);
        if (normalizedEmail !== normalizeEmail(ADMIN_ACCOUNT.email)) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const admin = await User.findOne({
            id: ADMIN_ACCOUNT.id,
            email: normalizeEmail(ADMIN_ACCOUNT.email),
            role: 'admin'
        });

        if (!isConfiguredAdminRecord(admin)) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const passwordMatches = await comparePasswords(String(password), admin.password);
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = generateToken({
            id: admin.id,
            email: admin.email,
            role: admin.role
        });

        return res.json({
            success: true,
            token,
            admin: sanitizeAdmin(admin)
        });
    } catch (error) {
        console.error('Admin login error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function session(req, res) {
    return res.json({ success: true, admin: sanitizeAdmin(req.admin) });
}

module.exports = {
    ensureAdminAccount,
    login,
    session
};