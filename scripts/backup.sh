#!/usr/bin/env bash
# Fahimni-only backups. Never touches other projects on the host.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/fahimni}"
DATA_DIR="${DATA_DIR:-/data/fahimni}"
PG_CONTAINER="${PG_CONTAINER:-fahimni-postgres}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

mkdir -p "${BACKUP_DIR}"

echo "Backing up PostgreSQL (${PG_CONTAINER})..."
docker exec "${PG_CONTAINER}" pg_dump -U fahimni -d fahimni | gzip > "${BACKUP_DIR}/fahimni-db-${STAMP}.sql.gz"

echo "Backing up books (${DATA_DIR}/books)..."
if [ -d "${DATA_DIR}/books" ]; then
  tar -czf "${BACKUP_DIR}/fahimni-books-${STAMP}.tar.gz" -C "${DATA_DIR}" books
else
  echo "No books directory at ${DATA_DIR}/books yet; skipping."
fi

echo "Backing up admin-uploaded media (${DATA_DIR}/uploads)..."
if [ -d "${DATA_DIR}/uploads" ]; then
  tar -czf "${BACKUP_DIR}/fahimni-uploads-${STAMP}.tar.gz" -C "${DATA_DIR}" uploads
else
  echo "No uploads directory at ${DATA_DIR}/uploads yet; skipping."
fi

echo "IMPORTANT: SETTINGS_ENCRYPTION_KEY is NOT in these backups by design."
echo "Store it in your secret manager: without it, encrypted admin settings"
echo "(OpenAI key, Freemius credentials) cannot be restored."

echo "Done:"
ls -lh "${BACKUP_DIR}" | tail -n 6
