/**
 * Shared deployment targets for VPS + legacy Render fallback.
 * VPS: 153.75.227.160 (InterServer KVM509)
 * GitHub: https://github.com/byosemarket-ui/byose-market
 */
const PRODUCTION_SITE_ORIGIN = "https://byosemarket.com";
const PRODUCTION_API_BASE_URL = "https://byosemarket.com/api";
const GITHUB_REPO_URL = "https://github.com/byosemarket-ui/byose-market.git";
const GITHUB_REPO_SLUG = "byosemarket-ui/byose-market";

const VPS = {
  id: "vps3407735",
  host: "153.75.227.160",
  // Preferred clone path for the new repository. Deploy scripts may fall back to
  // the legacy path if the VPS has not been renamed yet.
  deployRoot: "/root/byose-market",
  legacyDeployRoot: "/root/BYOSESEMARKET4",
  webRoot: "/var/www/byosemarket",
  sqlitePath: "/root/byose-market/server/database/byosemarket.sqlite",
  // Persistent uploads outside /root so nginx (www-data) can read files via alias.
  uploadsRoot: "/var/lib/byosemarket/uploads",
  legacyUploadsRoots: [
    "/root/byose-market/server/uploads",
    "/root/BYOSESEMARKET4/server/uploads"
  ],
  publicUploadsPath: "/uploads",
  apiPort: 5000
};

const LEGACY_RENDER_ORIGIN = "https://byosesemarket4.onrender.com";

const PRODUCTION_CORS_ORIGINS = [
  PRODUCTION_SITE_ORIGIN,
  "https://www.byosemarket.com",
  "http://153.75.227.160",
  "https://153.75.227.160",
  "http://153.75.227.160:5000"
];

module.exports = {
  PRODUCTION_SITE_ORIGIN,
  PRODUCTION_API_BASE_URL,
  GITHUB_REPO_URL,
  GITHUB_REPO_SLUG,
  VPS,
  LEGACY_RENDER_ORIGIN,
  PRODUCTION_CORS_ORIGINS
};
