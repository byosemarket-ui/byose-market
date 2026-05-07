// 📦 Dependencies
const express = require("express");
const router = express.Router();

// 📥 Controller
const { loginAdmin, getAdminSession, requireAdminAuth } = require("./admin.controller");
const requireDatabase = require("../../server/middleware/requiredatabase");

// 🧠 Middleware (optional future use)
const { validateLoginInput } = require("./auth.middleware");

// 🚀 ROUTES

// 🔐 Admin Login
router.post(
  "/login",
  requireDatabase,
  validateLoginInput, // ✔ validation middleware
  loginAdmin          // ✔ controller logic
);

router.get("/session", requireAdminAuth, getAdminSession);

// 📤 Export
module.exports = router;