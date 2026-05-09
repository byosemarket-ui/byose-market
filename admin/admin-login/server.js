// 📦 Load env from the backend configuration
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "backend", ".env") });

// 📥 Import app
const app = require("./app");

// ⚙️ CONFIG
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// 🚀 START SERVER
app.listen(PORT, HOST, () => {
  if (process.env.NODE_ENV !== "production") {
    console.info(`Admin login helper running on http://${HOST}:${PORT}`);
  }
});