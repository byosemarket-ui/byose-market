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
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "byosemarket@gmail.com";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";

    // 🔍 5. Compare submitted credentials against backend env values
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
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