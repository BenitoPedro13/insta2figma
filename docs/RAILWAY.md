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
   - **wrapped-mug** (objeto storage t3.storageapi.dev — já no projeto)
3. Cria **dois serviços** a partir do mesmo repo:

| Serviço | Dockerfile | Config-as-code |
|---------|------------|----------------|
| `api` | `Dockerfile.api` | `/railway.api.toml` |
| `worker` | `Dockerfile.worker` | `/railway.worker.toml` |

Em cada serviço → **Settings**:

- **Build** → Dockerfile path: `Dockerfile.api` ou `Dockerfile.worker`
- **Config file path**: `/railway.api.toml` ou `/railway.worker.toml`

## 3. Variáveis — serviço `api`

Referências Railway (`${{...}}`) ligam plugins automaticamente.

```env
# Injetado pelo Railway
PORT=${{PORT}}

# Plugins
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Obrigatório — gera com: openssl rand -base64 48
JWT_SECRET=
JWT_EXPIRES_IN=7d

CORS_ORIGINS=

# Object storage (wrapped-mug — t3.storageapi.dev)
S3_ENDPOINT=${{wrapped-mug.ENDPOINT}}
PUBLIC_S3_ENDPOINT=https://t3.storageapi.dev
S3_BUCKET=${{wrapped-mug.BUCKET}}
S3_REGION=${{wrapped-mug.REGION}}
S3_ACCESS_KEY=${{wrapped-mug.ACCESS_KEY_ID}}
S3_SECRET_KEY=${{wrapped-mug.SECRET_ACCESS_KEY}}
S3_FORCE_PATH_STYLE=true
ASSET_PRESIGN_SECONDS=3600

# Polar billing
POLAR_ACCESS_TOKEN=
POLAR_WEBHOOK_SECRET=
POLAR_SERVER=production
POLAR_PRODUCT_ID_PRO_MONTHLY=
POLAR_PRODUCT_ID_PRO_YEARLY=
POLAR_PRODUCT_ID_MAX_MONTHLY=
POLAR_PRODUCT_ID_MAX_YEARLY=
POLAR_SYNTHETIC_EMAIL_DOMAIN=mailinator.com
POLAR_SUCCESS_URL=https://insta2figma.com/billing/success
POLAR_RETURN_URL=

# Quotas
QUOTA_FREE_IMAGES_PER_MONTH=100
QUOTA_PRO_IMAGES_PER_MONTH=10000
QUOTA_MAX_IMAGES_PER_MONTH=100000
QUOTA_MAX_POSTS_PER_JOB=50
QUOTA_MAX_IMAGES_PER_JOB=100

# Sessões Instagram com proxy dedicado por conta (ver ADR-002, ADR-003)
# Cria as contas com o browser a correr pelo proxy — evita checkpoint_required
# IG_SESSION_POOL=[{"account":"bot1","cookie":"sessionid=...","proxy":"http://user:pass@host:port"},{"account":"bot2","cookie":"...","proxy":"http://user2:pass2@host:port"}]
IG_SESSION_POOL=

# Pool de proxies rotativos para requests sem sessão (Webshare ou similar)
# IG_PROXY_POOL=["http://user:pass@p.webshare.io:80","http://user2:pass2@p.webshare.io:80"]
IG_PROXY_POOL=

# Fallback Apify para profile-preview quando o Instagram rate-limita
APIFY_TOKEN=
APIFY_IG_PROFILE_ACTOR=apify~instagram-profile-scraper
APIFY_TIMEOUT_MS=120000
```

Webhook Polar: `https://${{RAILWAY_PUBLIC_DOMAIN}}/v1/billing/webhooks/polar`

## 4. Variáveis — serviço `worker`

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
WORKER_CONCURRENCY=2
IG_FETCH_TIMEOUT_MS=30000

# Object storage (mesmos valores do wrapped-mug — sem PUBLIC_S3_ENDPOINT)
S3_ENDPOINT=${{wrapped-mug.ENDPOINT}}
S3_BUCKET=${{wrapped-mug.BUCKET}}
S3_REGION=${{wrapped-mug.REGION}}
S3_ACCESS_KEY=${{wrapped-mug.ACCESS_KEY_ID}}
S3_SECRET_KEY=${{wrapped-mug.SECRET_ACCESS_KEY}}
S3_FORCE_PATH_STYLE=true
STORAGE_MAX_THUMBNAILS=12
ASSET_FETCH_TIMEOUT_MS=20000

# Sessões Instagram (copiar da API — mesmo pool)
IG_SESSION_POOL=
IG_PROXY_POOL=

# Fallback Apify
APIFY_TOKEN=
APIFY_IG_PROFILE_ACTOR=apify~instagram-profile-scraper
APIFY_TIMEOUT_MS=120000
```

`PUBLIC_S3_ENDPOINT` só na API — é usado para gerar presigned URLs acessíveis pelo Figma.

## 5. Object storage — wrapped-mug (t3.storageapi.dev)

O projeto usa o plugin **wrapped-mug** do Railway (t3.storageapi.dev, S3-compatible).

- `S3_ENDPOINT` = endpoint interno do Railway (`${{wrapped-mug.ENDPOINT}}`) — usado para upload (worker) e presign (API)
- `PUBLIC_S3_ENDPOINT` = `https://t3.storageapi.dev` — domínio público que o Figma usa para fazer `fetch` das imagens assinadas
- `S3_FORCE_PATH_STYLE=true` — obrigatório para t3.storageapi.dev

O manifest do plugin inclui `https://t3.storageapi.dev` em `networkAccess.allowedDomains`.

## 6. Polar billing — setup

1. [polar.sh](https://polar.sh) → criar conta e organização
2. Products → criar planos Pro (mensal + anual) e Max (mensal + anual)
3. Settings → API Keys → gerar token → `POLAR_ACCESS_TOKEN`
4. Settings → Webhooks → Add Endpoint:
   - URL: `https://<api-domain>/v1/billing/webhooks/polar`
   - Events: `subscription.active`, `subscription.revoked`, `subscription.updated`, `customer.state_changed`, `order.created`
   - Copiar o Webhook Secret → `POLAR_WEBHOOK_SECRET`
5. Copiar IDs dos produtos para `POLAR_PRODUCT_ID_PRO_MONTHLY`, etc.

## 7. Sessões Instagram — criar contas sem checkpoint

Para evitar `checkpoint_required`, as contas de serviço devem ser criadas com o browser a correr pelo mesmo proxy que vai usar:

```bash
# Abre Chrome com o proxy da Webshare
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --proxy-server="http://user:pass@p.webshare.io:80"
```

Com o Chrome aberto assim, vai a instagram.com e cria a conta. Depois:
1. Abre DevTools → Network → faz qualquer pedido a `i.instagram.com`
2. Copia o header `Cookie` do request
3. Atualiza `IG_SESSION_POOL` no Railway com o cookie e o proxy correspondente

## 8. Verificar deploy

```bash
curl -s https://<api>.up.railway.app/v1/health
```

Resposta esperada: `{"status":"ok",...}`

Nos logs da API ao arrancar deves ver:
```
[storage-api] S3 configurado — endpoint=https://t3.storageapi.dev bucket=wrapped-mug-...
```

Se vires `S3 NÃO configurado`, confirma que as variáveis do `wrapped-mug` estão adicionadas ao serviço.

## 9. Ordem de arranque

1. Postgres + Redis healthy
2. Deploy `api` — `preDeployCommand` corre `prisma migrate deploy`
3. Deploy `worker`

Se jobs ficarem `queued`, confirma que o worker está **Running** e que `REDIS_URL` é idêntico nos dois serviços.

## Troubleshooting Railway

| Problema | Solução |
|----------|---------|
| `503 Polar billing is not configured` | `POLAR_ACCESS_TOKEN` em falta na API |
| `Plan pro (yearly) is not configured yet` | `POLAR_PRODUCT_ID_PRO_YEARLY` em falta |
| `checkpoint_required` no worker | Sessão criada noutro IP; cria conta com Chrome + proxy (ver secção 7) |
| Imagens não carregam no Figma | `PUBLIC_S3_ENDPOINT=https://t3.storageapi.dev` na API; rebuild plugin |
| `S3 NÃO configurado` nos logs da API | Variáveis `wrapped-mug.*` não adicionadas ao serviço da API |
| Build usa Dockerfile errado | `RAILWAY_DOCKERFILE_PATH=Dockerfile.api` no serviço certo |
| Health check falha | Path `/v1/health`; API precisa de `PORT` do Railway |
| Prisma migrate falha | `DATABASE_URL=${{Postgres.DATABASE_URL}}`; acrescenta `?sslmode=require` se necessário |

Guia geral: [DEPLOY.md](./DEPLOY.md).
