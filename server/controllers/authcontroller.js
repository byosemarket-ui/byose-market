// ===============================
// AUTH CONTROLLER (signup, login, profile, forgot/reset) - DB-backed
// ===============================

const { hashPassword, comparePasswords } = require('../utils/hash');
const { generateToken } = require('../utils/token');
const { generateOTP, saveOTP, verifyOTP } = require('../utils/otp');
const { sendSMS } = require('../utils/sms');
const { appLogger } = require('../utils/logger');
const getRealtimeEventService = require('../services/realtimeeventservice');
const userDataService = require('../services/userdataservice');

const authLogger = appLogger.child({ scope: 'auth' });

function sanitizeUserForClient(u) {
    if (!u) return null;
    return {
        id: u.id,
        name: u.name,
        email: u.email || '',
        phone: u.phone || '',
        avatar: u.avatar || '',
        status: u.status || 'active',
        verified: Boolean(u.verified),
        address: u.address || {},
        createdAt: u.createdAt || 0
    };
}

function isAdminUser(user) {
    return Boolean(user && user.role === 'admin');
}

function isStrongPassword(password) {
    const value = String(password || '');
    if (value.length < 8 || value.length > 128) {
        return false;
    }

    const hasLower = /[a-z]/.test(value);
    const hasUpper = /[A-Z]/.test(value);
    const hasNumber = /\d/.test(value);
    return hasLower && hasUpper && hasNumber;
}

async function generateUserId() {
    return userDataService.getNextUserId();
}

// ===============================
// Signup
// ===============================
exports.signup = async (req, res) => {
    try {
        const { name, email, phone, password } = req.body || {};
        if (!name) return res.status(400).json({ success: false, message: 'Name required' });
        if (!email && !phone) return res.status(400).json({ success: false, message: 'Email or phone required' });
        if (!isStrongPassword(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be 8+ chars with uppercase, lowercase, and number'
            });
        }

        if (email) {
            const ex = await userDataService.emailExists(String(email).toLowerCase());
            if (ex) return res.status(409).json({ success: false, message: 'Email exists' });
        }
        if (phone) {
            const ex2 = await userDataService.phoneExists(String(phone));
            if (ex2) return res.status(409).json({ success: false, message: 'Phone exists' });
        }

        const hashed = await hashPassword(String(password));
        const id = await generateUserId();
        const avatar = req.body.avatar || '';

        const newUser = await userDataService.createUser({
            id,
            name: String(name),
            email: email ? String(email).toLowerCase() : '',
            phone: phone ? String(phone) : '',
            password: hashed,
            avatar
        });

        const realtimeService = getRealtimeEventService();
        const sanitizedUser = sanitizeUserForClient(newUser);
        realtimeService.emitCustomerRegistered(sanitizedUser);
        realtimeService.emitAnalyticsUpdated({ source: 'customers', action: 'registered' });

        const token = generateToken({ id: newUser.id, email: newUser.email, phone: newUser.phone, role: newUser.role });

        return res.json({ success: true, token, user: sanitizedUser });
    } catch (err) {
        authLogger.error('auth.signup_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===============================
// Login
// ===============================
exports.login = async (req, res) => {
    try {
        const { identifier, password } = req.body || {};
        if (!identifier || !password) return res.status(400).json({ success: false, message: 'Identifier and password required' });

        const id = String(identifier).trim().toLowerCase();
        const user = await userDataService.findUserByIdentifier(id, { includeAdmins: false });
        if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }
        if (isAdminUser(user)) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const ok = await comparePasswords(String(password), user.password);
        if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const token = generateToken({ id: user.id, email: user.email, phone: user.phone, role: user.role });

        return res.json({ success: true, token, user: sanitizeUserForClient(user) });
    } catch (err) {
        authLogger.error('auth.login_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===============================
// Get current user (requires auth middleware)
// ===============================
exports.me = async (req, res) => {
    try {
        const uid = req.user && req.user.id;
        if (!uid) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const user = await userDataService.findUserById(uid);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (isAdminUser(user)) return res.status(403).json({ success: false, message: 'Unauthorized' });
        return res.json({ success: true, user: sanitizeUserForClient(user) });
    } catch (err) {
        authLogger.error('auth.me_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateMe = async (req, res) => {
    try {
        const uid = req.user && req.user.id;
        if (!uid) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const user = await userDataService.findUserById(uid);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (isAdminUser(user)) return res.status(403).json({ success: false, message: 'Unauthorized' });
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }

        const nextName = String(req.body?.name || user.name || '').trim();
        const nextAvatar = String(req.body?.avatar || user.avatar || '').trim();
        const nextEmail = String(req.body?.email || user.email || '').trim().toLowerCase();
        const nextPhone = String(req.body?.phone || user.phone || '').trim();

        if (!nextName) {
            return res.status(400).json({ success: false, message: 'Name required' });
        }

        if (nextEmail && nextEmail !== String(user.email || '').trim().toLowerCase()) {
            const existingEmail = await userDataService.emailExists(nextEmail, user.id);
            if (existingEmail) {
                return res.status(409).json({ success: false, message: 'Email exists' });
            }
        }

        if (nextPhone && nextPhone !== String(user.phone || '').trim()) {
            const existingPhone = await userDataService.phoneExists(nextPhone, user.id);
            if (existingPhone) {
                return res.status(409).json({ success: false, message: 'Phone exists' });
            }
        }

        const address = req.body?.address && typeof req.body.address === 'object' ? req.body.address : {};
        const updatedUser = await userDataService.updateUser(user.id, {
            ...user,
            name: nextName,
            avatar: nextAvatar,
            email: nextEmail,
            phone: nextPhone,
            address: {
            ...(user.address || {}),
            ...address,
            line1: String(address.line1 || address.street || user.address?.line1 || '').trim(),
            street: String(address.street || address.line1 || user.address?.street || '').trim(),
            city: String(address.city || '').trim(),
            district: String(address.district || '').trim(),
            sector: String(address.sector || '').trim(),
            cell: String(address.cell || '').trim(),
            village: String(address.village || '').trim(),
            firstName: String(address.firstName || '').trim(),
            lastName: String(address.lastName || '').trim(),
            phone: String(address.phone || nextPhone || user.phone || '').trim()
        }
        });

        const sanitizedUser = sanitizeUserForClient(updatedUser);
        const realtimeService = getRealtimeEventService();
        realtimeService.emitCustomerUpdated(user.id, sanitizedUser);
        realtimeService.emitAnalyticsUpdated({ source: 'customers', action: 'updated' });

        return res.json({ success: true, user: sanitizedUser });
    } catch (err) {
        authLogger.error('auth.update_me_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ===============================
// FORGOT / VERIFY / RESET (keeps previous OTP behavior)
// ===============================
exports.forgotPassword = async (req, res) => {
    try {
        const { method, identifier } = req.body;
        if (!identifier) return res.status(400).json({ success: false, message: 'Identifier required' });
        const normalizedIdentifier = String(identifier).trim().toLowerCase();
        const user = await userDataService.findUserByIdentifier(String(identifier).trim(), { includeAdmins: true });
        if (!user || isAdminUser(user)) {
            authLogger.info('auth.forgot_password_suppressed', {
                identifier: normalizedIdentifier,
                reason: !user ? 'not_found' : 'admin_account'
            });
            return res.json({ success: true });
        }

        const otp = generateOTP();
        saveOTP(identifier, otp);

        if (method === 'phone') {
            const result = await sendSMS(identifier, `Your OTP code is ${otp}`);
            if (!result.success) {
                authLogger.error('auth.forgot_password.sms_failed', {
                    identifier: normalizedIdentifier,
                    error: result.error
                });
                return res.status(500).json({ success: false, message: 'SMS failed' });
            }
        }

        authLogger.info('auth.forgot_password_requested', {
            identifier: normalizedIdentifier,
            deliveryMethod: method === 'phone' ? 'phone' : 'email'
        });
        return res.json({ success: true });
    } catch (error) {
        authLogger.error('auth.forgot_password_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.verifyCode = (req, res) => {
    const { identifier, otp } = req.body;
    const result = verifyOTP(identifier, otp);
    if (!result.success) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true });
};

exports.resetPassword = async (req, res) => {
    try {
        const { identifier, newPassword } = req.body;
        if (!identifier || !newPassword) return res.status(400).json({ success: false, message: 'Identifier and new password required' });
        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be 8+ chars with uppercase, lowercase, and number'
            });
        }

        const normalizedIdentifier = String(identifier).trim().toLowerCase();
        const user = await userDataService.findUserByIdentifier(String(identifier).trim(), { includeAdmins: false });
        if (!user) {
            authLogger.info('auth.password_reset_suppressed', {
                identifier: normalizedIdentifier,
                reason: 'not_found'
            });
            return res.json({ success: true });
        }
        await userDataService.updateUser(user.id, {
            ...user,
            password: await hashPassword(String(newPassword))
        });
        authLogger.info('auth.password_reset_completed', { identifier: normalizedIdentifier, userId: user.id });
        return res.json({ success: true });
    } catch (error) {
        authLogger.error('auth.password_reset_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};