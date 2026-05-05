# Worker Insta2Figma (Fases 5–6)

Consumidor **BullMQ** da fila `scrape-instagram-v1` (ver `@insta2figma/shared-contracts`). Descarrega o perfil público via **`web_profile_info`**: `HttpInstagramDataSource` + parsing defensivo, erros `IG_*` / `INTERNAL` e retries BullMQ.

Com **`S3_*`** definido (MinIO local ou S3-compat), após scrape faz **upload** da foto de perfil e até `STORAGE_MAX_THUMBNAILS` thumbnails para o bucket, cria linhas **`assets`** e define `jobs.result_storage_prefix` (`jobs/{jobId}/`).

## Pré-requisitos

- Postgres + migrações (como na API)
- Redis (`pnpm infra:up` na raíz do monorepo)
- **Ligação à Internet** (pedidos ao Instagram)
- **MinIO** ou outro S3-compat (opcional; sem `S3_BUCKET` o job conclui só com `result_summary`)

## Ambiente

```bash
cp apps/worker/.env.example apps/worker/.env
```

Ajusta `DATABASE_URL`, `REDIS_URL` e (para cópias no bucket) **`S3_*`** como na API. Opcional: `IG_FETCH_TIMEOUT_MS`, `WORKER_CONCURRENCY`, `STORAGE_MAX_THUMBNAILS`.

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
