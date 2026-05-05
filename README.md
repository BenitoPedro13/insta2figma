# Insta2Figma

Monorepo descrito em [docs/ARQUITETURA-INSTA2FIGMA.md](docs/ARQUITETURA-INSTA2FIGMA.md).

## Requisitos

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9 (`corepack enable` recomendado)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2 — **Postgres** + **Redis** (`docker-compose.yml`)

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

O `apps/api/.env` deve incluir **`REDIS_URL`** (ver `.env.example`).

### API Nest (JWT) + worker BullMQ (Fase 4)

```bash
pnpm dev:api       # http://localhost:3333 — enfileira jobs no Redis
pnpm dev:worker    # processa a fila scrape-instagram-v1 (simulação)
```

Copia também `apps/worker/.env.example` → `apps/worker/.env` (BD + Redis alinhados à API).

Rotas e exemplos `curl`: [apps/api/README.md](apps/api/README.md). Worker: [apps/worker/README.md](apps/worker/README.md).

Importar no Figma após `pnpm build`: `apps/figma-plugin/dist/manifest.json` — ver [apps/figma-plugin/README.md](apps/figma-plugin/README.md).
