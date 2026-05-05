# Worker Insta2Figma (Fase 4)

Consumidor **BullMQ** da fila `scrape-instagram-v1` (ver `@insta2figma/shared-contracts`). Por agora **simula** o scrape: `queued` → `running` → `succeeded` com `resultSummary` mínimo.

## Pré-requisitos

- Postgres + migrações (como na API)
- Redis (`pnpm infra:up` na raíz do monorepo)

## Ambiente

```bash
cp apps/worker/.env.example apps/worker/.env
```

Ajusta `DATABASE_URL` e `REDIS_URL` para coincidir com a API.

## Correr

```bash
pnpm install
pnpm --filter @insta2figma/worker run build
pnpm --filter @insta2figma/worker run start
```

Desenvolvimento com reload:

```bash
pnpm --filter @insta2figma/worker run start:dev
```

Na raíz do monorepo também podes usar `pnpm dev:worker` (se estiver definido no `package.json` da raíz).

O Prisma Client é gerado a partir de **`apps/api/prisma/schema.prisma`** (fonte única).
