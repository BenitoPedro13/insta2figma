# Deploy no Railway

Repositório: `git@github.com:mainnetdesign/insta2figma.git` (remote `mainnet`).

## 1. Git — push para a org

```bash
git remote -v
# mainnet → git@github.com:mainnetdesign/insta2figma.git
# origin  → fork pessoal (opcional)

git push -u mainnet main
```

## 2. Projeto Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → `mainnetdesign/insta2figma`.
2. Adiciona plugins no mesmo projeto:
   - **PostgreSQL**
   - **Redis**
3. Cria **dois serviços** a partir do mesmo repo (não uses root directory — monorepo partilhado):

| Serviço | Dockerfile | Config-as-code |
|---------|------------|----------------|
| `api` | `Dockerfile.api` | `/railway.api.toml` |
| `worker` | `Dockerfile.worker` | `/railway.worker.toml` |

Em cada serviço → **Settings**:

- **Build** → Dockerfile path: `Dockerfile.api` ou `Dockerfile.worker`  
  (ou variável `RAILWAY_DOCKERFILE_PATH` com o mesmo valor)
- **Config file path**: `/railway.api.toml` ou `/railway.worker.toml`
- **Watch paths** (opcional): já definidos nos `.toml`

## 3. Variáveis — serviço `api`

Referências Railway (`${{...}}`) ligam plugins automaticamente.

```env
# Injetado pelo Railway
PORT=${{PORT}}

# Plugins (ajusta nomes se renomeares os serviços no canvas)
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Obrigatório — gera com: openssl rand -base64 48
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Domínio público da API (gera em Settings → Networking → Generate Domain)
# Usado em Polar / CORS se precisares
CORS_ORIGINS=

# Cloudflare R2 (recomendado) — ver secção 4
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
PUBLIC_S3_ENDPOINT=https://<bucket>.<account_id>.r2.dev
S3_REGION=auto
S3_BUCKET=insta2figma
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_FORCE_PATH_STYLE=false
ASSET_PRESIGN_SECONDS=3600

# Polar (produção)
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=
POLAR_SERVER=production
POLAR_PRODUCT_ID_PRO=
POLAR_SYNTHETIC_EMAIL_DOMAIN=mailinator.com
POLAR_SUCCESS_URL=https://insta2figma.com/billing/success
POLAR_RETURN_URL=
```

Webhook Polar: `https://${{api.RAILWAY_PUBLIC_DOMAIN}}/v1/billing/webhooks/polar`

## 4. Variáveis — serviço `worker`

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
WORKER_CONCURRENCY=2
IG_FETCH_TIMEOUT_MS=30000

S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=insta2figma
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_FORCE_PATH_STYLE=false
STORAGE_MAX_THUMBNAILS=12
ASSET_FETCH_TIMEOUT_MS=20000
```

`PUBLIC_S3_ENDPOINT` só na API (presign para o browser).

## 5. Cloudflare R2 (object storage)

1. R2 → Create bucket → `insta2figma`
2. API tokens → permissões Object Read & Write
3. `S3_ENDPOINT` = endpoint da API S3 do R2
4. `PUBLIC_S3_ENDPOINT` = URL pública do bucket ou custom domain (o Figma faz `fetch` aqui)

## 6. Verificar deploy

```bash
curl -s https://<api>.up.railway.app/v1/health
```

Resposta esperada: `{"status":"ok",...}`

No plugin Figma, `DEFAULT_API_BASE` = `https://<api>.up.railway.app` (sem `/v1`).

## 7. Ordem de arranque

1. Postgres + Redis healthy
2. Deploy `api` — `preDeployCommand` corre `prisma migrate deploy` (ver `railway.api.toml`)
3. Deploy `worker`

Se jobs ficarem `queued`, confirma que o worker está **Running** e que `REDIS_URL` é idêntico nos dois serviços.

## Troubleshooting Railway

| Problema | Solução |
|----------|---------|
| Log repete só `[api] Aplicar migrations Prisma…` | Health check a `/v1/health` antes do Nest arrancar → usa `preDeployCommand` + entrypoint sem migrate no Railway (já no repo). Faz redeploy após pull. |
| Build usa Dockerfile errado | `RAILWAY_DOCKERFILE_PATH=Dockerfile.api` no serviço certo |
| Health check falha | Path `/v1/health`; API precisa de `PORT` do Railway |
| Prisma migrate falha / hang | `DATABASE_URL=${{Postgres.DATABASE_URL}}`; se precisar SSL: acrescenta `?sslmode=require` ao URL |
| Imagens não carregam no Figma | `PUBLIC_S3_ENDPOINT` acessível publicamente |

Guia geral: [DEPLOY.md](./DEPLOY.md).
