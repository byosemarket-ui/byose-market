const { comparePasswords } = require('../utils/hash');
const { generateToken } = require('../utils/token');
const User = require('../models/user');

const ADMIN_ACCOUNT = {
    id: 'BMADMIN001',
    name: 'Byose Market Admin',
    email: 'byosemarket@gmail.com',
    passwordHash: '$2a$10$556SqQJtkKET4kEi279iwuJFTjdm/ejzQ9pROfE4pIuud4.7tfIXK',
    role: 'admin'
};

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
    const existingAdmin = await User.findOne({ email: ADMIN_ACCOUNT.email.toLowerCase() });

    if (!existingAdmin) {
        await User.create({
            id: ADMIN_ACCOUNT.id,
            name: ADMIN_ACCOUNT.name,
            email: ADMIN_ACCOUNT.email.toLowerCase(),
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

        const normalizedEmail = String(email).trim().toLowerCase();
        const admin = await User.findOne({ email: normalizedEmail, role: 'admin' });

        if (!admin) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }

        const passwordMatches = await comparePasswords(String(password), admin.password);
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
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