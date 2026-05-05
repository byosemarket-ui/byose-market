const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const connectDB = require("../../backend/config/db");
const Admin = require("../../backend/models/Admin");

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

let inMemoryAdmin = null;
const loginAttempts = new Map();

// Cache for hashing plaintext ADMIN_PASSWORD once at runtime
let _cachedPlainPassword = null;
let _cachedPasswordHash = null;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function looksLikeBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(value || ""));
}

/**
 * Resolve admin password hash from env.
 * Prefers ADMIN_PASSWORD_HASH (bcrypt). Falls back to ADMIN_PASSWORD (plaintext),
 * which is hashed with bcrypt once and cached for the process lifetime.
 */
function resolvePasswordHash() {
  const stored = String(process.env.ADMIN_PASSWORD_HASH || "").trim();
  if (looksLikeBcryptHash(stored)) return stored;

  const plain = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!plain) return "";

  if (_cachedPlainPassword !== plain || !_cachedPasswordHash) {
    _cachedPasswordHash = bcrypt.hashSync(plain, 10);
    _cachedPlainPassword = plain;
    console.log("[ADMIN] Password hash computed from ADMIN_PASSWORD env var");
  }
  return _cachedPasswordHash;
}

function getAdminConfig() {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const adminPasswordHash = resolvePasswordHash();
  const jwtSecret = String(
    process.env.JWT_SECRET || "byose_market_default_jwt_secret_change_me_in_production"
  ).trim();

  if (!process.env.JWT_SECRET) {
    console.warn("[ADMIN] WARNING: JWT_SECRET env var is not set. Using fallback. Set JWT_SECRET in Render dashboard for production security.");
  }
  if (!process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD) {
    console.log("[ADMIN] Using ADMIN_PASSWORD (plaintext) — consider switching to ADMIN_PASSWORD_HASH in production.");
  }

  return {
    adminEmail,
    adminPasswordHash,
    jwtSecret,
    isConfigured: Boolean(adminEmail && looksLikeBcryptHash(adminPasswordHash) && jwtSecret)
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
    console.warn("Admin auth DB connection unavailable, using in-memory fallback:", error.message);
    return false;
  }
}

async function ensureAdminUser(adminEmail, adminPasswordHash) {
  inMemoryAdmin = {
    id: "in-memory-admin",
    email: adminEmail,
    password: adminPasswordHash
  };

  const dbConnected = await ensureDatabaseConnection();
  if (!dbConnected) {
    return { source: "memory", admin: inMemoryAdmin };
  }

  let admin = await Admin.findOne({ email: adminEmail });

  if (!admin) {
    admin = new Admin({
      email: adminEmail,
      password: adminPasswordHash
    });
    await admin.save();
    console.log("Admin bootstrap: created admin user in database");
    return { source: "database", admin };
  }

  if (String(admin.password || "") !== adminPasswordHash) {
    admin.password = adminPasswordHash;
    await admin.save();
    console.log("Admin bootstrap: updated admin password hash in database");
  }

  return { source: "database", admin };
}

exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const enteredEmail = normalizeEmail(email);
    const clientId = getClientIdentifier(req, enteredEmail);

    if (isRateLimited(clientId)) {
      return res.status(429).json({
        success: false,
        message: "Too many login attempts. Please try again later."
      });
    }

    if (!isValidEmail(enteredEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    console.log("[ADMIN LOGIN DEBUG] enteredEmail:", enteredEmail);

    const { adminEmail, adminPasswordHash, jwtSecret, isConfigured } = getAdminConfig();
    if (!isConfigured) {
      return res.status(500).json({
        success: false,
        message: "Server auth misconfigured. Missing ADMIN_EMAIL, ADMIN_PASSWORD_HASH, or JWT_SECRET."
      });
    }

    const bootstrapResult = await ensureAdminUser(adminEmail, adminPasswordHash);

    let userFound = false;
    const passwordMatch = await bcrypt.compare(String(password), adminPasswordHash);
    let tokenPayload = null;

    if (bootstrapResult.source === "database") {
      const admin = await Admin.findOne({ email: adminEmail });
      userFound = enteredEmail === adminEmail && Boolean(admin);
      if (admin) {
        tokenPayload = {
          id: String(admin._id),
          email: admin.email,
          role: "admin"
        };
      }
    } else {
      userFound = enteredEmail === adminEmail && enteredEmail === inMemoryAdmin.email;
      if (userFound) {
        tokenPayload = {
          id: inMemoryAdmin.id,
          email: inMemoryAdmin.email,
          role: "admin"
        };
      }
    }

    console.log("[ADMIN LOGIN DEBUG] userFound:", userFound);
    console.log("[ADMIN LOGIN DEBUG] passwordMatch:", passwordMatch);

    if (!userFound || !passwordMatch) {
      recordFailedAttempt(clientId);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    clearFailedAttempts(clientId);

    const token = jwt.sign({ role: "admin" }, jwtSecret, { expiresIn: "1d" });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: tokenPayload.id,
        email: tokenPayload.email,
        role: tokenPayload.role
      }
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};