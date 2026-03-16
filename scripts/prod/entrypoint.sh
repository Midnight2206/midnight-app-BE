#!/bin/sh
set -eu

START_CMD="${*:-node server.js}"
MAX_RETRIES="${DB_MIGRATE_MAX_RETRIES:-30}"
SLEEP_SECONDS="${DB_MIGRATE_RETRY_DELAY_SECONDS:-5}"

attempt=1
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] prisma migrate deploy failed after $attempt attempts"
    exit 1
  fi

  echo "[entrypoint] waiting for database... attempt $attempt/$MAX_RETRIES"
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

echo "[entrypoint] migrations completed"

if [ "${RUN_SUPERADMIN_BOOTSTRAP:-true}" = "true" ] && [ "$START_CMD" = "node server.js" ]; then
  echo "[entrypoint] running super admin bootstrap"
  node scripts/bootstrapSuperAdmin.js || true
fi

echo "[entrypoint] starting: $START_CMD"
if [ "$#" -eq 0 ]; then
  exec node server.js
fi

exec "$@"
