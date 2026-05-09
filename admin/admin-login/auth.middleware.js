// 🧠 Validate login input
exports.validateLoginInput = (req, res, next) => {
  const { email, password } = req.body || {};

  // ❌ Empty fields
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required"
    });
  }

  // ❌ Basic email check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Invalid email format"
    });
  }

  if (String(password).length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters"
    });
  }

  if (Buffer.byteLength(JSON.stringify(req.body || {})) > 10000) {
    return res.status(413).json({
      success: false,
      message: "Request payload too large"
    });
  }

  // ✔ Pass to next step
  next();
};