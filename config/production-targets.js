/**
 * Shared deployment targets for VPS + legacy Render fallback.
 * VPS: 153.75.227.160 (InterServer KVM509)
 */
const VPS = {
  id: "vps3407735",
  host: "153.75.227.160",
  deployRoot: "/var/www/byosemarket",
  sqlitePath: "/var/www/byosemarket/server/database/byosemarket.sqlite",
  uploadsRoot: "/var/www/byosemarket/server/uploads",
  publicUploadsPath: "/uploads",
  apiPort: 5000
};

const LEGACY_RENDER_ORIGIN = "https://byosesemarket4.onrender.com";

const PRODUCTION_CORS_ORIGINS = [
  "https://byosemarket.com",
  "https://www.byosemarket.com",
  "http://153.75.227.160",
  "https://153.75.227.160",
  "http://153.75.227.160:5000",
  LEGACY_RENDER_ORIGIN
];

module.exports = {
  VPS,
  LEGACY_RENDER_ORIGIN,
  PRODUCTION_CORS_ORIGINS
};
