# Arquitetura Insta2Figma — Documento de referência para implementação

**Versão:** 1.1  
**Audiência:** humanos e LLMs que implementam o sistema.  
**Regra:** este documento define decisões **obrigatórias** salvo onde estiver marcado como *opcional* ou *fase posterior*.

> Nota de alinhamento com o estado do repo: a UI do plugin já não expõe campos de conexão (`API base`/`email`). Essas configurações são geridas no main thread do plugin e devem evoluir para gestão de sessão/settings sem poluir o fluxo de produto.

---

## 1. Visão do produto

### 1.1 O que se está a construir

Um produto que permite a utilizadores autenticados (via plugin Figma e, idealmente, uma app web de conta):

1. Pedir dados e media de perfis/publicações do **Instagram** com base em **username** (e extensões futuras: URL de post, intervalo, etc.).
2. Receber resultados estruturados e inserir **imagens/layouts no Figma**.
3. Operar sob **controlos de uso** (quotas por período ou créditos) e **pagamento** (subscrição ou packs via Stripe).

### 1.2 O que não é objetivo inicial

- Violação explícita dos termos de serviço de terceiros; o sistema deve ser desenhado assumindo **instabilidade** e **mudanças** do Instagram.
- Crawl síncrono longo dentro de um único pedido HTTP do plugin (proibido na arquitetura alvo).
- Guardar credenciais de Instagram de utilizadores finais no servidor (não faz parte do desenho base).

---

## 2. Princípios arquiteturais (obrigatórios)

Estes princípios **devem** ser seguidos em qualquer implementação gerada a partir deste documento:

| Princípio | Descrição |
|-----------|-----------|
| **Separação API / trabalho pesado** | A API HTTP apenas valida, persiste estado, enfileira e devolve identificadores. O scrape e download de media executam **fora** do ciclo do request de criação do job, num **worker**. |
| **Assincronismo via fila** | Criação de trabalho de scrape = mensagem numa **fila** com retries e backoff; o cliente (plugin) faz **polling** ou equivalente até o job terminar. |
| **Contratos explícitos** | Tipos/DTOs ou OpenAPI partilhados entre plugin, API e worker (`packages/shared-contracts` ou similar). Sem “payload solto” sem schema. |
| **Secrets só no servidor** | Chaves Stripe, Redis, DB, etc. **nunca** no código do plugin nem em repos públicos sem gestão de secrets. |
| **Idempotência onde há dinheiro** | Criação de uso faturável ou consumo de créditos deve ser **determinística** (ex.: idempotency key no pedido ou deduplicação por chave natural do job). |
| **URLs de media controladas pelo backend** | O plugin deve preferencialmente consumir **URLs assinadas** (curta duração) ou blobs servidos pelo teu domínio/storage — não depender indefinidamente de URLs brutas do CDN Instagram sem estratégia de cache/TTL. |

---

## 3. Diagrama lógico do sistema

```
┌─────────────────┐     HTTPS (JWT/session)      ┌──────────────────────────────┐
│  Figma Plugin   │ ───────────────────────────► │  API NestJS (apps/api)       │
│  (apps/figma-   │                               │  - Auth / Users              │
│   plugin)       │ ◄─────────────────────────── │  - Quotas / Usage            │
└─────────────────┘     JSON + URLs assinadas     │  - Jobs (CRUD + status)      │
                                                  │  - Stripe webhooks           │
                                                  └──────────────┬───────────────┘
                                                                 │
                                                         enqueue │
                                                                 ▼
                                                  ┌──────────────────────────────┐
                                                  │  Redis + BullMQ              │
                                                  └──────────────┬───────────────┘
                                                                 │
                                                         consume │
                                                                 ▼
                                                  ┌──────────────────────────────┐
                                                  │  Worker (apps/worker)        │
                                                  │  TypeScript / Node           │
                                                  │  - Scrape IG (HTTP + parse)   │
                                                  │  - Persist result metadata    │
                                                  │  - Upload opcional → Object   │
                                                  │    Storage (S3/R2 compatível) │
                                                  └──────────────┬───────────────┘
                                                                 │
                                                                 ▼
                                               ┌────────────────────────────────┐
                                               │ PostgreSQL + Object Storage      │
                                               └────────────────────────────────┘
```

**Nota para LLMs:** não substituir BullMQ por processamento “fire-and-forget” só com `setImmediate`/`Promise` sem fila persistente, salvo modo de desenvolvimento local explicitamente isolado.

---

## 4. Monorepo — estrutura obrigatória

### 4.1 Porquê monorepo

- Um único contrato de tipos entre plugin, API e worker.
- CI/CD coerente (lint, testes, builds por pacote).
- O plugin Figma **pode** viver dentro do monorepo: o que o Figma importa é o artefato **`dist/`** com `manifest.json` válido, não a raiz do Git.

### 4.2 Layout de pastas (normativo)

```
/
  apps/
    api/                 # NestJS — HTTP + webhooks Stripe + publicação na fila
    worker/              # NestJS context ou Node — apenas consumidores BullMQ + scrape
    figma-plugin/        # Plugin Figma (TypeScript → compila para code.js + ui)
  packages/
    shared-contracts/    # Tipos Zod/OpenAPI/types compartilhados
    shared-config/       # tsconfig/eslint base (opcional mas recomendado)
  docs/
    ARQUITETURA-INSTA2FIGMA.md   # decisões obrigatórias (este ficheiro)
    IMPLEMENTATION.md            # plano incremental por fases (tarefas)
```

### 4.3 Gestor de pacotes e tarefas

- **pnpm** workspaces (recomendado) ou npm/yarn com workspaces.
- **Turborepo** (recomendado) para `build`, `lint`, `test` em cache entre pacotes.

**Regra:** cada `app` tem o seu `package.json` e script de build que produz saída previsível (`dist`).

### 4.4 Build do plugin Figma

- O ficheiro `manifest.json` do plugin deve apontar para `main` e `ui` **relativos ao diretório publicado** (normalmente `dist/`).
- Documentar no README do pacote `figma-plugin`: “Import plugin from manifest” → caminho para `apps/figma-plugin/dist/manifest.json`.
- **Proibido** exigir que o utilizador copie código fonte manualmente para fora do monorepo para publicar; o pipeline gera o zip/artefato.

---

## 5. Stack tecnológica — escolhas e justificativas

### 5.1 API: NestJS (`apps/api`)

**Escolha:** NestJS.

**Porquê:**

- Estrutura modular (módulos, guards, interceptors) adequada a **Auth**, **Billing**, **Rate limiting**, **Validation** (class-validator / Zod pipe).
- Ecossistema maduro para integrar **BullMQ** (`@nestjs/bullmq`) e **TypeORM/Prisma/Drizzle** com padrões previsíveis.
- Adequado a equipas e a geração de código por LLM com convenções estáveis.

**Obrigatório no Nest:**

- Validação de input em DTOs (whitelist, forbidUnknownValues onde aplicável).
- Módulos separados conceitualmente: `Auth`, `Users`, `Jobs`, `Billing` (Stripe), `Health`, `Queue` (produtores).

### 5.2 Base de dados: PostgreSQL

**Escolha:** PostgreSQL.

**Porquê:**

- Transações ACID para **quota + job + usage** coerentes.
- Bons moldes para **idempotência** e relatórios de uso.

ORM/query builder: **Prisma** ou **Drizzle** (escolha uma; documentar no README da API). LLM: preferir uma só camada de persistência, sem SQL espalhado sem migrations.

### 5.3 Fila: Redis + BullMQ

**Escolha:** Redis com **BullMQ**.

**Porquê:**

- Desacopla latência do Instagram da API.
- Suporta **retries**, **backoff**, **dead-letter** (filas falhadas), **concurrency** configurável por worker.
- Integração direta com NestJS.

**Regras:**

- Nome de filas **estáveis** e versionados se necessário (`scrape-instagram-v1`).
- Jobs BullMQ devem carregar um `jobId` de negócio (UUID na tabela `jobs`) para correlação logs/DB.

### 5.4 Worker: TypeScript em Node (`apps/worker`)

**Escolha preferida:** Worker em **TypeScript**, mesmo runtime que a API.

**Porquê:**

- Partilha de `packages/shared-contracts`.
- Deploy homogéneo (um único tipo de container/runtime).
- O scrape descrito (HTTP + JSON) não exige Python.

**Quando aceitar Python (exceção):** apenas se existir requisito documentado (ex.: automação browser headless que a equipa prefira em Python). Se isso acontecer, o worker Python deve consumir a **mesma fila Redis** com o **mesmo payload** serializado — sem duplicar regras de negócio fora da API.

### 5.5 Object storage: S3-compatible (R2, S3, MinIO)

**Escolha:** armazenamento compatível com S3.

**Porquê:**

- URLs assinadas com TTL para o plugin.
- Menor dependência de links externos que expiram ou bloqueiam hotlinking de formas imprevisíveis.

**Política:** definir TTL e limpeza (lifecycle) ou política de retenção por plano.

### 5.6 Pagamentos: Stripe

**Escolha:** Stripe (Billing e/ou Payment Links + webhooks).

**Porquê:**

- Padrão de mercado; webhooks bem documentados.
- Nest: módulo dedicado com **verificação de assinatura** do webhook (raw body).

### 5.7 Plugin Figma: TypeScript

**Escolha:** manter plugin em TS; UI mínima.

**Porquê:**

- Alinhamento com contratos partilhados (tipos de resposta da API).
- Build com `esbuild` ou `tsc` conforme template; o documento não prescreve o bundler desde que o `manifest` e permissões de rede estejam corretos.

**Rede:** o `manifest.json` deve listar apenas domínios necessários (API + storage), evitando `*` em produção.

### 5.8 Autenticação (recomendação forte)

**Escolha recomendada:** OAuth2/OIDC ou fluxo **device / browser** que resulta num **access token** de curta duração + **refresh token** armazenado de forma segura; ou **API keys** para MVP controlado.

**Porquê:**

- Plugin corre em sandbox Figma; UX de login via browser é comum.

**Regra:** não implementar “login com password” no plugin sem avaliação de risco; preferir provedor ou fluxo já testado.

---

## 6. Modelo de domínio e dados (mínimo normativo)

LLMs devem implementar entidades equivalentes (nomes podem variar, relações não):

### 6.1 `users`

- `id` (UUID)
- `email` (único, se aplicável)
- `stripe_customer_id` (nullable)
- `plan_tier` ou relação com `subscriptions`
- `created_at`, `updated_at`

### 6.2 `subscriptions` (se Billing)

- `user_id`
- `stripe_subscription_id`
- `status` (`active`, `canceled`, `past_due`, …)
- `current_period_end`

### 6.3 `usage_counters` ou `usage_events`

Duas estratégias válidas (escolher uma e documentar):

- **Agregados:** contadores por utilizador e período (rápido para quota).
- **Event sourcing leve:** tabela append-only `usage_events` + materialização opcional.

**Regra:** todo job que consuma quota deve registar **atomicamente** com o job (transação).

### 6.4 `jobs`

- `id` (UUID)
- `user_id`
- `type` (`SCRAPE_PROFILE`, `SCRAPE_POSTS`, …)
- `input` (JSON validado — ex.: `{ username: string }`)
- `status` (`queued`, `running`, `succeeded`, `failed`, `canceled`)
- `result_summary` (JSON enxuto — metadados, contagens)
- `result_storage_prefix` ou lista de `asset_id` (referências a object storage)
- `error_code` / `error_message` (sanitizados para o cliente)
- `idempotency_key` (opcional mas recomendado)
- timestamps: `created_at`, `started_at`, `finished_at`

**Índices:** `(user_id, created_at)`, `(status, created_at)`.

### 6.5 `assets` (opcional mas recomendado)

- `id`, `job_id`, `content_type`, `storage_key`, `byte_size`, `expires_at`

---

## 7. Contrato API ↔ plugin (normas)

### 7.1 Endpoints mínimos

- `POST /v1/jobs` — cria job; body com `type`, `input`, opcional `idempotency-key` header.
- `GET /v1/jobs/:id` — estado e resultados (sem secrets).
- `GET /v1/me` ou `GET /v1/usage` — quotas restantes (para exibir na UI).

**Respostas:** sempre JSON com envelope coerente (ex.: `{ data, error }`).

### 7.2 Erros

- Usar HTTP codes corretos; mensagens ao cliente **não** devem vazar stack traces ou HTML de terceiros.

### 7.3 Versionamento

- Prefixo `/v1/` obrigatório desde o primeiro release interno.

---

## 8. Fluxos detalhados

### 8.1 Criar job de scrape

1. Plugin envia `POST /v1/jobs` com token.
2. API: autentica, valida input, verifica quota.
3. API: em **transação**: cria linha `jobs` com `queued`, regista uso reservado ou decrementa créditos conforme política.
4. API: `queue.add('scrape-instagram-v1', { jobId })` com attempts/backoff definidos.
5. Resposta imediata: `202 Accepted` ou `201` com `{ jobId, status: "queued" }` (escolher um padrão e manter).

### 8.2 Processar job (worker)

1. Worker recebe mensagem BullMQ.
2. Carrega `jobs` por `jobId`; se não `queued`, tratar como idempotente (log e ack).
3. Atualiza `running` + `started_at`.
4. Executa scrape TS (HTTP, parse, validação).
5. Opcional: download de media → upload storage → gravar `assets`.
6. Atualiza `succeeded` + `result_*` ou `failed` com `error_code` mapeado (ex.: `IG_RATE_LIMIT`, `IG_NOT_FOUND`, `INTERNAL`).

### 8.3 Plugin a aguardar resultado

- Polling exponencial modesto sobre `GET /v1/jobs/:id` até terminal; respeitar `Retry-After` se implementado.

### 8.4 Stripe

- Webhook verifica assinatura.
- Atualiza `subscriptions` e `plan_tier` / limites derivados.
- Eventos tratados com **idempotência** (Stripe reenvia webhooks).

---

## 9. Lógica de scrape (Instagram) — política de implementação

**Assunção:** endpoints e comportamento do Instagram mudam; o código deve ser **defensivo**.

**Obrigatório:**

- Timeouts explícitos em HTTP.
- Limite de concorrência por worker.
- Modelo de erro com classificação (`retryable` vs `non-retryable`).
- Logging com `jobId` correlacionado.

**Proibido:**

- Guardar sessões pessoais de utilizadores sem base legal e design de segurança explícitos.
- Bloquear o event loop com CPU pesada (offload parsing grande se necessário).

**Extensibilidade:** isolar “provider Instagram” atrás de interface `InstagramDataSource` para, no futuro, trocar implementação sem alterar worker completo.

---

## 10. Segurança e compliance

- CORS restrito aos domínios necessários (API); plugin Figma usa `fetch` para a tua API conforme manifest.
- Rate limit por `user_id` e IP na API (Nest Throttler ou gateway).
- Sanitização de logs (não logar tokens completos).
- Política de retenção de media alinhada com RGPD se houver dados pessoais ( thumbnails, bios, etc.).
- Secrets via env / gestor de secrets (nunca commit).

---

## 11. Observabilidade

**Mínimo:**

- Logs estruturados (JSON) com `jobId`, `userId`, `correlationId`.
- Métricas: tempo médio de job, taxa de falha por `error_code`, profundidade da fila.

**Opcional:** OpenTelemetry export para APM.

---

## 12. Ambientes e configuração

- `.env.example` por app (`api`, `worker`) com todas as variáveis documentadas.
- `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `STRIPE_*`, `S3_*`, `JWT_*` ou equivalente.

---

## 13. Roadmap de implementação (ordem sugerida para LLMs)

Para **desdobramento em tarefas, critérios de conclusão e dependências entre fases**, consultar também [IMPLEMENTATION.md](IMPLEMENTATION.md). A lista seguinte mantém-se como referência rápida (deve estar alinhada com esse guia).

1. Monorepo + `shared-contracts` + builds vazios funcionais.
2. PostgreSQL + migrations + modelo `users`, `jobs`.
3. API Nest: auth MVP + `POST/GET jobs` sem fila (só DB) — **apenas para teste local**, depois substituir por fila.
4. Redis + BullMQ + worker que marca estados e simula scrape.
5. Scrape real TS com erros classificados + limites.
6. Object storage + URLs assinadas + plugin consome resultado.
7. Stripe + quotas reais.
8. Hardening CORS, domínios do manifest, rate limits, DLQ.

---

## 14. Checklist anti-padrões (LLMs devem evitar)

- [ ] Scrape inline no handler do `POST /jobs` em produção.
- [ ] Sem transação entre quota e criação de job.
- [ ] `manifest.json` com `allowedDomains: ["*"]` em produção sem justificativa auditada.
- [ ] Tipos duplicados à mão entre plugin e API (sem package partilhado).
- [ ] Webhook Stripe sem verificação de assinatura.
- [ ] Retry ilimitado contra Instagram sem backoff/jitter.

---

## 15. Glossário

| Termo | Significado |
|-------|-------------|
| **Job** | Unidade de trabalho assíncrono com estado persistido e processada pelo worker. |
| **BFF** | Backend for frontend — API moldada às necessidades do plugin. |
| **URL assinada** | URL temporária gerada pelo storage para download privado. |

---

**Fim do documento.** Qualquer alteração estrutural (ex.: remover fila, unificar worker na API) deve ser reflectida aqui antes de ser implementada, para manter consistência entre equipa e ferramentas automatizadas.
