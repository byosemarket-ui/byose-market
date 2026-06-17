/**
 * Shared deployment targets for VPS + legacy Render fallback.
 * VPS: 153.75.227.160 (InterServer KVM509)
 */
const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";
const PRODUCTION_API_BASE_URL = "https://byosemarket.com/api";

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
  PRODUCTION_SITE_ORIGIN,
  "https://www.byosemarket.com",
  "http://153.75.227.160",
  "https://153.75.227.160",
  "http://153.75.227.160:5000",
  LEGACY_RENDER_ORIGIN
];

module.exports = {
  PRODUCTION_SITE_ORIGIN,
  PRODUCTION_API_BASE_URL,
  VPS,
  LEGACY_RENDER_ORIGIN,
  PRODUCTION_CORS_ORIGINS
};
