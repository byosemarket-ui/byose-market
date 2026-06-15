#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/var/www/byosemarket}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/byosemarket}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled/byosemarket}"
API_PORT="${API_PORT:-5000}"

echo "[setup-vps-proxy] Deploy root: ${DEPLOY_ROOT}"

if [[ ! -d "${DEPLOY_ROOT}" ]]; then
  echo "[setup-vps-proxy] ERROR: ${DEPLOY_ROOT} does not exist."
  exit 1
fi

cd "${DEPLOY_ROOT}"

if ! command -v nginx >/dev/null 2>&1; then
  echo "[setup-vps-proxy] Installing nginx..."
  apt-get update
  apt-get install -y nginx
fi

echo "[setup-vps-proxy] Installing nginx site config..."
install -m 644 "${DEPLOY_ROOT}/deploy/nginx-byosemarket.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"

if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

echo "[setup-vps-proxy] Testing nginx configuration..."
nginx -t

echo "[setup-vps-proxy] Reloading nginx..."
systemctl enable nginx
systemctl reload nginx

if command -v pm2 >/dev/null 2>&1; then
  echo "[setup-vps-proxy] Ensuring PM2 API process is running..."
  pm2 start ecosystem.config.js --env production || pm2 reload ecosystem.config.js --env production
  pm2 save
else
  echo "[setup-vps-proxy] WARNING: pm2 not found. Start the API manually:"
  echo "  cd ${DEPLOY_ROOT} && npm run pm2:start"
fi

echo "[setup-vps-proxy] Verifying local API health..."
curl -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null
curl -fsS "http://127.0.0.1/healthz" >/dev/null
curl -fsS "http://127.0.0.1/api/products?limit=1" >/dev/null

echo "[setup-vps-proxy] PASS - nginx proxies /api and /uploads to port ${API_PORT}"
