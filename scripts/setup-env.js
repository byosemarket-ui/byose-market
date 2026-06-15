const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, ".env.example");
const targetPath = path.join(projectRoot, ".env");

if (fs.existsSync(targetPath)) {
  console.log(".env already exists. No changes made.");
  process.exit(0);
}

if (!fs.existsSync(sourcePath)) {
  console.error(".env.example was not found.");
  process.exit(1);
}

fs.copyFileSync(sourcePath, targetPath);
console.log("Created .env from .env.example.");
console.log("Next steps:");
console.log("1. Set ADMIN_PASSWORD_HASH to a bcrypt hash of your admin password.");
console.log("2. Set JWT_SECRET to a long random string.");
console.log("3. Run: npm run dev");
