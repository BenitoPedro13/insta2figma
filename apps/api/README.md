# API Insta2Figma

**Prisma** + **Postgres** + **Redis** + **NestJS** (`POST /v1/jobs` persiste e **enfileira** BullMQ `scrape-instagram-v1`; o scrape real corre em [`apps/worker`](../../apps/worker), Fase 5). Persistência: §5.2; fila: §5.3 da [arquitetura](../../docs/ARQUITETURA-INSTA2FIGMA.md).

## Ambiente

Variáveis — ver [`.env.example`](./.env.example) (`JWT_SECRET`, `DATABASE_URL`, **`REDIS_URL`**, **`S3_*`** para MinIO / R2 / S3). Se Redis estiver indisponível ao criar job, pode devolver **503** (`QUEUE_UNAVAILABLE`).

> **Auth:** o plugin Figma usa `POST /v1/auth/figma` (`figmaUserId` de `figma.currentUser`). `register`/`login` por email continuam disponíveis para testes manuais com `curl`.

### Billing Polar.sh (sandbox)

Variáveis em [`.env.example`](./.env.example) (`POLAR_*`). Endpoints:

| Método | Rota | Auth |
|--------|------|------|
| GET | `/v1/me` | Bearer — plano e quotas |
| POST | `/v1/billing/checkout-session` | Bearer — `{ url }` para checkout Pro |
| POST | `/v1/billing/portal-session` | Bearer — portal do cliente |
| POST | `/v1/billing/webhooks/polar` | Assinatura Polar (`POLAR_WEBHOOK_SECRET`) |

Setup Polar, ngrok, cartão de teste e troubleshooting: **[docs/DEV-POLAR-NGROK.md](../../docs/DEV-POLAR-NGROK.md)**.

## Setup rápido (recomendado)

Na raiz do monorepo:

```bash
pnpm bootstrap
```

Isto já prepara `.env`, infra Docker, Prisma e migrations.

### Postgres (Docker)

Na raíz do monorepo:

```bash
pnpm infra:up
cp apps/api/.env.example apps/api/.env   # se ainda não tiveres JWT_SECRET, etc.
pnpm install
pnpm db:migrate:deploy
pnpm db:smoke
```

Se já correres `pnpm bootstrap`, este bloco já foi executado.

## API HTTP

Build e arranque:

```bash
pnpm --filter @insta2figma/api run build
pnpm --filter @insta2figma/api run start:dev
```

Por omissão ouve em `http://localhost:3333` (ajusta `PORT` no `.env`).

### CORS e plugin Figma

A lista permitida inclui sempre a origem opaca **`null`** (é o que o navegador envia quando o **`fetch`** do código do plugin corre via proxy do Figma), mais **`https://www.figma.com`**, **`https://www.figma.dev`** e **`https://figma.com`**. Opcionalmente, **`CORS_ORIGINS`** acrescenta mais origens separadas por vírgulas — não removes as anteriores.

Se vires **`ERR_CONNECTION_REFUSED`**, o processo Nest não está a ouvir na porta esperada ou não está ligado onde o Figma corre (arranca **`pnpm dev:api`** e confirma o `PORT`). Depois destas mudanças, **reinicia a API**.

### Endpoints (prefixo global `/v1`)

| Método | Rota | Auth |
|--------|------|------|
| GET | `/v1/health` | — |
| POST | `/v1/auth/register` | — body `{ "email": "..." }` |
| POST | `/v1/auth/login` | — body `{ "email": "..." }` |
| POST | `/v1/auth/figma` | — body `{ "figmaUserId": "...", "name?": "..." }` |
| GET | `/v1/me` | Bearer — `planTier`, quotas, subscrição |
| POST | `/v1/billing/checkout-session` | Bearer — URL checkout Polar |
| POST | `/v1/billing/portal-session` | Bearer — URL portal Polar |
| POST | `/v1/jobs` | Bearer JWT; header opcional `idempotency-key` |
| GET | `/v1/jobs/:id` | Bearer JWT; query opcional `include=signedAssets` (URLs GET assinadas para `assets` do job, só se `succeeded`) |
| GET | `/v1/instagram/profile-preview?username=...&maxPosts=12&expandCarouselImages=true` | Bearer JWT; preview leve (avatar, mediaCount, privado + estimativa de imagens) para UX no formulário |

Respostas de sucesso sob envelope `{ "data": … }`; erros `{ "error": { "code", "message" } }` (ver arquitetura §7).

### Exemplo `curl`

Substitui o token devolvido pelo login.

```bash
BASE=http://localhost:3333

curl -s "$BASE/v1/health"

curl -s -X POST "$BASE/v1/auth/register" \
  -H 'content-type: application/json' \
  -d '{"email":"dev@example.com"}'

TOKEN="..."

RESP=$(curl -s -X POST "$BASE/v1/jobs" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-1' \
  -d '{"type":"SCRAPE_PROFILE","input":{"username":"instagram","maxPosts":12,"expandCarouselImages":true}}')
echo "$RESP"
# Em zsh/bash com jq: JOB_ID=$(echo "$RESP" | jq -r '.data.id')
# Sem jq: copia o UUID do campo "id" da resposta para JOB_ID.

JOB_ID='…'  # substitui pelo UUID real
curl -s "$BASE/v1/jobs/$JOB_ID" \
  -H "authorization: Bearer $TOKEN"

# Com URLs assinadas MinIO/S3 (Fase 6)
curl -s "$BASE/v1/jobs/$JOB_ID?include=signedAssets" \
  -H "authorization: Bearer $TOKEN"
```

Corpo de job validado com **`@insta2figma/shared-contracts`** (`createJobBodySchema`). Os campos opcionais **`input.maxPosts`** (1–50) e **`input.expandCarouselImages`** são gravados tal como enviados e o worker usa-os no scrape e nos uploads (ver `apps/worker`). Em jobs `succeeded`, `result_summary` segue `scrapeJobResultSummaryV5Schema` e inclui **`scrapingMeta`** (eco do pedido + tamanho da amostra parseada — útil para confirmar que as opções foram aplicadas). Correr `pnpm dev:worker` na raíz junto da API — ver [apps/worker/README.md](../../apps/worker/README.md).

### `GET /v1/instagram/profile-preview` (detalhado)

Query:

- `username` (obrigatório)
- `maxPosts` (opcional, default 12, clamp 1–50)
- `expandCarouselImages` (`true|false`)

Resposta (envelope `data`) inclui:

- `username`
- `mediaCount` (contagem total de posts no perfil)
- `isPrivate`
- `profilePicUrlHd` (URL original IG)
- `profilePicDataUrl` (avatar inline para UI)
- `estimatedPostCovers`
- `estimatedCarouselExtras`
- `estimatedImportImages` (`covers + extras`)

Este endpoint suporta o preview do formulário do plugin sem criar job.

### Prisma (CLI)

```bash
pnpm --filter @insta2figma/api exec prisma generate
pnpm --filter @insta2figma/api exec prisma migrate dev
pnpm --filter @insta2figma/api exec prisma studio
```

Se ao arrancar vires **`SyntaxError` em `node_modules/.../.prisma/client/index.js`**, costuma ser cliente gerado corrompido ou escrita concorrente: `pnpm --filter @insta2figma/api exec prisma generate` na raíz, ou remover `node_modules` e repetir `pnpm install`.

### Migrations — ordem e erro `P3018`

As migrations aplicam-se por **nome da pasta** (timestamp). A ordem correcta é:

1. `20260505210000_init` — cria tabelas
2. `20260505210001_drop_uuid_defaults` — ajustes de UUID
3. `20260517120000_polar_billing` — Polar / billing

Se `pnpm bootstrap` falhar com **`relation "assets" does not exist`** e migration `20260505121352`, faz `git pull` (fix já no repo) e:

```bash
pnpm --filter @insta2figma/api exec prisma migrate reset --force
pnpm db:migrate:deploy
```

Em BD local de dev, `migrate reset` é seguro (apaga dados).

