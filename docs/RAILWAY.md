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

> Auth completo documentado em [docs/AUTH.md](./AUTH.md).

Referências Railway (`${{...}}`) ligam plugins automaticamente.

```env
# Injetado pelo Railway
PORT=${{PORT}}

# Plugins
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Obrigatório — gera com: openssl rand -base64 48
JWT_SECRET=
JWT_EXPIRES_IN=30d

CORS_ORIGINS=

# Auth — magic link + Google OAuth (ver docs/AUTH.md)
PUBLIC_API_URL=https://<api-domain>.up.railway.app
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GMAIL_FROM=teu@gmail.com
GOOGLE_CALLBACK_URL=https://<api-domain>.up.railway.app/v1/auth/google/callback

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
POLAR_SUCCESS_URL=https://insta2figma-production.up.railway.app/v1/billing/checkout-success
POLAR_RETURN_URL=https://mainnet.design/

# Quotas
QUOTA_FREE_IMAGES_PER_MONTH=100
QUOTA_PRO_IMAGES_PER_MONTH=10000
QUOTA_MAX_IMAGES_PER_MONTH=100000
QUOTA_MAX_POSTS_PER_JOB=50
QUOTA_MAX_IMAGES_PER_JOB=100

# Sessões Instagram com proxy dedicado por conta (ver ADR-002, ADR-003)
# Cria as contas com o browser a correr pelo proxy — evita checkpoint_required
# IG_SESSION_POOL=[{"account":"bot1","cookie":"sessionid=...","proxy":"http://user:pass@host:port"},{"account":"bot2","cookie":"...","proxy":"http://user2:pass2@host:port"}]
# Alternativa sem redeploy: POST /admin/sessions (ver docs/SESSION-MANAGEMENT.md)
IG_SESSION_POOL=

# Pool de proxies rotativos para requests sem sessão (Webshare ou similar)
# IG_PROXY_POOL=["http://user:pass@p.webshare.io:80","http://user2:pass2@p.webshare.io:80"]
IG_PROXY_POOL=

# Admin endpoints (/admin/scrape-health, /admin/sessions) — gera com: openssl rand -base64 32
ADMIN_KEY=

# Webhook para alertas quando uma sessão Instagram expira (Discord/Slack/genérico)
# Discord: https://discord.com/api/webhooks/<id>/<token>
# Slack:   https://hooks.slack.com/services/<...>
ALERT_WEBHOOK_URL=

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

## 7. Sessões Instagram — criar e gerir contas

Ver guia completo em [docs/SESSION-MANAGEMENT.md](./SESSION-MANAGEMENT.md).

Resumo rápido:
1. Cria a conta com Chrome + proxy activo (evita `checkpoint_required`)
2. Extrai o cookie com Cookie-Editor + `node scripts/ig-cookie-helper.mjs cookies.json bot1 http://proxy:porta`
3. Actualiza sem redeploy: `POST /admin/sessions` com header `x-admin-key: <ADMIN_KEY>`
4. Configura `ALERT_WEBHOOK_URL` para receber alertas no Discord/Slack quando uma sessão expira

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

## 10. CI/CD via GitHub Actions (deploy sem GitHub-App do Railway)

Alternativa à integração nativa GitHub do Railway: o workflow
`.github/workflows/deploy.yml` faz deploy por `railway up` autenticado com um
**Project Token**, sem o Railway precisar de acesso ao repo.

**Setup:**
1. Railway → Project → **Settings → Tokens** → criar **Project Token** scoped ao
   environment `production`. Copiar o valor (só aparece uma vez).
2. GitHub → repo canónico → **Settings → Secrets and variables → Actions** →
   adicionar secret **`RAILWAY_TOKEN`** com esse valor.
3. **Desligar a integração nativa** GitHub nos serviços `api` e `worker`
   (Settings → Source → Disconnect).

**Regra do deploy único:** ter a integração nativa **e** o workflow activos no
mesmo push = **2 deploys**. Para garantir um só:
- desligar a integração nativa (passo 3), e
- definir o secret `RAILWAY_TOKEN` **apenas no repo canónico** — secrets não passam
  para forks, por isso sincronizar para outro remote não dispara deploy.

O workflow usa `dorny/paths-filter` para replicar os `watchPatterns`: só faz deploy
do `api`/`worker` quando os ficheiros relevantes mudam (mudanças só em `docs/` não
disparam deploy).

## Troubleshooting Railway

| Problema | Solução |
|----------|---------|
| Login overlay nunca fecha | `PUBLIC_API_URL` errado ou em falta |
| Magic link 500 | `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` em falta ou `GMAIL_FROM` vazio |
| Google OAuth 400 callback | `GOOGLE_CALLBACK_URL` não corresponde ao URI configurado no Google Cloud |
| Refresh token expirou (7 dias) | App ainda em "Testing" no Google Cloud → publicar; regenerar token em [AUTH.md](./AUTH.md) |
| `503 Polar billing is not configured` | `POLAR_ACCESS_TOKEN` em falta na API |
| `Plan pro (yearly) is not configured yet` | `POLAR_PRODUCT_ID_PRO_YEARLY` em falta |
| `checkpoint_required` no worker | Sessão criada noutro IP; cria conta com Chrome + proxy (ver secção 7) |
| Sessão inválida sem alerta | `ALERT_WEBHOOK_URL` não configurado na API |
| Sessão inválida após renovação | Usar `POST /admin/sessions` ou redeploy para recarregar pool |
| Imagens não carregam no Figma | `PUBLIC_S3_ENDPOINT=https://t3.storageapi.dev` na API; rebuild plugin |
| `S3 NÃO configurado` nos logs da API | Variáveis `wrapped-mug.*` não adicionadas ao serviço da API |
| Build usa Dockerfile errado | `RAILWAY_DOCKERFILE_PATH=Dockerfile.api` no serviço certo |
| Health check falha | Path `/v1/health`; API precisa de `PORT` do Railway |
| Prisma migrate falha | `DATABASE_URL=${{Postgres.DATABASE_URL}}`; acrescenta `?sslmode=require` se necessário |
| "Your trial is over" / deploys pausados | O trial é um **crédito único de $5** (não tempo). Esgotado com BD+Redis+bucket+2 serviços → upgrade para **Hobby ($5/mês)**. Dados não se perdem (pausado ≠ apagado) |
| Push não faz deploy | Mudança fora dos `watchPatterns` (ex.: só `docs/`); ou a fonte GitHub aponta para outro repo/branch |
| Deploy acontece 2× por push | Integração nativa GitHub **e** workflow ambos activos — desligar a nativa (ver secção 10) |

Guia geral: [DEPLOY.md](./DEPLOY.md).
