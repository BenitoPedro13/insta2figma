# API Insta2Figma

**Prisma** + **Postgres** + **NestJS** (Fase 3: jobs via HTTP com JWT, **sem fila** ainda). Persistência: §5.2 da [arquitetura](../../docs/ARQUITETURA-INSTA2FIGMA.md).

## Ambiente

Variáveis — ver [`.env.example`](./.env.example) (inclui `JWT_SECRET`, `PORT`, `DATABASE_URL`).

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

curl -s -X POST "$BASE/v1/jobs" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-1' \
  -d '{"type":"SCRAPE_PROFILE","input":{"username":"instagram"}}'

curl -s "$BASE/v1/jobs/JOB_UUID" \
  -H "authorization: Bearer $TOKEN"
```

Corpo de job validado com **`@insta2figma/shared-contracts`** (`createJobBodySchema`).

### Prisma (CLI)

```bash
pnpm --filter @insta2figma/api exec prisma generate
pnpm --filter @insta2figma/api exec prisma migrate dev
pnpm --filter @insta2figma/api exec prisma studio
```
