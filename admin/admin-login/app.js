// 📦 Core dependencies
const express = require("express");
const cors = require("cors");

// 📥 Routes
const adminRoutes = require("./admin.routes");

// ⚙️ Create app
const app = express();

// 🌐 MIDDLEWARES

// 🔐 CORS - Allow all origins for production compatibility
const corsOptions = {
  origin: "*",
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// 🧠 Parse JSON
app.use(express.json());

// 🧾 Parse form data
app.use(express.urlencoded({ extended: true }));

// 🚦 REQUEST LOGGER (for debugging)
app.use((req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`📨 ${req.method} ${req.url} | body: ${JSON.stringify(req.body)}`);
  } else {
    console.log(`📨 ${req.method} ${req.url}`);
  }
  next();
});

// 🏠 ROOT ROUTE
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Byose Market Admin API is running 🚀"
  });
});

// ❤️ HEALTH CHECK (important for hosting)
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// 🔗 API ROUTES
app.use("/api/admin", adminRoutes);

// ❌ 404 HANDLER
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// 🚨 GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("Global Error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

// 📤 Export app
module.exports = app;