#!/bin/sh
set -eu

cd /app/apps/api

echo "[api] Aplicar migrations Prisma…"
pnpm exec prisma migrate deploy

echo "[api] Arrancar Nest…"
exec node dist/main.js
