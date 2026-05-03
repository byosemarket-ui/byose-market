// 📦 Load dependencies
const crypto = require("crypto");

// 🔐 Helper: safe string compare (avoid timing attacks)
function safeCompare(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

// 🧠 Helper: validate email format
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 🚀 ADMIN LOGIN CONTROLLER
exports.loginAdmin = (req, res) => {
  try {
    const { email, password } = req.body;

    // 🛑 1. Check missing fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // 🛑 2. Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    // 🔐 3. Get admin credentials from env
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

    // 🛑 4. Check if env is configured
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error"
      });
    }

    // 🔍 5. Compare safely
    const isEmailMatch = safeCompare(email, ADMIN_EMAIL);
    const isPasswordMatch = safeCompare(password, ADMIN_PASSWORD);

    if (!isEmailMatch || !isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // 🎯 6. SUCCESS
    return res.status(200).json({
      success: true,
      message: "Login successful"
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};