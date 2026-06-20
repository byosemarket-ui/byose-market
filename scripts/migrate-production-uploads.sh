#!/usr/bin/env bash
#
# Ensures production uploads live in a nginx-readable path outside /root.
# Migrates files from legacy locations and keeps bucket directories in sync.
#
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/root/BYOSESEMARKET4}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/byosemarket/uploads}"
LEGACY_UPLOADS_DIR="${LEGACY_UPLOADS_DIR:-${DEPLOY_DIR}/server/uploads}"

log() {
  printf '[migrate-uploads] %s\n' "$*"
}

count_upload_files() {
  local root="$1"
  if [[ ! -d "${root}" ]]; then
    printf '0'
    return 0
  fi

  find "${root}" -type f ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' '
}

sync_legacy_uploads() {
  local legacy_root="$1"
  local legacy_count

  if [[ ! -d "${legacy_root}" ]]; then
    return 0
  fi

  legacy_count="$(count_upload_files "${legacy_root}")"
  if [[ "${legacy_count}" -eq 0 ]]; then
    return 0
  fi

  if [[ "$(realpath "${legacy_root}")" == "$(realpath "${UPLOADS_DIR}")" ]]; then
    return 0
  fi

  log "Migrating ${legacy_count} file(s) from ${legacy_root} to ${UPLOADS_DIR}"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "${legacy_root}/" "${UPLOADS_DIR}/"
  else
    cp -a "${legacy_root}/." "${UPLOADS_DIR}/"
  fi
}

log "Ensuring uploads directory exists: ${UPLOADS_DIR}"
mkdir -p "${UPLOADS_DIR}/products" "${UPLOADS_DIR}/categories" "${UPLOADS_DIR}/users" "${UPLOADS_DIR}/reviews" "${UPLOADS_DIR}/temp"
chmod -R u+rwX,go+rX "${UPLOADS_DIR}"

sync_legacy_uploads "${LEGACY_UPLOADS_DIR}"

for legacy_root in \
  "/root/BYOSESEMARKET4/server/uploads" \
  "${DEPLOY_DIR}/server/uploads"
do
  sync_legacy_uploads "${legacy_root}"
done

product_count="$(count_upload_files "${UPLOADS_DIR}/products")"
total_count="$(count_upload_files "${UPLOADS_DIR}")"
log "Upload files on disk: ${total_count} total (${product_count} product images)"
