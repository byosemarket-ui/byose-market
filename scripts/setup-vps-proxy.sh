#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/root/BYOSESEMARKET4}"
API_PORT="${API_PORT:-5000}"

echo "[setup-vps-proxy] API repo: ${DEPLOY_DIR}"

if [[ ! -d "${DEPLOY_DIR}" ]]; then
  echo "[setup-vps-proxy] ERROR: ${DEPLOY_DIR} does not exist."
  exit 1
fi

cd "${DEPLOY_DIR}"

if ! command -v nginx >/dev/null 2>&1; then
  echo "[setup-vps-proxy] Installing nginx..."
  apt-get update
  apt-get install -y nginx
fi

echo "[setup-vps-proxy] Configuring nginx upload serving..."
bash "${DEPLOY_DIR}/scripts/fix-vps-uploads-serving.sh"

if command -v pm2 >/dev/null 2>&1; then
  echo "[setup-vps-proxy] Ensuring PM2 API process is running..."
  pm2 start ecosystem.config.js --env production || pm2 reload ecosystem.config.js --env production
  pm2 save
else
  echo "[setup-vps-proxy] WARNING: pm2 not found. Start the API manually:"
  echo "  cd ${DEPLOY_DIR} && npm run pm2:start"
fi

echo "[setup-vps-proxy] Verifying local API health..."
curl -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null
curl -fsS "http://127.0.0.1/healthz" >/dev/null
curl -fsS "http://127.0.0.1:${API_PORT}/api/products?limit=1" >/dev/null
curl -fsS "http://127.0.0.1/api/products?limit=1" >/dev/null

echo "[setup-vps-proxy] PASS - nginx serves /uploads from disk and proxies /api to port ${API_PORT}"
