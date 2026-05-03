// 📦 Load env from this folder explicitly
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// 📥 Import app
const app = require("./app");

// ⚙️ CONFIG
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// 🚀 START SERVER
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});