// 🧠 Validate login input
exports.validateLoginInput = (req, res, next) => {
  const { email, password } = req.body;

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

  // ✔ Pass to next step
  next();
};