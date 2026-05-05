# Insta2Figma

Monorepo descrito em [docs/ARQUITETURA-INSTA2FIGMA.md](docs/ARQUITETURA-INSTA2FIGMA.md).

## Requisitos

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9 (`corepack enable` recomendado)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2 — para Postgres local

## Comandos

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

### Base de dados (Prisma)

```bash
pnpm infra:up
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm --filter @insta2figma/api exec prisma generate
pnpm db:migrate:deploy   # primeira vez ou CI
pnpm db:smoke
```

### API Nest (Fase 3, JWT)

Actualiza o `apps/api/.env` com `JWT_SECRET` (copia de `.env.example` se precisares). Depois:

```bash
pnpm dev:api
```

Rotas e exemplos `curl` em [apps/api/README.md](apps/api/README.md).

Importar no Figma após `pnpm build`: `apps/figma-plugin/dist/manifest.json` — ver [apps/figma-plugin/README.md](apps/figma-plugin/README.md).
