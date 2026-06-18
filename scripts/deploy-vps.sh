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
  trap 'rm -f "${body_file}"' RETURN

  http_code="$(curl -sS -o "${body_file}" -w "%{http_code}" --max-time 10 "${url}" || printf '000')"
  if [[ "${http_code}" != "200" ]]; then
    log "Health probe failed for ${url} (HTTP ${http_code})."
    return 1
  fi

  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) process.exit(1);
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || typeof payload.status !== 'string') {
      process.exit(1);
    }
    process.stdout.write(String(payload.status));
  " "${body_file}" >/dev/null

  log "Health probe passed for ${url} (HTTP 200, valid JSON)."
  return 0
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

log "Waiting for API health checks (HTTP 200 + JSON status field)..."
if wait_for_healthy_api; then
  exit 0
fi

log "Recent PM2 logs for diagnostics:"
pm2 logs "${PM2_APP_NAME}" --lines 50 --nostream || true
fail "Health check failed after ${HEALTH_RETRIES} attempts."
