const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const connectDB = require("../../server/config/db");
const User = require("../../server/models/user");
const requireAdminAuth = require("../../server/middleware/requireadminauth");
const { generateToken, getJwtConfig } = require("../../server/utils/token");
const { appLogger, monitorAsyncOperation } = require("../../server/utils/logger");

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

const loginAttempts = new Map();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function looksLikeBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value || ""));
}

function buildAdminUserId(adminEmail) {
  return `ADMIN_${Buffer.from(String(adminEmail || "").trim().toLowerCase()).toString("hex").slice(0, 16)}`;
}

function getAdminConfig() {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim();
  let jwtConfig = null;

  try {
    jwtConfig = getJwtConfig();
  } catch (_error) {
    jwtConfig = null;
  }

  return {
    adminEmail,
    adminPasswordHash,
    jwtConfig,
    isConfigured: Boolean(adminEmail && looksLikeBcryptHash(adminPasswordHash) && jwtConfig && jwtConfig.secret)
  };
}

function getClientIdentifier(req, email) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwardedFor || req.ip || req.socket?.remoteAddress || "unknown";
  return `${ip}:${normalizeEmail(email)}`;
}

function isRateLimited(clientId) {
  const now = Date.now();
  const entry = loginAttempts.get(clientId);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    loginAttempts.delete(clientId);
    return false;
  }
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(clientId) {
  const now = Date.now();
  const entry = loginAttempts.get(clientId);
  if (!entry || entry.expiresAt <= now) {
    loginAttempts.set(clientId, { count: 1, expiresAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count += 1;
  loginAttempts.set(clientId, entry);
}

function clearFailedAttempts(clientId) {
  loginAttempts.delete(clientId);
}

async function ensureDatabaseConnection() {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  try {
    await connectDB();
    return true;
  } catch (error) {
    appLogger.warn("auth.admin.db_unavailable", { message: error.message });
    return false;
  }
}

async function ensureAdminUser(adminEmail, adminPasswordHash) {
  const dbConnected = await ensureDatabaseConnection();
  if (!dbConnected) {
    throw new Error('Admin authentication unavailable while database is disconnected');
  }

  let admin = await monitorAsyncOperation(appLogger, 'database.admin.find_one', { adminEmail }, () => User.findOne({ email: adminEmail, role: 'admin' }), { slowThresholdMs: 500 });

  if (!admin) {
    admin = new User({
      id: buildAdminUserId(adminEmail),
      name: 'Administrator',
      email: adminEmail,
      password: adminPasswordHash,
      role: 'admin',
      verified: true,
      status: 'active'
    });
    await monitorAsyncOperation(appLogger, 'database.admin.create', { adminEmail }, () => admin.save(), { slowThresholdMs: 500 });
    appLogger.info("auth.admin.bootstrap_created", { adminEmail });
    return { source: "database", admin };
  }

  if (String(admin.password || "") !== adminPasswordHash) {
    admin.password = adminPasswordHash;
    await monitorAsyncOperation(appLogger, 'database.admin.update_password_hash', { adminEmail }, () => admin.save(), { slowThresholdMs: 500 });
    appLogger.info("auth.admin.bootstrap_password_hash_updated", { adminEmail });
  }

  return { source: "database", admin };
}

exports.loginAdmin = async (req, res) => {
  const logger = (req.log || appLogger).child({ scope: 'admin_login' });
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      logger.warn('auth.admin.login_input_missing');
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const enteredEmail = normalizeEmail(email);
    const clientId = getClientIdentifier(req, enteredEmail);
    logger.info('auth.admin.login_attempt', { adminEmail: enteredEmail });

    if (isRateLimited(clientId)) {
      logger.warn('auth.admin.login_rate_limited', { adminEmail: enteredEmail, clientId });
      return res.status(429).json({
        success: false,
        message: "Too many login attempts. Please try again later."
      });
    }

    if (!isValidEmail(enteredEmail)) {
      logger.warn('auth.admin.login_invalid_email', { adminEmail: enteredEmail });
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    const { adminEmail, adminPasswordHash, isConfigured, jwtConfig } = getAdminConfig();
    if (!isConfigured) {
      logger.error('auth.admin.login_misconfigured', {
        adminEmail: enteredEmail,
        hasAdminEmail: Boolean(adminEmail),
        hasPasswordHash: Boolean(adminPasswordHash),
        jwtSecretSource: jwtConfig ? jwtConfig.secretSource : 'missing'
      });
      return res.status(500).json({
        success: false,
        message: "Server auth misconfigured. Missing ADMIN_EMAIL, ADMIN_PASSWORD_HASH, or JWT_SECRET."
      });
    }

    const bootstrapResult = await ensureAdminUser(adminEmail, adminPasswordHash);

    let userFound = false;
    let passwordMatch = false;
    let tokenPayload = null;

    const admin = await monitorAsyncOperation(logger, 'database.admin.login_lookup', { adminEmail }, () => User.findOne({ email: adminEmail, role: 'admin' }), { slowThresholdMs: 500 });
    userFound = enteredEmail === adminEmail && Boolean(admin);
    if (admin) {
      passwordMatch = await bcrypt.compare(String(password), String(admin.password || adminPasswordHash));
      tokenPayload = {
        id: String(admin.id || admin._id),
        email: admin.email,
        role: "admin"
      };
    }

    if (!userFound || !passwordMatch) {
      recordFailedAttempt(clientId);
      logger.warn('auth.admin.login_failed', {
        adminEmail: enteredEmail,
        attemptCount: loginAttempts.get(clientId)?.count || 0,
        reason: !userFound ? 'user_not_found' : 'password_mismatch'
      });
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    clearFailedAttempts(clientId);
    logger.info('auth.admin.login_succeeded', {
      adminId: tokenPayload.id,
      adminEmail: tokenPayload.email,
      authSource: bootstrapResult.source
    });

    const token = generateToken({
      id: tokenPayload.id,
      email: tokenPayload.email,
      role: tokenPayload.role
    });

    const encodedPayload = String(token).split('.')[1] || '';
    const decodedToken = Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    let expiresAt = null;

    try {
      const parsed = JSON.parse(decodedToken);
      if (parsed && Number.isFinite(parsed.exp)) {
        expiresAt = new Date(parsed.exp * 1000).toISOString();
      }
    } catch (_error) {}

    logger.info('auth.admin.login_token_issued', {
      adminId: tokenPayload.id,
      adminEmail: tokenPayload.email,
      expiresAt: expiresAt || '',
      jwtSecretSource: jwtConfig ? jwtConfig.secretSource : 'unknown'
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: tokenPayload.id,
        email: tokenPayload.email,
        role: tokenPayload.role
      },
      expiresAt
    });
  } catch (error) {
    logger.error('auth.admin.login_error', { error });

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

exports.requireAdminAuth = requireAdminAuth;

exports.getAdminSession = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  (req.log || appLogger).info('auth.admin.session_valid', {
    adminId: req.admin.id,
    adminEmail: req.admin.email,
    role: req.admin.role
  });
  return res.status(200).json({
    success: true,
    admin: {
      id: req.admin.id,
      email: req.admin.email,
      role: req.admin.role
    }
  });
};