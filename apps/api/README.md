# API Insta2Figma

**Prisma** + **Postgres** + **Redis** + **NestJS** (`POST /v1/jobs` persiste e **enfileira** BullMQ `scrape-instagram-v1`; o scrape real corre em [`apps/worker`](../../apps/worker), Fase 5). Persistência: §5.2; fila: §5.3 da [arquitetura](../../docs/ARQUITETURA-INSTA2FIGMA.md).

## Ambiente

Variáveis — ver [`.env.example`](./.env.example) (inclui `JWT_SECRET`, `PORT`, `DATABASE_URL`, **`REDIS_URL`**). Se Redis estiver indisponível ao criar job, a API pode responder **503** e marcar o job como falhado (`QUEUE_UNAVAILABLE`).

> **MVP auth:** `POST /v1/auth/register` e `POST /v1/auth/login` usam só **email** (sem password). Isto é apenas para desenvolvimento; produção deve seguir o fluxo recomendado na arquitetura (OIDC / sessão).

### Postgres (Docker)

Na raíz do monorepo:

```bash
pnpm infra:up
cp apps/api/.env.example apps/api/.env   # se ainda não tiveres JWT_SECRET, etc.
pnpm install
pnpm db:migrate:deploy
pnpm db:smoke
```

## API HTTP

Build e arranque:

```bash
pnpm --filter @insta2figma/api run build
pnpm --filter @insta2figma/api run start:dev
```

Por omissão ouve em `http://localhost:3333` (ajusta `PORT` no `.env`).

### Endpoints (prefixo global `/v1`)

| Método | Rota | Auth |
|--------|------|------|
| GET | `/v1/health` | — |
| POST | `/v1/auth/register` | — body `{ "email": "..." }` |
| POST | `/v1/auth/login` | — body `{ "email": "..." }` |
| POST | `/v1/jobs` | Bearer JWT; header opcional `idempotency-key` |
| GET | `/v1/jobs/:id` | Bearer JWT |

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
  -d '{"type":"SCRAPE_PROFILE","input":{"username":"instagram"}}')
echo "$RESP"
# Em zsh/bash com jq: JOB_ID=$(echo "$RESP" | jq -r '.data.id')
# Sem jq: copia o UUID do campo "id" da resposta para JOB_ID.

JOB_ID='…'  # substitui pelo UUID real
curl -s "$BASE/v1/jobs/$JOB_ID" \
  -H "authorization: Bearer $TOKEN"
```

Corpo de job validado com **`@insta2figma/shared-contracts`** (`createJobBodySchema`). `result_summary` bem-sucedido segue `scrapeJobResultSummaryV5Schema` (Instagram `web_profile_info`). Correr `pnpm dev:worker` na raíz junto da API — ver [apps/worker/README.md](../../apps/worker/README.md).

### Prisma (CLI)

```bash
pnpm --filter @insta2figma/api exec prisma generate
pnpm --filter @insta2figma/api exec prisma migrate dev
pnpm --filter @insta2figma/api exec prisma studio
```
