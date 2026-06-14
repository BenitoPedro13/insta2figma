# Worker Insta2Figma (Fases 5–6)

Consumidor **BullMQ** da fila `scrape-instagram-v1` (ver `@insta2figma/shared-contracts`). Descarrega o perfil público via **`web_profile_info`**: `HttpInstagramDataSource` + parsing defensivo, erros `IG_*` / `INTERNAL` e retries BullMQ.

Com **`S3_*`** definido (MinIO local ou S3-compat), após scrape garante os bytes no
store **content-addressed** (`ensureMediaAsset`) e grava linhas `assets` por-job que os
referenciam. O plugin filtra `kind='profile'` para **não** colocar avatar no canvas, e usa
essa URL assinada no histórico/favoritos.

## Convenção de assets no bucket (content-addressed, partilhado)

Os bytes são guardados **uma vez globalmente** (dedup por `MediaAsset.mediaKey`):

- `media/{shortcode}/0.{ext}`: capa principal do post (slot 0).
- `media/{shortcode}/{i}.{ext}`: extras de carrossel quando expandido (slots 1..N).
- `media/profile/{igUserId}.{ext}`: avatar do perfil para histórico/favoritos.

Cada `Asset` (por job) aponta para o `MediaAsset` via `mediaAssetId` e carrega
`kind`/`shortcode`/`slot` explícitos. Reuso: se os bytes já existem, **não** há download —
só se cria a referência `Asset`. O plugin decide o uso por `kind`:

- `kind='profile'` -> UI/lista (avatar)
- `kind='post'` -> canvas Figma

> Layout legado `jobs/{jobId}/thumbs/...` ainda existe em jobs antigos; plugins e billing
> fazem fallback ao parsing da `storageKey`. Ver `docs/tasks/TASK-persistent-ig-catalog-dedup.md`.

## Pré-requisitos

- Postgres + migrações (como na API)
- Redis (`pnpm infra:up` na raíz do monorepo)
- **Ligação à Internet** (pedidos ao Instagram)
- **MinIO** ou outro S3-compat (opcional; sem `S3_BUCKET` o job conclui só com `result_summary`)

## Setup rápido (recomendado)

Na raiz do monorepo:

```bash
pnpm bootstrap
```

Depois basta correr:

```bash
pnpm dev          # API + worker (raiz do monorepo)
# ou
pnpm dev:worker   # só o worker
```

## Ambiente

```bash
cp apps/worker/.env.example apps/worker/.env
```

Ajusta `DATABASE_URL`, `REDIS_URL` e (para cópias no bucket) **`S3_*`** como na API.

Sessões Instagram: `IG_SESSION_POOL` (JSON com `account`, `cookie` e `proxy` dedicado por conta) e `IG_PROXY_POOL` (proxies rotativos). Sem estas variáveis o worker faz requests sem autenticação.

O worker usa um **`globalSessionPool` singleton** partilhado com a API. As sessões são sincronizadas via Redis a cada 60 segundos — quando actualizas via `POST /admin/sessions` na API, o worker apanha a mudança sem redeploy. Guia completo: **[docs/SESSION-MANAGEMENT.md](../../docs/SESSION-MANAGEMENT.md)**.

`ALERT_WEBHOOK_URL` (opcional) — webhook Discord/Slack acionado quando uma sessão recebe 401/403.

Fallback Apify: `APIFY_TOKEN` activa o `apify~instagram-profile-scraper` quando o Instagram rate-limita.

Opcional: `IG_FETCH_TIMEOUT_MS`, `WORKER_CONCURRENCY`, `STORAGE_MAX_THUMBNAILS`.

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

Na raíz do monorepo também podes usar `pnpm dev:worker`.

O Prisma Client é gerado a partir de **`apps/api/prisma/schema.prisma`** (fonte única).

## Testes automáticos contra o Instagram (opcional)

Por omissão **`pnpm test`** no worker só corre testes **sem rede** (parser). Para acertar no endpoint real:

```bash
pnpm test:ig
# ou dentro de apps/worker: pnpm test:integration   (define RUN_IG_INTEGRATION=1)
```

Smoke rápido (imprime JSON para `stdout`; erros para `stderr`; exit 0 / 1):

```bash
pnpm ig:smoke
pnpm ig:smoke -- instagram
IG_SMOKE_USERNAME=google pnpm ig:smoke
```

Variáveis opcionais: `IG_FETCH_TIMEOUT_MS` (igual ao worker).

Successo (`jobs.result_summary`): ver `scrapeJobResultSummaryV5Schema` em **`@insta2figma/shared-contracts`** (`phase: 5`, `postsSample`, etc.). Perfis privados ou sem dados de timeline podem devolver lista vazia de posts mesmo com scrape bem-sucedido.

Falhas (`error_code`): `INSTAGRAM_JOB_ERROR_CODES` no mesmo package.
