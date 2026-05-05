# Worker Insta2Figma (Fase 5)

Consumidor **BullMQ** da fila `scrape-instagram-v1` (ver `@insta2figma/shared-contracts`). Descarrega o perfil público via **`web_profile_info`** (mesma família de pedidos que [`crawler/main.py`](../../crawler/main.py)): `HttpInstagramDataSource` + parsing defensivo, erros mapeados para `IG_*` / `INTERNAL` e **retries** só para casos `retryable` (ex.: 429, 5xx, rede).

## Pré-requisitos

- Postgres + migrações (como na API)
- Redis (`pnpm infra:up` na raíz do monorepo)
- **Ligação à Internet** (o worker faz `fetch` ao Instagram)

## Ambiente

```bash
cp apps/worker/.env.example apps/worker/.env
```

Ajusta `DATABASE_URL` e `REDIS_URL` para coincidir com a API. Opcional: `IG_FETCH_TIMEOUT_MS` (por omissão 30000), `WORKER_CONCURRENCY`.

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
