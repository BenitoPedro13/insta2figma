# Insta2Figma — imagens de produção para API Nest e worker BullMQ.
# Build:  docker build --target api -t insta2figma-api .
#         docker build --target worker -t insta2figma-worker .

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared-contracts/package.json packages/shared-contracts/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/shared-contracts packages/shared-contracts
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY turbo.json turbo.json
COPY scripts/docker-entrypoint-api.sh scripts/docker-entrypoint-api.sh
RUN pnpm --filter @insta2figma/shared-contracts build \
  && pnpm --filter @insta2figma/api build \
  && pnpm --filter @insta2figma/worker build

FROM base AS api
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/scripts/docker-entrypoint-api.sh"]

FROM base AS worker
COPY --from=build /app /app
WORKDIR /app/apps/worker
ENTRYPOINT ["node", "dist/main.js"]
