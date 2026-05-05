# Insta2Figma

Monorepo descrito em [docs/ARQUITETURA-INSTA2FIGMA.md](docs/ARQUITETURA-INSTA2FIGMA.md).

Estado atual: plugin Figma com UI React/Vite, histórico/favoritos persistidos em
`figma.clientStorage`, preview de perfil (avatar + estimativas) e import assíncrono
via API Nest + worker BullMQ.

## Requisitos

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9 (`corepack enable` recomendado)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2 — **Postgres**, **Redis** e **MinIO** (`docker-compose.yml`)

## Comandos

```bash
pnpm bootstrap
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Onboarding em 1 comando

Para novos devs, o caminho recomendado é:

```bash
pnpm bootstrap
```

> Nota: `pnpm setup` é comando interno do próprio pnpm; por isso o bootstrap
> do projeto fica em `pnpm bootstrap`.

O script `scripts/setup.mjs` faz:

1. cria `apps/api/.env` e `apps/worker/.env` a partir dos `.env.example` (se faltarem),
2. instala dependências (`pnpm install`),
3. sobe infra Docker (`postgres`, `redis`, `minio`),
4. gera cliente Prisma,
5. aplica migrations (`db:migrate:deploy`),
6. executa smoke test de DB (`db:smoke`).

Depois, arranca a app com:

```bash
pnpm dev:api
pnpm dev:worker
```

## Mapa do monorepo

- `apps/figma-plugin`: plugin (UI + `code.ts` no main thread do Figma).
- `apps/api`: API Nest (`/v1`, auth MVP, jobs, preview de perfil).
- `apps/worker`: consumidor BullMQ (scrape Instagram + uploads para S3/MinIO).
- `packages/shared-contracts`: contratos Zod/tipos compartilhados.
- `docs/`: arquitetura, plano de implementação e especificação visual da UI.

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

Rotas e exemplos `curl`: [apps/api/README.md](apps/api/README.md).  
Worker e política de assets: [apps/worker/README.md](apps/worker/README.md).

Importar no Figma após `pnpm build`: `apps/figma-plugin/dist/manifest.json` — ver [apps/figma-plugin/README.md](apps/figma-plugin/README.md).

## Fluxo rápido de validação (repo exemplar)

1. `pnpm bootstrap` (uma vez por máquina/projeto)
2. `pnpm dev:api` e `pnpm dev:worker`
3. `pnpm build` (ou build específico do plugin)
4. Importar `apps/figma-plugin/dist/manifest.json` no Figma
5. No plugin:
   - escrever username,
   - ajustar posts/carrossel,
   - validar preview/estimativa,
   - importar e confirmar resultado no canvas + histórico/favoritos.

## Troubleshooting rápido

- `pnpm bootstrap` falha em Docker: confirmar Docker Desktop ligado e `docker compose version`.
- `ERR_CONNECTION_REFUSED` no plugin: API não está de pé (`pnpm dev:api`) ou `PORT` diferente.
- Job fica em `queued`: worker não está de pé (`pnpm dev:worker`) ou Redis indisponível.
- Preview sem avatar: endpoint de preview responde sem `profilePicDataUrl` (bloqueio upstream); o fallback de UI usa placeholder.
