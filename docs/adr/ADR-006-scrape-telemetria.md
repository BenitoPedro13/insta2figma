# ADR-006: Telemetria de operações de scraping

**Status:** Accepted  
**Date:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** observabilidade, scraping, telemetria, postgresql, analytics

---

## Context

Sem dados sobre o comportamento do scraper em produção, decisões sobre sessões, proxies e cache são cegas. Não sabemos:
- Com que frequência ocorrem 429s (e se melhoraram após proxy + cookies)
- Qual sessão está a ser mais usada / a falhar mais
- Qual a taxa de cache hit (confirmar que o TTL de 5min está a reduzir pedidos)
- Quantos retries são necessários em média
- Se o problema está concentrado em certos horários ou certos perfis

Esta telemetria é o mecanismo de feedback que permite ajustar `PREVIEW_CACHE_TTL_MS`, o número de sessões, o proxy, e o `MAX_ATTEMPTS` com dados reais em vez de intuição.

### Por que não Microsoft Clarity

Microsoft Clarity é analytics de **frontend** (heatmaps, gravações de sessão de utilizadores no browser). Não acede a eventos de backend nem a resultados de pedidos HTTP.

### Por que não PostHog, Sentry, ou logs

- **PostHog:** bom para funis de produto, fraco para métricas de infra operacional.
- **Sentry:** focado em erros e traces de performance; não agrega métricas customizadas de forma simples.
- **Logs estruturados:** queryáveis com ferramentas externas (Datadog, Papertrail), mas requerem log drain do Railway e dependência de serviço adicional.
- **PostgreSQL:** já existe na stack, zero custo adicional, queryável com SQL simples, e os dados ficam para sempre (controlamos a retenção).

---

## Problem Statement

**Como registar o resultado de cada operação de scraping de forma que seja possível medir fiabilidade, diagnosticar problemas e ajustar configurações com dados reais?**

---

## Decision

**PostgreSQL com tabela `scrape_telemetry`.**

Cada pedido ao Instagram (hit ou miss de cache, sucesso ou falha) gera um registo na tabela. O registo é **fire-and-forget** — a escrita não bloqueia a resposta ao utilizador.

---

## Schema

```prisma
model ScrapeTelemetry {
  id             String   @id @default(uuid()) @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  // O que foi pedido
  endpoint       String   // 'profile-preview' | 'feed-pagination'
  igUsername     String   @map("ig_username") // username do perfil IG (dado público)

  // Como foi feito
  sessionAccount String?  @map("session_account") // null = sem sessão configurada
  proxyUsed      Boolean  @default(false) @map("proxy_used")
  cacheHit       Boolean  @default(false) @map("cache_hit")

  // Resultado
  statusCode     Int      @map("status_code") // código HTTP da resposta IG (0 = erro de rede)
  retryCount     Int      @default(0) @map("retry_count") // quantos retries foram necessários
  latencyMs      Int      @map("latency_ms") // tempo total incluindo retries
  errorKind      String?  @map("error_kind")
  // valores: null | 'rate_limited' | 'not_found' | 'network' | 'auth' | 'unavailable'

  // Contexto do utilizador (nullable — preenchido quando disponível)
  userId         String?  @map("user_id") @db.Uuid  // FK lógica para users.id
  planTier       String?  @map("plan_tier")          // 'free' | 'pro' | 'max'

  @@index([createdAt(sort: Desc)])
  @@index([igUsername, createdAt(sort: Desc)])
  @@index([sessionAccount, createdAt(sort: Desc)])
  @@index([errorKind, createdAt(sort: Desc)])
  @@map("scrape_telemetry")
}
```

### Decisões de schema

**`igUsername` em texto simples (não hashed):** usernames do Instagram são dados públicos — qualquer pessoa pode visitar `instagram.com/username`. Não há razão de privacidade para hashear. Armazenar em texto simples permite queries como `GROUP BY ig_username`.

**`userId` como FK lógica (sem constraint):** declarar uma FK real (`@relation`) obrigaria a carregar o `User` em cada operação de telemetria, e registos de telemetria de utilizadores eliminados quebrariam a FK. FK lógica permite cruzar com `users` nas queries sem overhead de runtime.

**`statusCode = 0`:** usado quando a excepção é de rede (fetch falhou antes de receber resposta HTTP). Distingue de 429/503.

**Sem `@relation` para `users`:** a telemetria é append-only e desacoplada do core domain. Cruzamento via JOIN em queries analíticas, não via Prisma relations.

---

## Queries úteis desde o primeiro dia

### Taxa de sucesso por hora (últimas 24h)
```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*) AS total,
  SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) AS success,
  SUM(CASE WHEN error_kind = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited,
  ROUND(100.0 * SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_pct
FROM scrape_telemetry
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND cache_hit = false
GROUP BY 1 ORDER BY 1;
```

### Taxa de cache hit (confirmar ADR-005)
```sql
SELECT
  SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END)::float / COUNT(*) AS cache_hit_rate,
  COUNT(*) AS total_requests,
  SUM(CASE WHEN cache_hit THEN 0 ELSE 1 END) AS ig_requests_made
FROM scrape_telemetry
WHERE created_at > NOW() - INTERVAL '7 days';
```

### Performance por sessão (confirmar ADR-002)
```sql
SELECT
  session_account,
  COUNT(*) AS total,
  SUM(CASE WHEN error_kind = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited,
  AVG(latency_ms) AS avg_latency_ms,
  AVG(retry_count) AS avg_retries
FROM scrape_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
  AND cache_hit = false
GROUP BY session_account
ORDER BY rate_limited DESC;
```

### Latência média com e sem proxy (confirmar ADR-003)
```sql
SELECT
  proxy_used,
  COUNT(*) AS total,
  AVG(latency_ms) AS avg_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  SUM(CASE WHEN error_kind = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited
FROM scrape_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
  AND cache_hit = false
GROUP BY proxy_used;
```

### Retry count distribution (confirmar ADR-004)
```sql
SELECT
  retry_count,
  COUNT(*) AS occurrences,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM scrape_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
  AND cache_hit = false
GROUP BY retry_count ORDER BY retry_count;
```

---

## Cruzamentos futuros

Estes cruzamentos requerem `userId` preenchido na telemetria, o que já está implementado.

### 1. Taxa de erro por plano (free vs pro vs max)

**Porquê:** utilizadores pro/max têm mais previews por dia → mais pressão nas sessões → mais 429s relativos. Perceber se o problema é estrutural (todos os planos) ou de volume (só utilizadores com muito uso).

```sql
SELECT
  plan_tier,
  COUNT(*) AS total,
  SUM(CASE WHEN error_kind = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited,
  ROUND(100.0 * SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_pct
FROM scrape_telemetry
WHERE cache_hit = false
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY plan_tier;
```

**Acção derivada:** se `free` tem taxa de sucesso similar a `pro`, o problema é de infra (sessões/proxy), não de volume por utilizador.

### 2. Correlação preview-to-import (com tabela `jobs`)

**Porquê:** um preview com sucesso pode não resultar em import. Perceber o funil ajuda a priorizar: se 80% dos previews não convertem em import, investir em resiliência de import (não de preview).

```sql
SELECT
  DATE(t.created_at) AS day,
  COUNT(DISTINCT t.user_id) AS users_previewed,
  COUNT(DISTINCT j.id) AS users_imported,
  ROUND(100.0 * COUNT(DISTINCT j.id) / NULLIF(COUNT(DISTINCT t.user_id), 0), 1) AS conversion_pct
FROM scrape_telemetry t
LEFT JOIN jobs j
  ON j.user_id::text = t.user_id
  AND j.created_at::date = t.created_at::date
  AND j.status = 'succeeded'
WHERE t.created_at > NOW() - INTERVAL '30 days'
  AND t.cache_hit = false
  AND t.status_code = 200
GROUP BY 1 ORDER BY 1;
```

### 3. Custo de scraping por utilizador (com tabela `usage_counters`)

**Porquê:** saber quantos pedidos ao Instagram cada utilizador gera (mesmo com cache) permite identificar "heavy scrapers" que estão a queimar sessões para toda a gente.

```sql
SELECT
  t.user_id,
  u.plan_tier,
  COUNT(*) AS ig_requests,
  SUM(CASE WHEN t.error_kind = 'rate_limited' THEN 1 ELSE 0 END) AS caused_rate_limits,
  uc.images_used AS images_imported
FROM scrape_telemetry t
JOIN users u ON u.id::text = t.user_id
LEFT JOIN usage_counters uc ON uc.user_id::text = t.user_id
WHERE t.cache_hit = false
  AND t.created_at > NOW() - INTERVAL '30 days'
GROUP BY t.user_id, u.plan_tier, uc.images_used
ORDER BY ig_requests DESC
LIMIT 20;
```

**Acção derivada:** se um utilizador free gera 500 pedidos/dia (paginação excessiva), pode justificar um rate limit por utilizador na API (Fase 8).

### 4. Impacto de deploys (correlação com eventos de reinício)

**Porquê:** cada deploy Railway reinicia o serviço → cache in-memory limpa → spike de pedidos ao Instagram nos primeiros minutos. Com a telemetria, é possível medir o impacto real.

```sql
SELECT
  date_trunc('minute', created_at) AS minute,
  COUNT(*) AS requests,
  SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) AS cache_hits
FROM scrape_telemetry
WHERE created_at BETWEEN '2026-05-29 14:00' AND '2026-05-29 14:30'  -- janela de deploy
GROUP BY 1 ORDER BY 1;
```

**Acção derivada:** se o spike pós-deploy for significativo, migrar cache para Redis (ADR-005 Opção B) elimina o problema.

---

## Retenção de dados

**Proposta:** manter 90 dias de telemetria. Dados mais antigos têm pouco valor operacional (as configurações mudam) e a tabela pode crescer rapidamente em volume alto.

Implementar com um cron job PostgreSQL ou uma migration futura que limpe `WHERE created_at < NOW() - INTERVAL '90 days'`.

Por agora, sem limpeza automática — a tabela vai crescer, mas a ~1KB por registo e 500 pedidos/dia seriam ~45MB em 90 dias, negligenciável.

---

## Consequences

### Positivo
- Decisões sobre sessões, proxy, cache e retries baseadas em dados reais.
- Diagnóstico de problemas sem depender de utilizadores a reportar.
- Funil completo preview → import disponível quando `userId` estiver preenchido.
- Zero custo adicional de infraestrutura.

### Negativo
- Cada pedido ao Instagram gera um `INSERT` adicional ao PostgreSQL (mas é fire-and-forget, sem impacto na latência do utilizador).
- A tabela cresce indefinidamente sem política de retenção (resolver em iteração futura).

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| `INSERT` falha e não é detectado | Baixa | Log de erro no catch; não afecta scraping |
| Tabela cresce demasiado | Baixa (90 dias, volume actual) | Implementar limpeza automática quando necessário |
| `userId` nulo por omissão | Baixa | Garantir que o controller sempre passa `callerUserId` |

---

## References

- `apps/api/prisma/schema.prisma` — adicionar `ScrapeTelemetry` model
- `apps/api/src/instagram/instagram-telemetry.service.ts` — ficheiro a criar
- `apps/api/src/instagram/instagram-preview.service.ts` — integrar telemetria
- ADR-002 — sessões (telemetria confirma eficácia)
- ADR-003 — proxy (telemetria confirma eficácia)
- ADR-004 — retry (telemetria mede distribuição de retries)
- ADR-005 — cache (telemetria mede taxa de hit)
