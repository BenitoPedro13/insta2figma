# Deploy Insta2Figma

O backend é **dois processos Node** (API Nest + worker BullMQ) mais **Postgres**, **Redis** e **object storage S3-compatível**. O plugin Figma é distribuído à parte (build local → publicar no Figma).

## O que vais publicar

| Componente | Onde corre | Notas |
|------------|------------|--------|
| `apps/api` | Container / PaaS | Expõe `GET /v1/health`, migrations no arranque |
| `apps/worker` | Container / PaaS separado | Sem porta HTTP; consome Redis |
| Postgres | Gerido (Neon, Supabase, RDS) ou Docker | `DATABASE_URL` |
| Redis | Gerido (Upstash, Railway) ou Docker | `REDIS_URL` |
| S3 / R2 / MinIO | Cloudflare R2, AWS S3, ou MinIO no VPS | `S3_*` + `PUBLIC_S3_ENDPOINT` acessível pelo Figma |
| Plugin Figma | Figma Community / org | Apontar `DEFAULT_API_BASE` para a API pública |

## Variáveis obrigatórias (produção)

Copia `apps/api/.env.example` e `apps/worker/.env.example` e ajusta:

| Variável | API | Worker | Descrição |
|----------|-----|--------|-----------|
| `DATABASE_URL` | ✓ | ✓ | Postgres com `?schema=public` |
| `REDIS_URL` | ✓ | ✓ | Mesma instância Redis |
| `JWT_SECRET` | ✓ | — | String longa (≥32 chars) |
| `S3_*` | ✓ | ✓ | Bucket + credenciais |
| `PUBLIC_S3_ENDPOINT` | ✓ | — | URL **pública** usada nas presigned URLs (browser do plugin) |
| `PORT` | ✓ | — | PaaS injeta (ex. `8080`); local `3333` |

Polar (billing): ver [DEV-POLAR-NGROK.md](./DEV-POLAR-NGROK.md) — em produção usa `POLAR_SERVER=production` e webhook em `https://<api>/v1/billing/webhooks/polar`.

## Opção A — VPS com Docker (mais rápido para testar)

1. Servidor com Docker Compose v2.
2. Clona o repo e configura env:

```bash
cp .env.prod.example .env.prod
# Edita: POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD, JWT_SECRET, PUBLIC_S3_ENDPOINT
```

3. Sobe a stack:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

4. Confirma saúde:

```bash
curl -s http://<IP-do-servidor>:3333/v1/health
```

5. Coloca **HTTPS** à frente (Caddy, nginx, Cloudflare Tunnel) — o plugin e o Polar precisam de URL pública `https://`.

`PUBLIC_S3_ENDPOINT` deve ser o URL onde o Figma consegue fazer `fetch` às imagens (ex. subdomínio do MinIO atrás do proxy, ou domínio R2).

## Opção B — Railway (recomendado)

Guia completo: **[docs/RAILWAY.md](./RAILWAY.md)**.

Repo org: `git@github.com:mainnetdesign/insta2figma.git` (remote `mainnet`).

Resumo: projeto com **Postgres** + **Redis** + serviços **api** (`Dockerfile.api`) e **worker** (`Dockerfile.worker`) + **Cloudflare R2** para assets.

```bash
git push -u mainnet main
```

Build local:

```bash
pnpm docker:build:api      # Dockerfile.api
pnpm docker:build:worker   # Dockerfile.worker
# ou multi-stage:
docker build --target api -t insta2figma-api .
```

### Render

Blueprint manual: Web Service (`api` target) + Background Worker (`worker` target) + Postgres + Redis externos ou Render managed.

Health check path: `/v1/health`.

## Opção C — Serviços geridos (sem Docker no app)

1. **Neon** ou **Supabase** → `DATABASE_URL`
2. **Upstash Redis** → `REDIS_URL`
3. **Cloudflare R2** → `S3_*`
4. Deploy API + worker em qualquer host Node 20 com:

```bash
pnpm install --frozen-lockfile
pnpm --filter @insta2figma/shared-contracts build
pnpm --filter @insta2figma/api build
pnpm --filter @insta2figma/worker build
cd apps/api && pnpm exec prisma migrate deploy && node dist/main.js
# noutro processo:
cd apps/worker && node dist/main.js
```

## Plugin Figma após deploy

1. Em `apps/figma-plugin/src/code.ts`, altera `DEFAULT_API_BASE` para `https://api.seudominio.com` (sem `/v1`).
2. Em `apps/figma-plugin/manifest.json`, restringe `networkAccess.allowedDomains` ao domínio da API + storage + `instagram.*` (CDN).
3. `pnpm --filter @insta2figma/figma-plugin build`
4. Publica `apps/figma-plugin/dist/manifest.json` no Figma (Developers → publish).

## Checklist pós-deploy

- [ ] `curl https://<api>/v1/health` → `{"status":"ok",...}`
- [ ] Worker ligado (job deixa de ficar `queued`)
- [ ] Upload/presign S3 funciona (`PUBLIC_S3_ENDPOINT` correto)
- [ ] Webhook Polar (se billing) aponta para `https://<api>/v1/billing/webhooks/polar`
- [ ] `JWT_SECRET` único em produção
- [ ] Plugin buildado com URL de produção

## Troubleshooting

| Sintoma | Causa provável |
|---------|----------------|
| Job `queued` eternamente | Worker down ou `REDIS_URL` diferente entre API e worker |
| Plugin `ERR_CONNECTION_REFUSED` | API URL errada ou sem HTTPS onde o Figma exige |
| Imagens não carregam | `PUBLIC_S3_ENDPOINT` inacessível do browser / CORS no bucket |
| `prisma migrate` falha | `DATABASE_URL` errado ou rede privada sem acesso à BD |
