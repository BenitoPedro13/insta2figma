#!/bin/sh
set -eu

cd /app/apps/api

# Railway corre migrations em preDeployCommand (railway.api.toml).
# Migrar no entrypoint + healthcheck /v1/health causa restart loop no deploy.
if [ -z "${RAILWAY_ENVIRONMENT:-}" ] && [ "${SKIP_PRISMA_MIGRATE:-}" != "1" ]; then
  echo "[api] Aplicar migrations Prisma…"
  pnpm exec prisma migrate deploy
fi

echo "[api] Arrancar Nest…"
exec node dist/main.js
