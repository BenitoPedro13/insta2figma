# ADR-005: Estratégia de cache para previews do Instagram

**Status:** Accepted  
**Date:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** scraper, instagram, cache, performance, rate-limit, redis

---

## Context

Esta é provavelmente a optimização com melhor rácio impacto/esforço para reduzir a pressão sobre o Instagram: **pedir menos vezes, não pedir mais inteligentemente.**

O scraper actual tem cache em memória com TTL de 45 segundos. Isso significa:
- Se dois utilizadores pedirem o preview de `@nike` com intervalo de 45s, são **dois** pedidos ao Instagram.
- Se um utilizador paginar o preview (página 1 → página 2 → página 1), cada página pede ao Instagram separadamente se o intervalo for >45s.
- Em dois instâncias Railway (se houver scaling), cada instância tem a sua própria cache — zero partilha.

O perfil de uso real é muito diferente dos 45s de TTL:
- Os dados de um perfil Instagram (foto, contagem de posts, feed recente) **não mudam em 5 minutos**.
- A maioria dos perfis públicos populares (os que os utilizadores do insta2figma provavelmente usam mais) não publica posts a cada 5 minutos.
- Um TTL de 5 minutos reduziria o número de pedidos ao Instagram em **5–10x** para o mesmo volume de utilizadores.

### Impacto concreto

Assumindo 500 previews/dia de 50 perfis únicos (média de 10 pedidos por perfil por dia):
- Com TTL=45s: 500 pedidos ao Instagram
- Com TTL=5min: ~100–150 pedidos ao Instagram (os pedidos dentro de 5min do anterior são servidos da cache)
- Com TTL=15min: ~50–80 pedidos ao Instagram

**Aumentar o TTL de 45s para 5 minutos reduz a pressão sobre as sessões em ~3–5x, sem qualquer outra mudança.**

---

## Problem Statement

**Qual deve ser o TTL da cache de previews, e deve a cache ser em memória (por instância) ou partilhada (Redis)?**

---

## Decision Drivers

1. **Redução de pedidos ao Instagram** — menos pedidos = menos 429 = menos pressão nas sessões.
2. **Frescura dos dados** — o utilizador não deve ver dados que estão visivelmente desactualizados.
3. **Custo de implementação** — Redis adiciona complexidade; in-memory é trivial.
4. **Escalabilidade** — se houver múltiplas instâncias, cache in-memory não partilha estado.
5. **Paginação** — páginas de preview diferentes do mesmo perfil devem ser cacheadas independentemente.

---

## Considered Options

### Opção A: Aumentar TTL in-memory (sem Redis)

**Como funciona:** manter a cache em memória existente (`Map<string, {...}>`), mas aumentar o TTL de 45s para 5 minutos (300s).

**Prós:**
- Zero complexidade adicional — um número diferente no código.
- Funciona imediatamente.
- Sem custo de infraestrutura.

**Contras:**
- Cache perdida em cada reinicio (Railway reinicia em deploys, ~1x por dia).
- Sem partilha entre instâncias se houver scaling horizontal.
- Cache máx de 128 entradas pode ser insuficiente com TTL mais longo (mais entradas activas ao mesmo tempo).

**Quando é suficiente:** uma instância Railway, sem scaling horizontal. Para o volume actual, é suficiente.

---

### Opção B: Redis com TTL configurável (recomendado a prazo)

**Como funciona:** usar o Redis já existente na stack (BullMQ usa Redis) para guardar os payloads de preview. A cache partilha estado entre instâncias e sobrevive a reinicios.

**Prós:**
- Cache persiste entre reinicios — pedidos após deploy continuam cacheados.
- Partilhada entre instâncias se houver scaling.
- Redis já existe no Railway (usado pelo BullMQ) — zero custo adicional de infraestrutura.
- TTL gerido pelo Redis nativo (sem lógica de eviction manual).

**Contras:**
- Serialização/deserialização do payload para JSON (actualmente é um objecto TypeScript em memória).
- Latência de rede para a cache (~1–5ms no Railway) em vez de acesso em memória (~0ms).
- Aumenta o acoplamento do scraper ao Redis — torna os testes mais complexos.

**Quando faz sentido:** quando houver ≥2 instâncias Railway ou quando a cache in-memory der problemas visíveis.

---

### Opção C: Cache hierárquica — in-memory L1 + Redis L2

**Como funciona:** verificar primeiro a cache in-memory (TTL curto, ex. 60s); se miss, verificar Redis (TTL longo, ex. 10min); se miss, pedir ao Instagram.

**Prós:**
- Melhor latência (L1 serve a maioria dos pedidos).
- Resiliência (se Redis estiver em baixo, L1 continua a funcionar).

**Contras:**
- Complexidade elevada para o ganho marginal. L1+L2 faz sentido em sistemas com muita carga, não com 500 previews/dia.

**Decisão:** rejeitado. Overkill para o volume actual.

---

## Decision

**Opção A agora (aumentar TTL para 5 minutos + aumentar max entries); migrar para Opção B quando houver scaling horizontal ou quando o deploy diário se provar problemático.**

### TTL escolhido: 5 minutos (300 segundos)

**Justificação:**
- 5 minutos é imperceptível para o utilizador — ninguém espera ver o post que o Instagram publicou há 4 minutos aparecer no preview.
- Reduz pedidos ao Instagram em ~5x para o mesmo volume.
- Mantém os dados suficientemente frescos para que o preview seja representativo.

**Não usar TTL > 15 minutos** porque: um utilizador que edita o perfil do Instagram e depois vai ao plugin espera que o preview reflicta as mudanças. Com >15min de cache, pode haver confusão.

### Tamanho máximo da cache

O máximo actual de 128 entradas é insuficiente com TTL mais longo (mais entradas activas ao mesmo tempo). Aumentar para **512 entradas** com eviction LRU.

Com TTL=5min e max=512: a cache pode guardar até 512 pedidos únicos (combinação de username + fetchCount + timelineOrder + page). Em uso normal, isto é mais que suficiente.

### Cache key inclui página

A cache key actual já inclui `username`, `fetchCount` e `timelineOrder`. Verificar que **também inclui o número de página** para previews paginados — cada página é um hit diferente ao Instagram e deve ser cacheada independentemente.

### Invalidação explícita

Não há invalidação explícita (sem botão "refresh" no plugin). Se o utilizador precisar de dados frescos, pode esperar 5 minutos ou mudar de username e voltar. Aceitar esta limitação é deliberado — adicionar invalidação manual adiciona complexidade para um caso de uso raro.

---

## Implementation

### Mudanças em `instagram-preview.service.ts`

```typescript
// Antes:
const PREVIEW_CACHE_TTL_MS = 45_000;

// Depois:
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutos
```

```typescript
// Antes:
if (this.previewCache.size > 128) {

// Depois:
if (this.previewCache.size > 512) {
```

### Verificar cache key inclui página

```typescript
private buildPreviewCacheKey(
  username: string,
  fetchCount: number,
  timelineOrder: 'newest_first' | 'oldest_first',
  page: number,  // ← garantir que este parâmetro está incluído
): string {
  return JSON.stringify({ username, fetchCount, timelineOrder, page });
}
```

### Migração para Redis (Opção B — implementar quando necessário)

Quando Redis for necessário, a interface de cache pode ser abstraída:

```typescript
interface PreviewCache {
  get(key: string): Promise<CachedPreviewPayload | null>;
  set(key: string, payload: CachedPreviewPayload, ttlMs: number): Promise<void>;
}

class InMemoryPreviewCache implements PreviewCache { /* ... */ }
class RedisPreviewCache implements PreviewCache { /* ... */ }
```

O `instagram-preview.service.ts` usa `PreviewCache` — a implementação é injectada pelo módulo NestJS. Trocar de in-memory para Redis é uma mudança de configuração, não de lógica.

---

## Consequences

### Positivo
- Redução imediata de ~5x nos pedidos ao Instagram sem qualquer outra mudança.
- Menos pressão nas sessões (ADR-002) — sessões duram mais.
- Menos risco de 429 em bursts de utilizadores a previsualizar o mesmo perfil.
- Zero custo de infraestrutura adicional.

### Negativo
- Dados de preview podem ter até 5 minutos de atraso.
- Cache perdida em reinicio (Railway: ~1x por dia em deploys).

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Utilizador vê dados desactualizados | Baixa | 5min é imperceptível para o caso de uso (importar imagens) |
| Cache cresce demasiado em memória | Muito baixa | 512 entradas × ~5KB payload ≈ 2.5MB — negligenciável |
| Cache in-memory insuficiente com scaling | Média (se houver scaling) | Migrar para Redis (Opção B) quando necessário |

---

## References

- `apps/api/src/instagram/instagram-preview.service.ts` — onde alterar `PREVIEW_CACHE_TTL_MS` e tamanho máximo
- ADR-002 — sessões Instagram (cache mais longa reduz pressão nas sessões)
- ADR-004 — retry/backoff (cache longa reduz necessidade de retry)
- `apps/api/src/instagram/instagram-preview.service.ts:39` — `PREVIEW_CACHE_TTL_MS = 45_000` (linha a alterar)
- `apps/api/src/instagram/instagram-preview.service.ts:484-491` — lógica de eviction (max 128 → 512)
