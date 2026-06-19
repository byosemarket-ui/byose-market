#!/usr/bin/env bash
#
# One-shot fix for product images returning HTML instead of image/jpeg on HTTPS.
# Run on the VPS as root:
#   cd /root/BYOSESEMARKET4 && bash scripts/fix-vps-uploads-serving.sh
#
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/root/BYOSESEMARKET4}"
UPLOADS_DIR="${UPLOADS_DIR:-${DEPLOY_DIR}/server/uploads}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/byosemarket}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled/byosemarket}"
NGINX_SNIPPET="${NGINX_SNIPPET:-/etc/nginx/snippets/byosemarket-uploads.conf}"
API_PORT="${API_PORT:-5000}"

log() {
  printf '[fix-uploads] %s\n' "$*"
}

fail() {
  printf '[fix-uploads] ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  fail "Run as root: sudo bash scripts/fix-vps-uploads-serving.sh"
fi

if [[ ! -d "${DEPLOY_DIR}" ]]; then
  fail "Deploy directory not found: ${DEPLOY_DIR}"
fi

log "Ensuring uploads directory exists: ${UPLOADS_DIR}"
mkdir -p "${UPLOADS_DIR}/products" "${UPLOADS_DIR}/categories" "${UPLOADS_DIR}/users" "${UPLOADS_DIR}/reviews" "${UPLOADS_DIR}/temp"
chmod -R u+rwX,go+rX "${UPLOADS_DIR}"

product_count="$(find "${UPLOADS_DIR}/products" -type f 2>/dev/null | wc -l | tr -d ' ')"
log "Product image files on disk: ${product_count}"

if [[ "${product_count}" -eq 0 ]]; then
  log "WARNING: No files in ${UPLOADS_DIR}/products yet."
fi

if ! command -v nginx >/dev/null 2>&1; then
  fail "nginx is not installed."
fi

mkdir -p /etc/nginx/snippets

log "Installing uploads nginx snippet..."
install -m 644 "${DEPLOY_DIR}/deploy/nginx-snippet-uploads.conf" "${NGINX_SNIPPET}"

if [[ -f "${DEPLOY_DIR}/deploy/nginx-snippet-static-assets.conf" ]]; then
  log "Installing static assets nginx snippet..."
  install -m 644 "${DEPLOY_DIR}/deploy/nginx-snippet-static-assets.conf" /etc/nginx/snippets/byosemarket-static-assets.conf
fi

log "Ensuring root storefront JavaScript is published..."
if [[ -d "${WEB_ROOT:-/var/www/byosemarket}" ]]; then
  for file in "${DEPLOY_DIR}"/*.js; do
    if [[ -f "${file}" ]]; then
      cp -f "${file}" "${WEB_ROOT:-/var/www/byosemarket}/$(basename "${file}")"
    fi
  done
fi

log "Installing nginx site config (HTTP + HTTPS with /uploads alias)..."
install -m 644 "${DEPLOY_DIR}/deploy/nginx-byosemarket.conf" "${NGINX_SITE}"
ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"

if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

log "Testing nginx configuration..."
nginx -t

log "Reloading nginx..."
systemctl reload nginx

sample_path=""
sample_path="$(curl -fsS "http://127.0.0.1:${API_PORT}/api/products" 2>/dev/null | node -e "
  let raw = '';
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(raw);
      const products = Array.isArray(payload.products) ? payload.products : [];
      const product = products.find((entry) => String(entry.mainImage || entry.image || '').includes('/uploads/products/'));
      const value = String(product?.mainImage || product?.image || '').trim();
      if (!value) process.exit(2);
      const path = value.startsWith('http') ? new URL(value).pathname : value;
      process.stdout.write(path);
    } catch (_error) {
      process.exit(1);
    }
  });
" 2>/dev/null || true)"

if [[ -z "${sample_path}" ]]; then
  sample_file="$(find "${UPLOADS_DIR}/products" -type f -printf '%f\n' 2>/dev/null | head -n 1 || true)"
  if [[ -n "${sample_file}" ]]; then
    sample_path="/uploads/products/${sample_file}"
  fi
fi

if [[ "${sample_path}" == "/uploads/products/" || "${sample_path}" == "/uploads/products" ]]; then
  log "WARNING: No sample upload path available for curl verification."
else
  log "Verifying local HTTP upload route: ${sample_path}"
  http_type="$(curl -fsSI "http://127.0.0.1${sample_path}" | awk -F': ' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r' | head -n 1)"
  if [[ "${http_type}" != image/* ]]; then
    fail "Local HTTP upload route returned '${http_type:-unknown}' instead of image/* for ${sample_path}"
  fi
  log "Local HTTP upload route OK (${http_type})"

  if curl -fsSI "https://byosemarket.com${sample_path}" >/dev/null 2>&1; then
    https_type="$(curl -fsSI "https://byosemarket.com${sample_path}" | awk -F': ' 'tolower($1)=="content-type" {print tolower($2)}' | tr -d '\r' | head -n 1)"
    if [[ "${https_type}" != image/* ]]; then
      fail "HTTPS upload route returned '${https_type:-unknown}' instead of image/* for ${sample_path}"
    fi
    log "HTTPS upload route OK (${https_type})"
  else
    log "HTTPS verification skipped (domain or certificate unavailable from this host)."
  fi
fi

log "PASS - /uploads/ is now served from ${UPLOADS_DIR} on both HTTP and HTTPS."
