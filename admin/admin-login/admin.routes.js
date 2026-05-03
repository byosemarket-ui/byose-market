// 📦 Dependencies
const express = require("express");
const router = express.Router();

// 📥 Controller
const { loginAdmin } = require("./admin.controller");

// 🧠 Middleware (optional future use)
const { validateLoginInput } = require("./auth.middleware");

// 🚀 ROUTES

// 🔐 Admin Login
router.post(
  "/login",
  validateLoginInput, // ✔ validation middleware
  loginAdmin          // ✔ controller logic
);

// 📤 Export
module.exports = router;