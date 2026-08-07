const bcrypt = require("bcryptjs");
const requireAdminAuth = require("../../server/middleware/requireadminauth");
const userDataService = require("../../server/services/userdataservice");
const adminProfileService = require("../../server/services/adminprofileservice");
const adminSecurityService = require("../../server/services/adminsecurityservice");
const { generateToken, getJwtConfig } = require("../../server/utils/token");
const { appLogger, monitorAsyncOperation } = require("../../server/utils/logger");
const crypto = require("crypto");
const { parseUserAgent } = require("../../server/utils/useragent");
const { setRuntimeAdminPasswordHash } = require("../../server/utils/adminpassword");

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

function getClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || "unknown";
}

function detectDevice(userAgent) {
  const parsed = parseUserAgent(userAgent);
  return parsed.deviceName || "Web browser";
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

async function recordSuccessfulAdminLogin(req, adminPayload, logger, options = {}) {
  const sessionId = options.sessionId || `sess_${crypto.randomBytes(16).toString("hex")}`;
  try {
    const result = await adminSecurityService.createLoginSession(adminPayload, req, {
      sessionId,
      deviceFingerprint: options.deviceFingerprint || "",
      deviceName: options.deviceName || "",
      expiresAt: options.expiresAt || null,
      tokenFingerprint: options.tokenFingerprint || "",
      meta: options.meta || {}
    });
    logger.info("auth.admin.login_history_recorded", {
      adminId: adminPayload.id,
      sessionId: result.sessionId
    });
    return result;
  } catch (error) {
    logger.warn("auth.admin.login_history_failed", {
      adminId: adminPayload.id,
      error
    });
    return null;
  }
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

    const tokenPayload = {
      id: buildAdminUserId(adminEmail),
      email: adminEmail,
      role: "admin"
    };

    const userFound = enteredEmail === adminEmail;
    let passwordMatch = false;
    let authSource = 'env';

    if (userFound) {
      passwordMatch = await bcrypt.compare(String(password), adminPasswordHash);
      if (!passwordMatch) {
        try {
          const dbAdmin = await userDataService.findUserById(tokenPayload.id);
          if (dbAdmin?.password && await bcrypt.compare(String(password), dbAdmin.password)) {
            passwordMatch = true;
            authSource = 'database';
            try {
              setRuntimeAdminPasswordHash(dbAdmin.password);
            } catch (_error) {
              // Keep login success even if runtime env sync fails.
            }
          }
        } catch (_error) {
          // Fall through to invalid credentials.
        }
      }
    }

    if (!userFound || !passwordMatch) {
      recordFailedAttempt(clientId);
      logger.warn('auth.admin.login_failed', {
        adminEmail: enteredEmail,
        attemptCount: loginAttempts.get(clientId)?.count || 0,
        reason: !userFound ? 'user_not_found' : 'password_mismatch'
      });

      void adminSecurityService.recordFailedLogin({
        id: buildAdminUserId(adminEmail || enteredEmail),
        email: enteredEmail
      }, req, {
        reason: !userFound ? 'user_not_found' : 'password_mismatch',
        deviceFingerprint: String(req.body?.deviceFingerprint || "").trim()
      }).catch(() => {});

      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    clearFailedAttempts(clientId);
    logger.info('auth.admin.login_succeeded', {
      adminId: tokenPayload.id,
      adminEmail: tokenPayload.email,
      authSource
    });

    let sessionProfile = {
      id: tokenPayload.id,
      email: tokenPayload.email,
      role: tokenPayload.role
    };
    let loginSessionId = `sess_${crypto.randomBytes(16).toString("hex")}`;
    let tokenOptions = { expiresIn: jwtConfig?.expiresIn || "7d" };
    let sessionPolicyMeta = null;

    try {
      tokenOptions = await adminSecurityService.resolveLoginTokenOptions();
      sessionPolicyMeta = {
        sessionDurationHours: tokenOptions.sessionDurationHours,
        idleTimeoutHours: tokenOptions.idleTimeoutHours,
        sessionDurationMs: tokenOptions.sessionDurationMs,
        idleTimeoutMs: tokenOptions.idleTimeoutMs
      };
    } catch (_error) {
      tokenOptions = { expiresIn: jwtConfig?.expiresIn || "7d" };
    }

    const token = generateToken({
      id: tokenPayload.id,
      email: tokenPayload.email,
      role: tokenPayload.role,
      sid: loginSessionId
    }, { expiresIn: tokenOptions.expiresIn });

    const encodedPayload = String(token).split('.')[1] || '';
    const decodedToken = Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    let expiresAt = null;

    try {
      const parsed = JSON.parse(decodedToken);
      if (parsed && Number.isFinite(parsed.exp)) {
        expiresAt = new Date(parsed.exp * 1000).toISOString();
      }
    } catch (_error) {}

    try {
      await syncAdminUserRecord(adminEmail, adminPasswordHash, logger.child({ scope: 'admin_bootstrap' }));
      const loginRecord = await recordSuccessfulAdminLogin(req, tokenPayload, logger, {
        sessionId: loginSessionId,
        deviceFingerprint: String(req.body?.deviceFingerprint || "").trim(),
        deviceName: String(req.body?.deviceName || "").trim() || detectDevice(req.headers["user-agent"]),
        expiresAt,
        tokenFingerprint: adminSecurityService.tokenFingerprint(token),
        meta: {
          trustDevice: Boolean(req.body?.trustDevice)
        }
      });
      loginSessionId = String(loginRecord?.sessionId || loginSessionId);
      if (loginRecord?.user) {
        sessionProfile = adminProfileService.getPublicSessionProfile(loginRecord.user);
      }

      if (req.body?.trustDevice && String(req.body?.deviceFingerprint || "").trim()) {
        await adminSecurityService.trustCurrentDevice(tokenPayload, req, {
          deviceFingerprint: String(req.body.deviceFingerprint || "").trim(),
          deviceName: String(req.body?.deviceName || "").trim()
        });
      }
    } catch (error) {
      logger.warn('auth.admin.bootstrap_sync_failed', {
        adminEmail,
        error
      });
    }

    logger.info('auth.admin.login_token_issued', {
      adminId: tokenPayload.id,
      adminEmail: tokenPayload.email,
      expiresAt: expiresAt || '',
      sessionId: loginSessionId,
      jwtSecretSource: jwtConfig ? jwtConfig.secretSource : 'unknown'
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin: sessionProfile,
      sessionId: loginSessionId || undefined,
      expiresAt,
      sessionPolicy: sessionPolicyMeta || undefined
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

exports.getAdminSession = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const logger = req.log || appLogger;

  let adminProfile = {
    id: req.admin.id,
    email: req.admin.email,
    role: req.admin.role
  };

  try {
    const user = await adminProfileService.ensureAdminUser(req.admin);
    adminProfile = adminProfileService.getPublicSessionProfile(user);
  } catch (error) {
    logger.warn('auth.admin.session_profile_enrich_failed', {
      adminId: req.admin.id,
      error
    });
  }

  logger.info('auth.admin.session_valid', {
    adminId: adminProfile.id,
    adminEmail: adminProfile.email,
    role: adminProfile.role
  });

  return res.status(200).json({
    success: true,
    admin: adminProfile
  });
};