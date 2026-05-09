// 📦 Dependencies
const express = require("express");
const router = express.Router();

// 📥 Controller
const { loginAdmin, getAdminSession, requireAdminAuth } = require("./admin.controller");
const requireDatabase = require("../../server/middleware/requiredatabase");
const { createRateLimiter } = require("../../server/middleware/ratelimiter");

// 🧠 Middleware (optional future use)
const { validateLoginInput } = require("./auth.middleware");

const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  code: "ADMIN_LOGIN_RATE_LIMITED",
  message: "Too many admin login attempts. Please try again later."
});

const adminSessionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 80,
  code: "ADMIN_SESSION_RATE_LIMITED",
  message: "Too many admin session requests. Please retry shortly."
});

// 🚀 ROUTES

// 🔐 Admin Login
router.post(
  "/login",
  adminLoginLimiter,
  requireDatabase,
  validateLoginInput, // ✔ validation middleware
  loginAdmin          // ✔ controller logic
);

router.get("/session", adminSessionLimiter, requireAdminAuth, getAdminSession);

// 📤 Export
module.exports = router;