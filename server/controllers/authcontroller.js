// ===============================
// AUTH CONTROLLER (signup, login, profile, forgot/reset) - DB-backed
// ===============================

const { hashPassword, comparePasswords } = require('../utils/hash');
const { generateOTP, saveOTP, verifyOTP, issueResetToken, verifyResetToken } = require('../utils/otp');
const { readAccessTokenClaims } = require('../utils/token');
const customerSessionService = require('../services/customersession.service');
const customerAddressService = require('../services/customeraddress.service');
const authMiddleware = require('../middleware/authmiddleware');
const { sendSMS } = require('../utils/sms');
const { notifyPasswordReset } = require('../utils/notifications');
const { appLogger } = require('../utils/logger');
const getRealtimeEventService = require('../services/realtimeeventservice');
const userDataService = require('../services/userdataservice');
const { normalizeRwandaPhone, rwandaPhoneVariants, isValidRwandaPhone } = require('../utils/phone');
const { buildRelativeUploadPath, deleteManagedFiles } = require('../services/uploadstorage.service');

const authLogger = appLogger.child({ scope: 'auth' });

function canonicalizePhone(value) {
    return normalizeRwandaPhone(value) || String(value || '').trim();
}

function normalizeCustomerAvatarPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        if (/^https?:\/\//i.test(raw)) {
            const pathname = new URL(raw).pathname || '';
            if (pathname.startsWith('/uploads/')) {
                return pathname.replace(/^\/uploads\//, '');
            }
        }
    } catch (_error) {
        /* keep raw */
    }
    return raw.replace(/^\/+/, '').replace(/^uploads\//i, '');
}

async function phoneAlreadyExists(phone, excludeUserId = '') {
    const variants = rwandaPhoneVariants(phone);
    for (const variant of variants) {
        const exists = await userDataService.phoneExists(variant, excludeUserId);
        if (exists) {
            return true;
        }
    }
    return false;
}

function sanitizeUserForClient(u) {
    if (!u) return null;
    const preferences = u.preferences && typeof u.preferences === 'object' ? u.preferences : {};
    const interestCategories = Array.isArray(preferences.interestCategories)
        ? preferences.interestCategories.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [];
    return {
        id: u.id,
        name: u.name,
        email: u.email || '',
        phone: u.phone || '',
        avatar: u.avatar || '',
        status: u.status || 'active',
        verified: Boolean(u.verified),
        preferredLanguage: String(u.preferredLanguage || 'en').trim().toLowerCase() || 'en',
        preferences: {
            interestCategories
        },
        address: u.address || {},
        createdAt: u.createdAt || 0
    };
}

const ALLOWED_CUSTOMER_LANGUAGES = new Set(['en', 'rw', 'fr']);
const ALLOWED_INTEREST_CATEGORIES = new Set([
    'fashion', 'shoes', 'bags', 'electronics', 'phones', 'beauty', 'accessories', 'home'
]);

function normalizeCustomerLanguage(value, fallback = 'en') {
    const lang = String(value || '').trim().toLowerCase();
    if (ALLOWED_CUSTOMER_LANGUAGES.has(lang)) return lang;
    return ALLOWED_CUSTOMER_LANGUAGES.has(fallback) ? fallback : 'en';
}

function normalizeInterestCategories(input) {
    const list = Array.isArray(input) ? input : [];
    const unique = [];
    list.forEach((item) => {
        const key = String(item || '').trim().toLowerCase();
        if (!ALLOWED_INTEREST_CATEGORIES.has(key) || unique.includes(key)) return;
        unique.push(key);
    });
    return unique;
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

function isAccountLocked(user) {
    if (!user || !user.lockedUntil) {
        return false;
    }

    const lockedUntilMs = Date.parse(String(user.lockedUntil));
    if (!Number.isFinite(lockedUntilMs)) {
        return false;
    }

    return lockedUntilMs > Date.now();
}

function lockoutMessage(lockedUntil) {
    const lockedUntilMs = Date.parse(String(lockedUntil || ''));
    if (!Number.isFinite(lockedUntilMs)) {
        return 'Too many failed login attempts. Please try again later.';
    }

    const minutes = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 60000));
    return `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

async function generateUserId() {
    return userDataService.getNextUserId();
}

// ===============================
// Signup
// ===============================
exports.signup = async (req, res) => {
    try {
        const generalSettingsService = require('../services/generalsettings.service');
        const platformSettings = await generalSettingsService.getGeneralSettings();
        if (!platformSettings.allowCustomerRegistration) {
            return res.status(403).json({
                success: false,
                code: 'REGISTRATION_DISABLED',
                message: 'Customer registration is currently disabled.'
            });
        }
        if (platformSettings.maintenanceMode || platformSettings.storeStatus === 'closed') {
            return res.status(503).json({
                success: false,
                code: 'STORE_UNAVAILABLE',
                message: 'The store is temporarily unavailable. Please try again later.'
            });
        }

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
            if (ex) return res.status(409).json({ success: false, message: 'This email is already registered.' });
        }
        if (phone) {
            const canonicalPhone = canonicalizePhone(phone);
            const ex2 = await phoneAlreadyExists(canonicalPhone);
            if (ex2) return res.status(409).json({ success: false, message: 'This phone number is already registered.' });
        }

        const hashed = await hashPassword(String(password));
        const id = await generateUserId();
        const avatar = req.body.avatar || '';

        const newUser = await userDataService.createUser({
            id,
            name: String(name),
            email: email ? String(email).toLowerCase() : '',
            phone: phone ? canonicalizePhone(phone) : '',
            password: hashed,
            avatar,
            role: platformSettings.defaultCustomerRole || 'user'
        });

        const realtimeService = getRealtimeEventService();
        const sanitizedUser = sanitizeUserForClient(newUser);
        realtimeService.emitCustomerRegistered(sanitizedUser);
        realtimeService.emitAnalyticsUpdated({ source: 'customers', action: 'registered' });

        try {
            const notificationEngine = require('../services/notification-engine.service');
            void notificationEngine.notifyCustomerRegistered(sanitizedUser);
        } catch (_engineError) {
            // non-blocking
        }

        const session = customerSessionService.issueCustomerSession(newUser, { remember: true, req });

        return res.json({
            success: true,
            token: session.token,
            refreshToken: session.refreshToken,
            expiresIn: session.expiresIn,
            user: sanitizedUser
        });
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
        const { identifier, password, rememberMe } = req.body || {};
        if (!identifier || !password) return res.status(400).json({ success: false, message: 'Identifier and password required' });

        const id = String(identifier).trim().toLowerCase();
        const user = await userDataService.findUserByIdentifier(id, { includeAdmins: false });
        const invalidCredentials = { success: false, message: 'Invalid credentials.' };
        if (!user || isAdminUser(user)) {
            return res.status(401).json(invalidCredentials);
        }
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }
        if (isAccountLocked(user)) {
            return res.status(429).json({ success: false, message: lockoutMessage(user.lockedUntil) });
        }

        const ok = await comparePasswords(String(password), user.password);
        if (!ok) {
            const failure = await userDataService.recordFailedLogin(user.id);
            if (failure.lockedUntil) {
                return res.status(429).json({ success: false, message: lockoutMessage(failure.lockedUntil) });
            }
            return res.status(401).json(invalidCredentials);
        }

        const updatedUser = await userDataService.recordSuccessfulLogin(user.id);
        const session = customerSessionService.issueCustomerSession(updatedUser || user, {
            remember: rememberMe !== false,
            req
        });

        return res.json({
            success: true,
            token: session.token,
            refreshToken: session.refreshToken,
            expiresIn: session.expiresIn,
            user: sanitizeUserForClient(updatedUser || user)
        });
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

exports.refresh = async (req, res) => {
    try {
        const refreshToken = String(req.body?.refreshToken || '').trim();
        if (!refreshToken) {
            return res.status(400).json({ success: false, message: 'Refresh token required', code: 'REFRESH_REQUIRED' });
        }

        const session = customerSessionService.findActiveByRefreshToken(refreshToken);
        if (!session) {
            return res.status(401).json({ success: false, message: 'Session expired', code: 'SESSION_REVOKED' });
        }

        const user = await userDataService.findUserById(session.userPublicId);
        if (!user || isAdminUser(user)) {
            customerSessionService.revokeSession(session.sessionId, 'invalid_user');
            return res.status(401).json({ success: false, message: 'Session expired', code: 'SESSION_REVOKED' });
        }
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            customerSessionService.revokeSession(session.sessionId, 'blocked');
            return res.status(403).json({ success: false, message: 'Account blocked', code: 'ACCOUNT_BLOCKED' });
        }

        const rotated = customerSessionService.rotateCustomerSession(session, user, { req });
        return res.json({
            success: true,
            token: rotated.token,
            refreshToken: rotated.refreshToken,
            expiresIn: rotated.expiresIn,
            user: sanitizeUserForClient(user)
        });
    } catch (err) {
        authLogger.error('auth.refresh_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.logout = async (req, res) => {
    try {
        const refreshToken = String(req.body?.refreshToken || '').trim();
        const bearer = authMiddleware.extractBearerToken(req);

        if (refreshToken) {
            customerSessionService.revokeByRefreshToken(refreshToken, 'logout');
        }

        if (bearer) {
            const claims = readAccessTokenClaims(bearer, { ignoreExpiration: true });
            if (claims?.sid) {
                customerSessionService.revokeSession(claims.sid, 'logout');
            }
        }

        return res.json({ success: true });
    } catch (err) {
        authLogger.error('auth.logout_failed', { error: err });
        return res.json({ success: true });
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
        const nextAvatar = Object.prototype.hasOwnProperty.call(req.body || {}, 'avatar')
            ? normalizeCustomerAvatarPath(req.body.avatar)
            : String(user.avatar || '').trim();
        const nextEmail = String(req.body?.email || user.email || '').trim().toLowerCase();
        const nextPhone = canonicalizePhone(req.body?.phone || user.phone || '');
        let nextPreferredLanguage = normalizeCustomerLanguage(user.preferredLanguage, 'en');
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'preferredLanguage')) {
            const requestedLanguage = String(req.body.preferredLanguage || '').trim().toLowerCase();
            if (!ALLOWED_CUSTOMER_LANGUAGES.has(requestedLanguage)) {
                return res.status(400).json({
                    success: false,
                    message: 'Unsupported language. Choose English, Kinyarwanda, or Français.'
                });
            }
            nextPreferredLanguage = requestedLanguage;
        }

        const existingPreferences = user.preferences && typeof user.preferences === 'object' ? user.preferences : {};
        let nextPreferences = {
            interestCategories: normalizeInterestCategories(existingPreferences.interestCategories)
        };
        const hasPreferencesUpdate = Object.prototype.hasOwnProperty.call(req.body || {}, 'preferences')
            || Object.prototype.hasOwnProperty.call(req.body || {}, 'interestCategories');
        if (hasPreferencesUpdate) {
            const incomingPrefs = req.body?.preferences && typeof req.body.preferences === 'object'
                ? req.body.preferences
                : {};
            const categories = Object.prototype.hasOwnProperty.call(req.body || {}, 'interestCategories')
                ? req.body.interestCategories
                : incomingPrefs.interestCategories;
            nextPreferences = {
                interestCategories: normalizeInterestCategories(categories)
            };
            if (!nextPreferences.interestCategories.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Select at least one category.'
                });
            }
        }

        if (!nextName) {
            return res.status(400).json({ success: false, message: 'Name required' });
        }

        if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
            return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
        }

        if (nextPhone && !isValidRwandaPhone(nextPhone)) {
            return res.status(400).json({ success: false, message: 'Enter a valid Rwanda phone number.' });
        }

        if (nextEmail && nextEmail !== String(user.email || '').trim().toLowerCase()) {
            const existingEmail = await userDataService.emailExists(nextEmail, user.id);
            if (existingEmail) {
                return res.status(409).json({ success: false, message: 'This email is already registered.' });
            }
        }

        if (nextPhone && nextPhone !== canonicalizePhone(user.phone || '')) {
            const existingPhone = await phoneAlreadyExists(nextPhone, user.id);
            if (existingPhone) {
                return res.status(409).json({ success: false, message: 'This phone number is already registered.' });
            }
        }

        const hasAddressUpdate = Boolean(req.body?.address && typeof req.body.address === 'object');
        const address = hasAddressUpdate ? req.body.address : {};
        const nextAddress = hasAddressUpdate
            ? {
                ...(user.address || {}),
                ...address,
                line1: String(address.line1 ?? address.street ?? '').trim(),
                street: String(address.street ?? address.line1 ?? '').trim(),
                city: String(address.city ?? address.provinceCity ?? '').trim(),
                provinceCity: String(address.provinceCity ?? address.city ?? '').trim(),
                district: String(address.district ?? '').trim(),
                sector: String(address.sector ?? '').trim(),
                cell: String(address.cell ?? '').trim(),
                village: String(address.village ?? '').trim(),
                firstName: String(address.firstName ?? '').trim(),
                lastName: String(address.lastName ?? '').trim(),
                fullName: String(address.fullName ?? `${address.firstName || ''} ${address.lastName || ''}`).trim(),
                note: String(address.note ?? address.additional ?? '').trim(),
                additional: String(address.additional ?? address.note ?? '').trim(),
                phone: String(address.phone ?? nextPhone).trim()
            }
            : (user.address || {});
        const updatedUser = await userDataService.updateUser(user.id, {
            ...user,
            name: nextName,
            avatar: nextAvatar,
            email: nextEmail,
            phone: nextPhone,
            preferredLanguage: nextPreferredLanguage,
            preferences: nextPreferences,
            address: nextAddress
        });

        if (hasAddressUpdate) {
            try {
                await customerAddressService.upsertFromProfile(user.id, nextAddress, {
                    name: nextName,
                    phone: nextPhone
                });
            } catch (addressError) {
                authLogger.warn('auth.update_me_address_sync_failed', { error: addressError, userId: user.id });
            }
        }

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

exports.uploadMePhoto = async (req, res) => {
    try {
        const uid = req.user && req.user.id;
        if (!uid) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const user = await userDataService.findUserById(uid);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (isAdminUser(user)) return res.status(403).json({ success: false, message: 'Unauthorized' });
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }

        const uploaded = Array.isArray(req.files) && req.files[0] ? req.files[0] : null;
        let avatarPath = normalizeCustomerAvatarPath(req.body?.avatar || req.body?.path || req.body?.storagePath || '');

        if (uploaded && req.uploadBucket) {
            avatarPath = buildRelativeUploadPath(req.uploadBucket.key, uploaded.filename);
        }

        avatarPath = normalizeCustomerAvatarPath(avatarPath);
        if (!avatarPath || !/^users\//i.test(avatarPath)) {
            return res.status(400).json({
                success: false,
                code: 'AVATAR_REQUIRED',
                message: 'Upload a valid profile photo.'
            });
        }

        const previousAvatar = normalizeCustomerAvatarPath(user.avatar);
        const updatedUser = await userDataService.updateUser(user.id, {
            ...user,
            avatar: avatarPath
        });

        if (previousAvatar && previousAvatar !== avatarPath) {
            try {
                deleteManagedFiles([previousAvatar]);
            } catch (_error) {
                /* non-blocking cleanup */
            }
        }

        const sanitizedUser = sanitizeUserForClient(updatedUser);
        const realtimeService = getRealtimeEventService();
        realtimeService.emitCustomerUpdated(user.id, sanitizedUser);
        realtimeService.emitAnalyticsUpdated({ source: 'customers', action: 'updated' });

        return res.json({
            success: true,
            message: 'Profile photo updated successfully',
            user: sanitizedUser
        });
    } catch (err) {
        authLogger.error('auth.upload_me_photo_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to update profile photo' });
    }
};

exports.removeMePhoto = async (req, res) => {
    try {
        const uid = req.user && req.user.id;
        if (!uid) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const user = await userDataService.findUserById(uid);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (isAdminUser(user)) return res.status(403).json({ success: false, message: 'Unauthorized' });
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }

        const previousAvatar = normalizeCustomerAvatarPath(user.avatar);
        const updatedUser = await userDataService.updateUser(user.id, {
            ...user,
            avatar: ''
        });

        if (previousAvatar) {
            try {
                deleteManagedFiles([previousAvatar]);
            } catch (_error) {
                /* non-blocking cleanup */
            }
        }

        const sanitizedUser = sanitizeUserForClient(updatedUser);
        const realtimeService = getRealtimeEventService();
        realtimeService.emitCustomerUpdated(user.id, sanitizedUser);
        realtimeService.emitAnalyticsUpdated({ source: 'customers', action: 'updated' });

        return res.json({
            success: true,
            message: 'Profile photo removed successfully',
            user: sanitizedUser
        });
    } catch (err) {
        authLogger.error('auth.remove_me_photo_failed', { error: err });
        return res.status(500).json({ success: false, message: 'Unable to remove profile photo' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const uid = req.user?.id;
        const { currentPassword, newPassword } = req.body || {};
        if (!uid) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new passwords are required' });
        }
        if (!isStrongPassword(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be 8+ chars with uppercase, lowercase, and number'
            });
        }

        const user = await userDataService.findUserById(uid);
        if (!user || isAdminUser(user)) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }
        if (!await comparePasswords(String(currentPassword), user.password)) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        if (String(currentPassword) === String(newPassword)) {
            return res.status(400).json({
                success: false,
                message: 'Choose a new password that is different from your current password.'
            });
        }

        await userDataService.updateUser(user.id, {
            ...user,
            password: await hashPassword(String(newPassword))
        });
        await userDataService.recordSuccessfulLogin(user.id);
        customerSessionService.revokeAllForUser(user.id, {
            exceptSessionId: req.user?.sid || '',
            reason: 'password_changed'
        });

        let sessionTokens = {};
        if (req.user?.sid) {
            const current = customerSessionService.findActiveBySessionId(req.user.sid);
            if (current) {
                const rotated = customerSessionService.rotateCustomerSession(
                    current,
                    {
                        id: user.id,
                        email: user.email,
                        phone: user.phone,
                        role: user.role || 'user'
                    },
                    { req }
                );
                sessionTokens = {
                    token: rotated.token,
                    refreshToken: rotated.refreshToken,
                    expiresIn: rotated.expiresIn
                };
            }
        }

        authLogger.info('auth.password_changed', { userId: user.id });
        return res.json({ success: true, message: 'Password updated successfully', ...sessionTokens });
    } catch (error) {
        authLogger.error('auth.change_password_failed', { error });
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
        } else {
            try {
                const [emailResult] = await notifyPasswordReset(user, otp);
                if (!emailResult?.success) {
                    throw emailResult?.error || new Error('Email delivery is unavailable');
                }
            } catch (notifyError) {
                authLogger.error('auth.forgot_password.email_failed', {
                    identifier: normalizedIdentifier,
                    error: notifyError
                });
                return res.status(503).json({ success: false, message: 'Email delivery is temporarily unavailable. Please use phone reset or try again later.' });
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
    const resetToken = issueResetToken(identifier);
    return res.json({ success: true, resetToken });
};

exports.resetPassword = async (req, res) => {
    try {
        const { identifier, newPassword, resetToken } = req.body;
        if (!identifier || !newPassword || !resetToken) {
            return res.status(400).json({ success: false, message: 'Identifier, reset token, and new password required' });
        }
        if (!verifyResetToken(identifier, resetToken)) {
            return res.status(403).json({ success: false, message: 'Invalid or expired reset token' });
        }
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
        await userDataService.recordSuccessfulLogin(user.id);
        customerSessionService.revokeAllForUser(user.id, { reason: 'password_reset' });
        authLogger.info('auth.password_reset_completed', { identifier: normalizedIdentifier, userId: user.id });
        return res.json({ success: true });
    } catch (error) {
        authLogger.error('auth.password_reset_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteAccount = async (req, res) => {
    try {
        const uid = req.user?.id;
        const { password, confirmation } = req.body || {};
        if (!uid) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        if (!password) {
            return res.status(400).json({ success: false, message: 'Enter your password to confirm account deletion.' });
        }
        if (String(confirmation || '').trim().toUpperCase() !== 'DELETE') {
            return res.status(400).json({
                success: false,
                message: 'Type DELETE to confirm that you understand this cannot be undone.'
            });
        }

        const user = await userDataService.findUserById(uid);
        if (!user || isAdminUser(user)) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        if (String(user.status || 'active').toLowerCase() === 'blocked') {
            return res.status(403).json({ success: false, message: 'Account blocked' });
        }
        if (!await comparePasswords(String(password), user.password)) {
            return res.status(401).json({ success: false, message: 'Password is incorrect' });
        }

        // Orders remain (orders.user_id SET NULL). Revoke sessions before deleting the login identity.
        customerSessionService.revokeAllForUser(user.id, { reason: 'account_deleted' });

        const avatarPath = normalizeCustomerAvatarPath(user.avatar || user.photo || '');
        if (avatarPath) {
            try {
                deleteManagedFiles([avatarPath]);
            } catch (_error) {
                /* best-effort cleanup */
            }
        }

        await userDataService.deleteUser(user.id);
        authLogger.info('auth.account_deleted', { userId: user.id });
        return res.json({
            success: true,
            message: 'Your account has been deleted. Past orders and invoices remain on file for business records.'
        });
    } catch (error) {
        authLogger.error('auth.delete_account_failed', { error });
        return res.status(500).json({ success: false, message: 'Unable to delete account right now.' });
    }
};