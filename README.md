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

Depois, arranca a app com **um único terminal** (logs da API e do worker com prefixos coloridos, estilo Docker Compose):

```bash
pnpm dev
```

Equivalente a correr em dois terminais:

```bash
pnpm dev:api
pnpm dev:worker
```

### Logs da infra Docker (outro terminal)

```bash
pnpm infra:logs          # postgres + redis + minio (follow)
pnpm infra:logs:postgres # só Postgres
pnpm infra:logs:redis    # só Redis
```

## Mapa do monorepo

- `apps/figma-plugin`: plugin (UI + `code.ts` no main thread do Figma).
- `apps/api`: API Nest (`/v1`, auth MVP, jobs, preview de perfil).
- `apps/worker`: consumidor BullMQ (scrape Instagram + uploads para S3/MinIO).
- `packages/shared-contracts`: contratos Zod/tipos compartilhados.
- `packages/shared-instagram`: sessões (`globalSessionPool`), proxy pool, retry e parsing partilhados entre API e worker.
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
pnpm dev           # API + worker no mesmo terminal (recomendado)
# ou
pnpm dev:api       # só API — enfileira jobs, presign (?include=signedAssets)
pnpm dev:worker    # só worker — scrape + upload MinIO quando S3_* está definido
```

Copia também `apps/worker/.env.example` → `apps/worker/.env` (BD + Redis alinhados à API).

Rotas e exemplos `curl`: [apps/api/README.md](apps/api/README.md).  
Worker e política de assets: [apps/worker/README.md](apps/worker/README.md).

Importar no Figma após `pnpm build`: `apps/figma-plugin/dist/manifest.json` — ver [apps/figma-plugin/README.md](apps/figma-plugin/README.md).

### Billing Polar.sh + ngrok (checkout Pro, webhooks)

Opcional para quem testa subscrições. Requer variáveis `POLAR_*` em `apps/api/.env` (ver `.env.example`).

| Passo | O quê |
|-------|--------|
| 1 | Conta e produtos em [sandbox.polar.sh](https://sandbox.polar.sh) — Pro mensal + anual |
| 2 | OAT + `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID_PRO_MONTHLY`, `POLAR_PRODUCT_ID_PRO_YEARLY`, `POLAR_SERVER=sandbox` |
| 3 | `ngrok http 3333` → webhook `https://<ngrok>/v1/billing/webhooks/polar` |
| 4 | `POLAR_WEBHOOK_SECRET` no `.env` + reiniciar API |
| 5 | Plugin Figma → **Upgrade to Pro**; cartão teste `4242 4242 4242 4242` |

Guia completo (scopes do token, troubleshooting, `curl`): **[docs/DEV-POLAR-NGROK.md](docs/DEV-POLAR-NGROK.md)**.

## Fluxo rápido de validação (repo exemplar)

1. `pnpm bootstrap` (uma vez por máquina/projeto)
2. `pnpm dev` (API + worker)
3. `pnpm build` (ou build específico do plugin)
4. Importar `apps/figma-plugin/dist/manifest.json` no Figma
5. No plugin:
   - escrever username,
   - ajustar posts/carrossel,
   - validar preview/estimativa,
   - importar e confirmar resultado no canvas + histórico/favoritos.

## Deploy (produção)

- **Railway:** **[docs/RAILWAY.md](docs/RAILWAY.md)** — Postgres + Redis + API + worker no mesmo projeto.
- **Geral:** **[docs/DEPLOY.md](docs/DEPLOY.md)** — Docker Compose VPS, R2, plugin Figma.
- **Sessões Instagram:** **[docs/SESSION-MANAGEMENT.md](docs/SESSION-MANAGEMENT.md)** — criar contas, extrair cookies, hot-reload sem redeploy, alertas Discord/Slack.

Remotes Git:

| Remote | URL |
|--------|-----|
| `mainnet` | `git@github.com:mainnetdesign/insta2figma.git` |
| `origin` | fork pessoal (BenitoPedro13) |

```bash
git push -u mainnet main
```

```bash
cp .env.prod.example .env.prod   # editar segredos
pnpm prod:up                     # API + worker + Postgres + Redis + MinIO
```

## Troubleshooting rápido

- `pnpm bootstrap` falha em Docker: confirmar Docker Desktop ligado e `docker compose version`.
- `ERR_CONNECTION_REFUSED` no plugin: API não está de pé (`pnpm dev` ou `pnpm dev:api`) ou `PORT` diferente.
- Job fica em `queued`: worker não está de pé (`pnpm dev` ou `pnpm dev:worker`) ou Redis indisponível.
- Preview sem avatar: endpoint de preview responde sem `profilePicDataUrl` (bloqueio upstream); o fallback de UI usa placeholder.
- `checkpoint_required` no worker: a sessão Instagram foi criada num IP diferente dos proxies. Cria a conta com o browser a correr pelo proxy — ver [docs/SESSION-MANAGEMENT.md §1](docs/SESSION-MANAGEMENT.md).
- Sessão Instagram expirou (401/403): configura `ALERT_WEBHOOK_URL` para receber alerta automático; renova com `node scripts/ig-cookie-helper.mjs` + `POST /admin/sessions` (sem redeploy) — ver [docs/SESSION-MANAGEMENT.md](docs/SESSION-MANAGEMENT.md).
- `503 Polar billing is not configured`: `POLAR_ACCESS_TOKEN` em falta.
- `Plan pro (yearly) is not configured yet`: `POLAR_PRODUCT_ID_PRO_YEARLY` em falta.
- Checkout Polar / plano Pro: ver [docs/DEV-POLAR-NGROK.md](docs/DEV-POLAR-NGROK.md).
- **`P3018` / `relation "assets" does not exist`:** a migration `20260505121352` foi removida do repo (estava antes do `init`). O Postgres ficou bloqueado. Na raiz:
  ```bash
  git pull
  pnpm infra:up
  # Recomendado (BD local de dev — apaga dados):
  pnpm --filter @insta2figma/api exec prisma migrate reset --force
  pnpm bootstrap
  ```
  Ou só desbloquear e migrar:
  ```bash
  pnpm --filter @insta2figma/api exec prisma migrate resolve --rolled-back "20260505121352"
  pnpm db:migrate:deploy
  ```
  O `pnpm bootstrap` tenta o `resolve` automaticamente.
