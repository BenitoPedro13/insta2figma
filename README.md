# Insta2Figma

Monorepo descrito em [docs/ARQUITETURA-INSTA2FIGMA.md](docs/ARQUITETURA-INSTA2FIGMA.md).

## Requisitos

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9 (`corepack enable` recomendado)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2 — **Postgres**, **Redis** e **MinIO** (`docker-compose.yml`)

## Comandos

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

### Infra local (Postgres + Redis)

```bash
pnpm infra:up
```

### Base de dados (Prisma)

```bash
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm --filter @insta2figma/api exec prisma generate
pnpm db:migrate:deploy   # primeira vez ou CI
pnpm db:smoke
```

O `apps/api/.env` deve incluir **`REDIS_URL`** e, para thumbnails no bucket, **`S3_*`** (ver `.env.example`; MinIO sobe com `pnpm infra:up`).

### API Nest (JWT) + worker BullMQ + object storage

```bash
pnpm dev:api       # enfileira jobs e presign opcional (?include=signedAssets)
pnpm dev:worker    # scrape + upload MinIO quando S3_* está definido
```

Copia também `apps/worker/.env.example` → `apps/worker/.env` (BD + Redis alinhados à API).

Rotas e exemplos `curl`: [apps/api/README.md](apps/api/README.md). Worker: [apps/worker/README.md](apps/worker/README.md).

Importar no Figma após `pnpm build`: `apps/figma-plugin/dist/manifest.json` — ver [apps/figma-plugin/README.md](apps/figma-plugin/README.md).
