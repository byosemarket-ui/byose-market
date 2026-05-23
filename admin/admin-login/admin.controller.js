const bcrypt = require("bcryptjs");
const requireAdminAuth = require("../../server/middleware/requireadminauth");
const userDataService = require("../../server/services/userdataservice");
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

async function syncAdminUserRecord(adminEmail, adminPasswordHash, logger) {
  await monitorAsyncOperation(logger, "database.admin.upsert", { adminEmail }, () => userDataService.upsertAdminUser({
    publicId: buildAdminUserId(adminEmail),
    email: adminEmail,
    passwordHash: adminPasswordHash,
    name: "Administrator"
  }), { slowThresholdMs: 500 });
  logger.info("auth.admin.bootstrap_synced", { adminEmail });
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

    const userFound = enteredEmail === adminEmail;
    const passwordMatch = userFound
      ? await bcrypt.compare(String(password), adminPasswordHash)
      : false;
    const tokenPayload = {
      id: buildAdminUserId(adminEmail),
      email: adminEmail,
      role: "admin"
    };

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
      authSource: 'env'
    });

    void syncAdminUserRecord(adminEmail, adminPasswordHash, logger.child({ scope: 'admin_bootstrap' }))
      .catch((error) => {
        logger.warn('auth.admin.bootstrap_sync_failed', {
          adminEmail,
          error
        });
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