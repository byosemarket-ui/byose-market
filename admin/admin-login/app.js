// 📦 Core dependencies
const express = require("express");
const cors = require("cors");

// 📥 Routes
const adminRoutes = require("./admin.routes");

// ⚙️ Create app
const app = express();

// 🌐 MIDDLEWARES

// 🔐 CORS - Allow local and production domains
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
      'https://byosemarket.com',
      'https://www.byosemarket.com'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
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