#!/usr/bin/env bash
#
# Production deployment script for the Byose Market VPS.
# Invoked by GitHub Actions after git fetch/reset, or manually on the server.
#
# Environment overrides (optional):
#   DEPLOY_DIR        - repository path on the VPS (default: /root/BYOSESEMARKET4)
#   DEPLOY_BRANCH     - branch to deploy (default: main)
#   PM2_APP_NAME      - PM2 process name (default: byosemarket-api)
#   API_PORT          - API port for health checks (default: 5000)
#   VPS_HEALTH_HOST   - preferred health-check host (default: 127.0.0.1)
#   VPS_PUBLIC_HOST   - fallback health-check host (default: 153.75.227.160)
#   HEALTH_URL        - explicit health URL override (skips built-in candidates)
#
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/root/BYOSESEMARKET4}"
WEB_ROOT="${WEB_ROOT:-/var/www/byosemarket}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-byosemarket-api}"
API_PORT="${API_PORT:-5000}"
VPS_HEALTH_HOST="${VPS_HEALTH_HOST:-127.0.0.1}"
VPS_PUBLIC_HOST="${VPS_PUBLIC_HOST:-153.75.227.160}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_INTERVAL_SEC="${HEALTH_INTERVAL_SEC:-5}"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required command not found: $1"
  fi
}

build_health_url() {
  local host="$1"
  printf 'http://%s:%s/healthz' "${host}" "${API_PORT}"
}

# Returns 0 only when the endpoint responds with HTTP 200 and JSON containing "status".
verify_health_endpoint() {
  local url="$1"
  local body_file http_code

  body_file="$(mktemp)"

  http_code="$(curl -sS -o "${body_file}" -w "%{http_code}" --max-time 10 "${url}" || printf '000')"
  if [[ "${http_code}" != "200" ]]; then
    log "Health probe failed for ${url} (HTTP ${http_code})."
    rm -f "${body_file}"
    return 1
  fi

  if node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) process.exit(1);
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
      process.exit(1);
    }
    process.stdout.write(String(payload.status));
  " "${body_file}" >/dev/null; then
    rm -f "${body_file}"
    log "Health probe passed for ${url} (HTTP 200, valid JSON)."
    return 0
  fi

  rm -f "${body_file}"
  return 1
}

sync_storefront_static() {
  if [[ ! -d "${WEB_ROOT}" ]]; then
    log "WEB_ROOT ${WEB_ROOT} not found; skipping storefront static sync."
    return 0
  fi

  if ! command -v rsync >/dev/null 2>&1; then
    fail "rsync is required to publish storefront files to ${WEB_ROOT}"
  fi

  log "Syncing storefront static assets to ${WEB_ROOT}..."

  local dirs=(
    css
    js
    services
    details
    config
    shared
    img
    components
    orders
    account
    admin
    logout
  )

  local files=(
    index.html
    shop.html
    cart.html
    search.html
    contact.html
    login.html
    signup.html
    forgot-password.html
    verify-code.html
    reset-password.html
    product-details1.html
    product-details.html
    product-details2.html
    checkout.html
    products.html
    order-success.html
    shop.css
    mobile-nav.css
    contact.css
    contact-desktop.css
    index.js
    script.js
    shop.js
    cart.js
  )

  for dir in "${dirs[@]}"; do
    if [[ -d "${DEPLOY_DIR}/${dir}" ]]; then
      mkdir -p "${WEB_ROOT}/${dir}"
      rsync -a --delete "${DEPLOY_DIR}/${dir}/" "${WEB_ROOT}/${dir}/"
    fi
  done

  for file in "${files[@]}"; do
    if [[ -f "${DEPLOY_DIR}/${file}" ]]; then
      cp -f "${DEPLOY_DIR}/${file}" "${WEB_ROOT}/${file}"
    fi
  done

  for file in "${DEPLOY_DIR}"/*.css; do
    if [[ -f "${file}" ]]; then
      cp -f "${file}" "${WEB_ROOT}/$(basename "${file}")"
    fi
  done

  for file in "${DEPLOY_DIR}"/*.js; do
    if [[ -f "${file}" ]]; then
      cp -f "${file}" "${WEB_ROOT}/$(basename "${file}")"
    fi
  done

  log "Storefront static sync complete."
}

install_nginx_uploads_config() {
  if [[ -f "${DEPLOY_DIR}/scripts/optimize-vps.sh" ]]; then
    log "Applying VPS nginx/PM2 performance optimizations..."
    chmod +x "${DEPLOY_DIR}/scripts/optimize-vps.sh" 2>/dev/null || true
    export UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/byosemarket/uploads}"
    bash "${DEPLOY_DIR}/scripts/optimize-vps.sh"
    return 0
  fi

  if [[ ! -f "${DEPLOY_DIR}/scripts/fix-vps-uploads-serving.sh" ]]; then
    log "Upload nginx fix script not found; skipping nginx upload route install."
    return 0
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    log "nginx not installed; skipping nginx upload route install."
    return 0
  fi

  log "Installing nginx upload serving config..."
  chmod +x "${DEPLOY_DIR}/scripts/fix-vps-uploads-serving.sh" 2>/dev/null || true
  export UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/byosemarket/uploads}"
  bash "${DEPLOY_DIR}/scripts/fix-vps-uploads-serving.sh"
}

wait_for_healthy_api() {
  local -a candidates=()

  if [[ -n "${HEALTH_URL:-}" ]]; then
    candidates=("${HEALTH_URL}")
  else
    candidates=(
      "$(build_health_url "${VPS_HEALTH_HOST}")"
      "$(build_health_url "${VPS_PUBLIC_HOST}")"
    )
  fi

  local attempt=1
  while [[ "${attempt}" -le "${HEALTH_RETRIES}" ]]; do
    for url in "${candidates[@]}"; do
      log "Health check attempt ${attempt}/${HEALTH_RETRIES}: ${url}"
      if verify_health_endpoint "${url}"; then
        log "Deployment completed successfully."
        return 0
      fi
    done

    sleep "${HEALTH_INTERVAL_SEC}"
    attempt=$((attempt + 1))
  done

  return 1
}

require_command git
require_command npm
require_command pm2
require_command curl
require_command node

if [[ ! -d "${DEPLOY_DIR}/.git" ]]; then
  fail "Git repository not found at ${DEPLOY_DIR}"
fi

cd "${DEPLOY_DIR}"

log "Repository: ${DEPLOY_DIR}"
log "Branch: origin/${DEPLOY_BRANCH}"
log "Commit before update: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

log "Fetching latest code from GitHub..."
git fetch origin "${DEPLOY_BRANCH}"
git reset --hard "origin/${DEPLOY_BRANCH}"

log "Commit after update: $(git rev-parse --short HEAD)"

if [[ ! -f package-lock.json ]]; then
  fail "package-lock.json is missing; cannot run a reproducible npm ci install"
fi

log "Installing production dependencies (npm ci --omit=dev)..."
npm ci --omit=dev

log "Ensuring production environment and admin auth configuration..."
node scripts/ensure-production-env.js
node scripts/verify-admin-auth-config.js

export UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/byosemarket/uploads}"
if [[ -f "${DEPLOY_DIR}/scripts/migrate-production-uploads.sh" ]]; then
  log "Preparing persistent uploads directory at ${UPLOADS_DIR}..."
  chmod +x scripts/migrate-production-uploads.sh 2>/dev/null || true
  bash scripts/migrate-production-uploads.sh
fi

log "Verifying production upload path configuration..."
NODE_ENV=production UPLOADS_DIR="${UPLOADS_DIR}" node server/scripts/verify-vps-production-config.js

log "Ensuring PM2 log directory exists..."
mkdir -p logs

log "Restarting application with PM2..."
if pm2 describe "${PM2_APP_NAME}" >/dev/null 2>&1; then
  # Graceful reload keeps the API available during restart when possible.
  npm run pm2:reload
else
  log "PM2 process '${PM2_APP_NAME}' not found; starting a new process..."
  npm run pm2:start
fi

pm2 save

sync_storefront_static

install_nginx_uploads_config

log "Waiting for API health checks (HTTP 200 + JSON status field)..."
if wait_for_healthy_api; then
  exit 0
fi

log "Recent PM2 logs for diagnostics:"
pm2 logs "${PM2_APP_NAME}" --lines 50 --nostream || true
fail "Health check failed after ${HEALTH_RETRIES} attempts."
