# ADR-007: Migrar cache de preview do Instagram de Map em memória para Redis

**Status:** Accepted  
**Date:** 2026-05-29  
**Deciders:** Benito Pedro  
**Tags:** scraper, instagram, cache, performance, redis, architecture  
**Supersedes:** ADR-005 (Opção A → Opção B)

---

## Context

ADR-005 decidiu aumentar o TTL da cache de preview de 45s para 5 minutos e aumentar o limite de entradas para 512. Esse trabalho foi implementado e o código reflecte essas decisões (`PREVIEW_CACHE_TTL_MS = 5 * 60 * 1_000`, `previewCache.size > 512` em `instagram-preview.service.ts`).

ADR-005 também identificou a migração para Redis (Opção B) como o próximo passo quando houvesse scaling horizontal ou quando o deploy diário se provasse problemático. Esse momento chegou: com a infra actual no Railway, a cada deploy a cache em memória é descartada, forçando um cold start onde todos os primeiros utilizadores após o deploy acertam no Instagram em simultâneo.

Além disso, a análise de código de 2026-05-29 identificou dois problemas adicionais na implementação actual que a migração para Redis deve resolver:

1. **Cache não partilhada entre réplicas.** A `InstagramPreviewService` guarda o estado em `private readonly previewCache = new Map<...>()` (linha 268–270). Com duas instâncias Railway (API + eventual scaling), cada instância tem a sua própria cache. O mesmo username pode gerar dois pedidos simultâneos ao Instagram a partir de réplicas diferentes.

2. **Eviction FIFO, não LRU.** O código de eviction actual (linha 612) deleta a entrada mais antiga por **inserção** (`keys().next().value`), não a menos recentemente acedida. Um perfil muito pedido pode ser eviccionado enquanto entradas nunca mais tocadas ficam na cache.

O Redis já existe como dependência obrigatória do Railway (BullMQ precisa dele). Esta migração não adiciona nova infraestrutura.

---

## Problem Statement

**Como fazer a cache de preview partilhada entre réplicas, persistente entre deploys, e com eviction correcta — sem adicionar infraestrutura nova?**

---

## Decision Drivers

1. **Cache partilhada entre réplicas** — duas instâncias da API devem servir o mesmo cache hit para o mesmo username.
2. **Persistência entre deploys** — um deploy não deve invalidar entradas com TTL ainda válido.
3. **Eviction correcta** — entradas mais recentemente usadas devem ter prioridade sobre entradas antigas, não o inverso.
4. **Payload size** — a `CachedPreviewPayload` actual inclui base64 data URLs (`profilePicDataUrl`, `postsPreview[].thumbnailUrl`). Guardá-las em Redis seria 1–3MB por entrada; com 512 entradas, até 1.5GB de memória Redis. Isto é inaceitável.
5. **Separação de conexões** — a conexão BullMQ usa `maxRetriesPerRequest: null` (obrigatório para BullMQ). Para a cache, queremos `maxRetriesPerRequest: 3` para que uma falha temporária do Redis não bloqueie o handler do preview.
6. **Sem nova infra** — Redis já existe no Railway.

---

## Considered Options

### Opção A: Manter Map em memória mas corrigir eviction (sem Redis)

**Como funciona:** substituir o `Map` por uma implementação LRU correcta (ex. `quick-lru` ou implementação manual), mantendo tudo em memória.

**Prós:**
- Zero latência de rede para leituras de cache.
- Sem complexidade de conexão Redis.

**Contras:**
- Não resolve o problema de múltiplas réplicas — cada processo continua com estado isolado.
- Cache perdida em cada deploy.
- O problema de base já foi endereçado (TTL=5min + max=512 por ADR-005) — fazer mais aqui é polish sem resolver os problemas reais.

**Decisão:** rejeitado. Não resolve os problemas identificados.

---

### Opção B: Redis usando a conexão BullMQ existente

**Como funciona:** reutilizar o `sharedRedisConnection` que o `QueueModule` cria para o BullMQ.

**Prós:**
- Zero conexões Redis adicionais.
- Simples de injectar.

**Contras:**
- A conexão BullMQ tem `maxRetriesPerRequest: null` — necessário para BullMQ mas perigoso para uso de cache: uma falha temporária do Redis faz o handler de preview esperar indefinidamente.
- Acopla o comportamento da cache ao lifecycle do BullMQ.
- BullMQ pode reservar prefixos de chave (ex. `bull:`) e usar pipelines internos que conflituam com uso geral.

**Decisão:** rejeitado. O `maxRetriesPerRequest: null` é demasiado arriscado para operações síncronas no path do utilizador.

---

### Opção C: Conexão Redis dedicada para cache, injectada via NestJS DI (recomendado)

**Como funciona:** criar um `RedisCacheModule` que instancia uma segunda conexão `ioredis` com opções adequadas para cache (timeout, retry limitado), e exporta o cliente com um token de injecção. O `InstagramPreviewService` injeta o cliente via DI.

**Prós:**
- Conexão com comportamento correcto para o contexto (timeout explícito, retry limitado).
- Separação clara de responsabilidades: BullMQ tem a sua conexão, cache tem a sua.
- DI torna testável (pode mockar o cliente Redis nos testes).
- Sem nova infraestrutura — mesma URL Redis.

**Contras:**
- Uma segunda conexão TCP ao mesmo Redis (custo negligenciável — Railway não cobra por conexões).
- Pequeno overhead de configuração (~30 linhas).

**Decisão:** adoptado.

---

### Opção D: Cache hierárquica L1 (memória) + L2 (Redis)

**Como funciona:** verificar primeiro o Map em memória (TTL 60s); se miss, verificar Redis (TTL 5min); se miss, pedir ao Instagram.

**Prós:**
- Elimina a latência de rede Redis para pedidos repetidos dentro da mesma instância.

**Contras:**
- Dobra a complexidade de implementação e de debugging.
- A latência Redis é ~1–2ms no Railway — não justifica L1 para 99% dos casos.
- Para o volume actual (centenas de previews/dia, não milhões), o ganho é imperceptível.

**Decisão:** rejeitado por overkill. Reconsiderar se latência de cache se tornar mensurável em produção.

---

## Decisão sobre o payload: o que guardar no Redis

Este é o ponto mais crítico da implementação.

A `CachedPreviewPayload` actual tem dois tipos de campos:

```
// Dados brutos do Instagram — pequenos (~5–15KB total)
username, instagramUserId, profilePicUrlHd, mediaCount, isPrivate,
parsedPosts[], nextPreviewCursor, hasNextPreviewPage, previewTotalPages, timelineOrder

// Dados derivados com base64 — grandes (1–3MB total)
profilePicDataUrl       ← avatar em base64 (~200–900KB)
postsPreview[]          ← thumbnails em base64 (~200KB × 12 = 2.4MB)
```

**Guardar os campos base64 no Redis é inaceitável** (1.5GB para 512 entradas).

**Solução: guardar apenas os dados brutos no Redis. Regenerar `postsPreview` e `profilePicDataUrl` a partir dos dados brutos quando necessário.**

Isto tem um efeito colateral positivo: abre caminho para o Improvement #3 (retornar URLs directas em vez de base64), porque a lógica de "descarregar e converter" pode ser movida para o cliente (plugin) em vez de ficar no servidor.

### Tipo `RedisCachedPreviewPayload` (subconjunto sem base64)

```ts
type RedisCachedPreviewPayload = {
  username: string;
  instagramUserId: string | null;
  profilePicUrlHd: string | null;      // URL directa, não base64
  mediaCount: number;
  isPrivate: boolean;
  parsedPosts: InstagramPostSummaryItem[];  // dados brutos, sem base64
  postsAvailable: number;
  timelineOrder: 'newest_first' | 'oldest_first';
  hasNextPreviewPage: boolean;
  nextPreviewCursor: string | null;
  previewTotalPages: number;
};
```

O campo `postsPreview: InstagramPostPreviewItem[]` (que contém base64) **não é guardado no Redis**. Quando há cache hit, `postsPreview` é regenerado a partir de `parsedPosts` via `buildIndexedPostPreview` + `inlinePostsPreviewThumbnails`.

**Tamanho estimado por entrada:** ~5–15KB. Com 512 entradas: ~7.5MB de Redis. Completamente aceitável.

---

## Decision

**Opção C: conexão Redis dedicada, guardar apenas campos brutos (sem base64).**

### Estrutura de chave

```
preview:v1:{username}:{fetchCount}:{timelineOrder}
```

Sem versão de schema no valor — se o formato mudar, basta incrementar `v1` para `v2` no prefixo.

### TTL

300 segundos (5 minutos). Alinhado com ADR-005 e com a constante `PREVIEW_CACHE_TTL_MS` já existente.

### Operação `appendPostsToCache`

O método `appendPostsToCache` (linha 876) precisa de um equivalente Redis que faça GET → merge → SET. A race condition é aceitável aqui: dois pedidos simultâneos para páginas diferentes do mesmo perfil podem sobrescrever-se mutuamente, mas o resultado é idempotente (ambos os posts acabam no próximo ciclo de cache).

```ts
async appendPostsToCache(key: string, posts: TimelinePostItem[], nextMaxId: string | null, hasNextPage: boolean): Promise<void> {
  const raw = await this.redis.get(key);
  if (!raw) return;  // entrada expirou entretanto — não reconstituir
  const cached = JSON.parse(raw) as RedisCachedPreviewPayload;
  const ttlSeconds = await this.redis.ttl(key);
  if (ttlSeconds <= 0) return;
  cached.parsedPosts = mergeUniqueTimelinePosts(cached.parsedPosts, posts);
  cached.nextPreviewCursor = normalizePreviewCursor(nextMaxId);
  cached.hasNextPreviewPage = hasNextPage || cached.parsedPosts.length < cached.mediaCount;
  await this.redis.set(key, JSON.stringify(cached), 'EX', ttlSeconds);
}
```

---

## Implementation Plan

### 1. Criar `RedisCacheModule`

Ficheiro: `apps/api/src/cache/redis-cache.module.ts`

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE_CLIENT = Symbol('REDIS_CACHE_CLIENT');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CACHE_CLIENT,
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: 3,
          enableReadyCheck: false,
          lazyConnect: true,
        }),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CACHE_CLIENT],
})
export class RedisCacheModule {}
```

Registar em `AppModule`.

### 2. Injectar `REDIS_CACHE_CLIENT` em `InstagramPreviewService`

```ts
constructor(
  private readonly telemetry: ScrapeTelemetryService,
  @Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis,
) {}
```

Remover `private readonly previewCache = new Map<...>()`.

### 3. Substituir `readCache` e `writeCache`

```ts
private async readCache(key: string): Promise<RedisCachedPreviewPayload | null> {
  try {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as RedisCachedPreviewPayload;
  } catch {
    return null;  // Redis em baixo — graceful degradation, vai ao Instagram
  }
}

private async writeCache(key: string, payload: RedisCachedPreviewPayload): Promise<void> {
  try {
    await this.redis.set(key, JSON.stringify(payload), 'EX', Math.floor(PREVIEW_CACHE_TTL_MS / 1000));
  } catch {
    // Falha silenciosa — a funcionalidade não depende do cache
  }
}
```

Notar que `readCache` e `writeCache` passam a ser `async`. Todos os callers precisam de `await`.

### 4. Adaptar `getOrFetchPreviewBase`

O método torna-se totalmente `async` (já era, mas as chamadas internas mudam):

```ts
private async getOrFetchPreviewBase(...): Promise<{ base: CachedPreviewPayload; cacheKey: string }> {
  const cacheKey = this.buildPreviewCacheKey(username, fetchCount, timelineOrder);
  const cached = await this.readCache(cacheKey);

  if (cached) {
    // Regenerar postsPreview a partir dos dados brutos (sem base64 no Redis)
    const pageOnePosts = cached.parsedPosts.slice(0, PREVIEW_PAGE_SIZE);
    const postsPreviewRaw = buildIndexedPostPreview(pageOnePosts, cached.timelineOrder, { indexStart: 1 });
    const postsPreview = await inlinePostsPreviewThumbnails(postsPreviewRaw);

    this.telemetry.record({ ..., cacheHit: true });

    return {
      cacheKey,
      base: {
        ...cached,
        postsPreview,
        profilePicDataUrl: null,  // não cacheado; será nulo em cache hits
      }
    };
  }

  const base = await this.fetchInstagramPreviewBase(username, fetchCount, timelineOrder, ctx);
  await this.writeCache(cacheKey, toRedisCachedPayload(base));
  return { base, cacheKey };
}
```

**Implicação:** em cache hits, `profilePicDataUrl` é sempre `null`. O plugin deve usar `profilePicUrlHd` (URL directa do CDN do Instagram) para o avatar quando `profilePicDataUrl` for null. Esta é também a preparação para o Improvement #3.

### 5. Remover o limite de 512 entradas

Com Redis, a eviction é gerida pelo TTL nativo e pela política `MAXMEMORY` do Redis. O código `if (this.previewCache.size > 512)` é removido.

### 6. Actualizar `InstagramModule`

```ts
import { RedisCacheModule } from '../cache/redis-cache.module';

@Module({
  imports: [RedisCacheModule],
  ...
})
export class InstagramModule {}
```

### 7. Testes

- Mockar `REDIS_CACHE_CLIENT` com um objecto que implementa `.get()`, `.set()`, `.ttl()`.
- Testar que em caso de falha do Redis (`.get()` lança), o service continua a funcionar (vai ao Instagram).
- Testar que `appendPostsToCache` não sobrescreve com array vazio se TTL expirou entretanto.

---

## Consequences

### Positivo
- Cache partilhada entre todas as réplicas Railway — elimina duplicate hits ao Instagram em scaling.
- Persiste entre deploys — TTL conta a partir da última escrita, não do startup do processo.
- Eviction por TTL nativo do Redis — correcta por definição, sem FIFO manual.
- Payload em Redis ~1000× menor do que seria com base64 (~10KB vs ~2.5MB por entrada).
- Graceful degradation: se Redis estiver em baixo, o serviço continua a funcionar (vai ao Instagram como antes).
- Abre caminho para Improvement #3: `profilePicDataUrl` já fica `null` em cache hits, o que força o plugin a suportar URL directa — comportamento que queremos de qualquer forma.

### Negativo
- Latência de leitura de cache passa de ~0ms (memória) para ~1–3ms (Redis no Railway). Para um request que demora 3–8s sem cache, este overhead é < 0.1% — imperceptível.
- `readCache` e `writeCache` tornam-se `async` — todos os callers precisam de `await`. É uma alteração de interface interna.
- Em cache hits, `profilePicDataUrl` é sempre `null`. O plugin precisa de estar preparado para usar `profilePicUrlHd` como fallback. **Verificar antes de implementar que o plugin já faz este fallback.**

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Redis fica em baixo | Muito baixa | `try/catch` em `readCache`/`writeCache` — degradação para comportamento sem cache |
| Serialização/deserialização de tipos complexos | Baixa | `RedisCachedPreviewPayload` usa apenas primitivos e arrays de objectos simples — `JSON.parse` é suficiente |
| Plugin não suporta `profilePicDataUrl: null` | Média | Verificar e corrigir antes da implementação |
| Conexão Redis extra (custo) | Muito baixa | Railway não limita conexões; ioredis reutiliza a mesma conexão TCP para múltiplos comandos |

---

## Open Questions antes da implementação

1. **O plugin usa `profilePicDataUrl` directamente ou faz fallback para `profilePicUrlHd`?** Verificar em `apps/figma-plugin/ui-src/` antes de começar — se não houver fallback, adicioná-lo primeiro.
2. **`inlinePostsPreviewThumbnails` em cache hits:** regenerar thumbnails em base64 em cada cache hit significa que a optimização de latência do cache hit é parcialmente anulada. Isto é intencional enquanto o Improvement #3 (remover base64 por completo) não for implementado. Documentar como TODO.

---

## References

- `apps/api/src/instagram/instagram-preview.service.ts:268-270` — `previewCache` (campo a remover)
- `apps/api/src/instagram/instagram-preview.service.ts:597-616` — `readCache`/`writeCache` (métodos a substituir)
- `apps/api/src/instagram/instagram-preview.service.ts:876-889` — `appendPostsToCache` (método a adaptar)
- `apps/api/src/queue/queue.module.ts` — modelo para `RedisCacheModule`
- `docs/IMPROVEMENTS.md` — backlog completo; este ADR endereça o item #1
- ADR-005 — decisão original de cache; este ADR implementa a "Opção B" que ADR-005 diferiu
- ADR-002 — sessões Instagram (cache Redis reduz pressão sobre sessões)
