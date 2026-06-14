# TASK — Persistent Instagram Catalog + Global Media Dedup

> **Objetivo de uma frase:** deixar de tratar cada scrape/import como descartável.
> Persistir, na nossa infra (Postgres + S3), um **catálogo de posts** e um **store
> de imagens content-addressed** partilhado por todos os utilizadores, de forma a
> usar o **mínimo possível de pedidos ao Instagram** (direto ou via proxies/Apify)
> e **nunca descarregar a mesma imagem duas vezes**.

Documento de design + plano de implementação. Escrito para ser executado por um
agente sem contexto prévio — por isso inclui o estado atual em detalhe, os
algoritmos, os edge cases e a ordem de implementação por fases.

---

## 1. Cenário actual

### 1.1. Preview (procurar um perfil)

`GET /v1/instagram/profile-preview` → `InstagramController.getProfilePreview`
→ `InstagramPreviewService.getProfilePreview`
(`apps/api/src/instagram/instagram-preview.service.ts`).

Camadas atuais:

- **L1 — Redis** (`PREVIEW_CACHE_TTL_MS = 15min`, revalidação após 5min via
  stale-while-revalidate). Chave: `JSON.stringify({ username, fetchCount, timelineOrder })`.
  Guarda `RedisCachedPreviewPayload` (sem base64). É **efémero** — TTL 15min.
- **L2 — Instagram direto** (`fetchInstagramPreviewDirect`): chama
  `https://i.instagram.com/api/v1/users/web_profile_info/?username=…` (≤12 posts),
  e em paralelo a página 1 do feed `/api/v1/feed/user/<id>/` + avatar. Paginação
  posterior (página 2+) via `fetchTimelinePageByFeedMaxId` com `max_id` cursors,
  guardando cursors em `pageCursors` no Redis.
- **L3 — Apify fallback** (`ApifyPreviewSource` / `FallbackPreviewSource`): quando
  `APIFY_*` configurado.

A preview devolve `postsPreview[].thumbnailUrl` com **URLs CDN do Instagram
diretas** (efémeras — expiram em horas), que o browser carrega via `<img>` ou via
proxy `GET /v1/instagram/image?url=…`.

**Problema:** o Redis é o único armazenamento e expira em 15min. Passado esse
tempo, a próxima procura do mesmo perfil volta a bater no Instagram. Não há nada
persistente. Se 100 utilizadores procuram `nike` ao longo do dia, fazemos dezenas
de scrapes idênticos.

### 1.2. Import (colocar posts no canvas)

`POST /v1/jobs` → `JobsService.create` → fila BullMQ → worker
`processInstagramScrapeJob` (`apps/worker/src/instagram/scrape-runner.ts`):

1. `HttpInstagramDataSource.fetchProfilePostsSample` faz **novo scrape** ao
   Instagram (web_profile_info + paginação de feed até `fetchCount`), produzindo
   `ScrapeJobResultSummaryV5` (`profile` + `postsSample[]`).
2. `uploadScrapeAssets` (`apps/worker/src/storage/upload-scrape-assets.ts`)
   **descarrega cada imagem** e faz `PUT` para S3 em
   `jobs/<jobId>/thumbs/<slug>.<ext>` (+ `jobs/<jobId>/profile.<ext>`), criando uma
   linha `Asset` por objeto (`Asset.jobId`, `onDelete: Cascade`).
3. `GET /v1/jobs/:id?include=signedAssets` → `JobsService.getOne` assina as keys S3
   (`StorageService.signGetObjects`) e devolve `signedAssets[]`.
4. Os plugins colocam as imagens no canvas.

**Problema:** o armazenamento é **por job**. Se o user B importa o mesmo post que
o user A já importou, o worker:
- volta a fazer scrape ao Instagram (gasta sessão/proxy/Apify), e
- volta a descarregar **bytes idênticos** e escreve uma **segunda cópia** em S3.

As imagens do Instagram são **imutáveis** — re-descarregar é puro desperdício de
banda e de storage.

### 1.3. Identificador estável

O `shortcode` (o id em `instagram.com/p/<shortcode>/`) é globalmente único e
estável por post. Cada slide de carrossel é o slot `0..N-1` (slot 0 = cover/1ª
imagem). O par `(shortcode, slot)` mapeia para **bytes imutáveis** → é a chave de
content-addressing natural. (As URLs CDN do IG **não** servem como chave: têm
parâmetros de assinatura que expiram e variam por host/tamanho.)

### 1.4. Acoplamentos atuais à STRING `storageKey` (⚠️ críticos)

Quatro consumidores fazem parsing do formato textual da key `jobs/<jobId>/thumbs/<slug>.<ext>`
— mudar o layout físico das keys **parte-os** se não forem migrados:

| # | Local | Lógica | Depende de |
|---|-------|--------|-----------|
| 1 | `apps/figma-plugin/src/code.ts` `parseThumbSlugFromStorageKey` (linha ~262) + deteção de avatar (linha ~1119) | agrupa carrossel por post; identifica avatar | regex `/\/thumbs\/([^/]+)\.[a-z0-9]+$/i` e `/\/profile\.[a-z0-9]+$/i`; slug `^(.+)_(\d+)$` → `postKey`+`slot` |
| 2 | `apps/framer-plugin/src/FramerHost.ts` `parseThumbSlug` (linha 11) + avatar (linha 637/728) | idem | idem |
| 3 | `apps/worker/src/plan/quota-usage.ts` `countBillableJobImages` (linha 44) | conta imagens faturáveis | `storageKey.includes('/thumbs/')` |
| 4 | (API só faz passthrough — não faz parsing) | — | — |

**Conclusão:** vamos **deixar de codificar semântica no path** e passar a carregar
metadados explícitos (`kind`, `shortcode`, `slot`) na linha `Asset` e no
`JobSignedAssetDto`. Os plugins e o billing passam a ler esses campos, com
**fallback** ao parsing antigo para jobs já existentes.

### 1.5. `takenAt` (timestamp do post) NÃO é parseado hoje

Nem `parseTimelineSampleFromUserNode` (nós graphql, campo `taken_at_timestamp`),
nem `parseFeedItems` (feed, campo `taken_at`), nem o cliente Apify (`post.timestamp`)
extraem o timestamp. **É indispensável** para (a) ordenar o catálogo por
recência e (b) detetar "posts novos no topo" de forma incremental. Tem de ser
adicionado a `TimelinePostItem` e aos 3 parsers.

---

## 2. Objetivo: garantias de "pedidos mínimos ao Instagram"

Estado final desejado (com catálogo quente):

| Cenário | Pedidos ao IG (direto/proxy/Apify) | Downloads de imagem |
|---------|-----------------------------------|---------------------|
| Repetir preview do mesmo perfil dentro de `REFRESH_TTL` (5min) | **0** | 0 |
| Preview após TTL, sem posts novos | **1** (web_profile_info "top-check") | 0 |
| Preview após TTL, com 1 post novo | **1** | só o 1 post novo |
| Preview após TTL, com N>12 posts novos | ⌈N/12⌉ páginas (limitado por `MAX_INCREMENTAL_PAGES`) | só os posts novos |
| Scroll para páginas **já em catálogo** | **0** | 0 |
| Scroll para além do catálogo (posts antigos) | só as páginas em falta, depois cacheadas para sempre | só os posts antigos |
| Import de posts já em catálogo | **0** | **0** (reuso de `MediaAsset`) |
| Mesma imagem em vários posts/jobs/users | — | **1× global, para sempre** |

Princípio: **L1 Redis** (muito quente) → **L2 Postgres catálogo** (durável) →
**L3 Instagram/Apify** (só para o que é genuinamente novo no topo, ou antigo ainda
não cacheado).

---

## 3. Arquitetura proposta

### 3.1. Três camadas de leitura

```
getProfilePreview()
  ├─ L1: Redis exact-response cache (mantém-se; hot path, 15min SWR)
  │     hit → devolve já
  ├─ L2: Postgres catálogo (IgProfile + IgPost + MediaAsset)
  │     ├─ "top-check" incremental (1 pedido IG) se passou REFRESH_TTL
  │     ├─ serve posts de IgPost ordenados por takenAt desc, imagens = URLs S3 assinadas
  │     └─ deep-scroll: se a página pedida ultrapassa o catálogo, faz backfill
  │        descendente (feed max_id) e persiste
  └─ L3: Instagram direto / Apify (só chamado por L2 para novidades)
```

### 3.2. Store de imagens content-addressed (global, partilhado)

- Bytes guardados **uma vez** em `media/<shortcode>/<slot>.<ext>`
  (avatar: `media/profile/<igUserId>.<ext>`).
- Tabela `MediaAsset` (chave única `mediaKey`) é a fonte de verdade do "já temos
  estes bytes". `lastUsedAt` permite GC.
- Independente do ciclo de vida dos jobs — apagar um `Job` **não** apaga o objeto
  partilhado (prefixo diferente; cascade só apaga a linha `Asset` de referência).

### 3.3. Normalização do slot 0 (corrige ineficiência atual)

Hoje o cover de um post não-expandido tem slug `shortcode`, mas expandido tem
`shortcode_0` → **dois downloads do mesmo cover**. No novo modelo:
**slot 0 = cover / 1ª imagem, sempre**. Import não-expandido usa só slot 0;
expandido usa slots `0..N-1`. Um só `MediaAsset(shortcode, slot=0)` serve ambos.

---

## 4. Modelo de dados (Prisma)

Ficheiro: `apps/api/prisma/schema.prisma`.
Migração: `pnpm --filter @insta2figma/api exec prisma migrate dev --name persistent_ig_catalog`
(gera `apps/api/prisma/migrations/<ts>_persistent_ig_catalog`).

> ⚠️ O **worker** usa o mesmo `@prisma/client` (via `apps/api/prisma`). Confirmar
> que `prisma generate` corre para ambos (ver `package.json` da api/worker).

### 4.1. `MediaAsset` (novo) — bytes content-addressed

```prisma
model MediaAsset {
  id          String   @id @default(uuid()) @db.Uuid
  /// "<shortcode>:<slot>" para imagens de post; "profile:<igUserId>" para avatares.
  mediaKey    String   @unique @map("media_key")
  kind        String   // 'post' | 'profile'
  shortcode   String?  // null em avatares
  slot        Int      @default(0)
  contentType String   @map("content_type")
  storageKey  String   @map("storage_key") // media/<shortcode>/<slot>.<ext> | media/profile/<igUserId>.<ext>
  byteSize    BigInt   @map("byte_size")
  width       Int?
  height      Int?
  sourceUrl   String?  @db.Text @map("source_url") // última URL CDN vista (debug)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  lastUsedAt  DateTime @default(now()) @map("last_used_at") @db.Timestamptz(6)

  assets Asset[]

  @@index([shortcode])
  @@index([lastUsedAt])
  @@map("media_assets")
}
```

### 4.2. `IgProfile` (novo) — metadados + high-water marks

```prisma
model IgProfile {
  id              String    @id @default(uuid()) @db.Uuid
  username        String    @unique // normalizado (lowercase, sem @)
  igUserId        String?   @unique @map("ig_user_id")
  fullName        String?   @map("full_name")
  biography       String?   @db.Text
  followerCount   Int       @default(0) @map("follower_count")
  followingCount  Int       @default(0) @map("following_count")
  mediaCount      Int       @default(0) @map("media_count")
  isPrivate       Boolean   @default(false) @map("is_private")
  isVerified      Boolean   @default(false) @map("is_verified")
  profileMediaKey String?   @map("profile_media_key") // → MediaAsset.mediaKey do avatar
  // marcas de água p/ scrape incremental:
  newestPostAt    DateTime? @map("newest_post_at") @db.Timestamptz(6)
  newestShortcode String?   @map("newest_shortcode")
  oldestPostAt    DateTime? @map("oldest_post_at") @db.Timestamptz(6)   // até onde o catálogo desce
  oldestCursor    String?   @map("oldest_cursor")  // max_id p/ retomar paginação descendente
  catalogComplete Boolean   @default(false) @map("catalog_complete")    // true se já temos toda a timeline
  lastScrapedAt   DateTime? @map("last_scraped_at") @db.Timestamptz(6)  // último scrape "completo"
  lastRefreshedAt DateTime? @map("last_refreshed_at") @db.Timestamptz(6)// último top-check incremental
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  posts IgPost[]

  @@map("ig_profiles")
}
```

### 4.3. `IgPost` (novo) — um registo por post

```prisma
model IgPost {
  id            String   @id @default(uuid()) @db.Uuid
  profileId     String   @map("profile_id") @db.Uuid
  shortcode     String   @unique
  takenAt       DateTime @map("taken_at") @db.Timestamptz(6) // se IG omitir, usar firstSeenAt
  isVideo       Boolean  @default(false) @map("is_video")
  caption       String?  @db.Text
  carouselCount Int      @default(1) @map("carousel_count")  // nº de slots (1 = single)
  imagesReady   Boolean  @default(false) @map("images_ready")// todos os slots têm bytes em S3
  firstSeenAt   DateTime @default(now()) @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt    DateTime @default(now()) @map("last_seen_at") @db.Timestamptz(6)

  profile IgProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, takenAt(sort: Desc)])
  @@map("ig_posts")
}
```

> As imagens de um post obtêm-se por `MediaAsset.findMany({ where: { shortcode }, orderBy: { slot } })`
> — não é preciso join table. `carouselCount` em `IgPost` evita ter de contar.

### 4.4. `Asset` (edição) — referência fina + metadados explícitos

```prisma
model Asset {
  id          String    @id @default(uuid()) @db.Uuid
  jobId       String    @map("job_id") @db.Uuid
  contentType String    @map("content_type")
  storageKey  String    @map("storage_key") // = MediaAsset.storageKey (denormalizado p/ assinar sem join)
  byteSize    BigInt    @map("byte_size")
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz(6)
  // novos — substituem o parsing da string nos plugins/billing:
  kind         String?  // 'post' | 'profile'
  shortcode    String?
  slot         Int      @default(0)
  mediaAssetId String?  @map("media_asset_id") @db.Uuid

  job        Job         @relation(fields: [jobId], references: [id], onDelete: Cascade)
  mediaAsset MediaAsset? @relation(fields: [mediaAssetId], references: [id], onDelete: SetNull)

  @@index([jobId])
  @@index([mediaAssetId])
  @@map("assets")
}
```

> **Importante:** continuamos a criar uma linha `Asset` por imagem **mesmo quando
> os bytes são 100% reutilizados** — é o que mantém o serving do import e o billing
> corretos. A linha é barata (sem download).

---

## 5. Contratos partilhados (`packages/shared-contracts`)

### 5.1. `TimelinePostItem` + parsers ganham `takenAt`

`packages/shared-contracts/src/instagram-timeline-parse.ts`:

```ts
export type TimelinePostItem = {
  shortcode: string;
  thumbnailUrl: string | null;
  isVideo?: boolean;
  carouselImageUrls?: string[];
  takenAt?: number | null; // unix SECONDS, UTC
  caption?: string | null;
};
```

- Em `parseTimelineSampleFromUserNode`: ler `node.taken_at_timestamp` (number) →
  `takenAt`. Ler caption de `node.edge_media_to_caption.edges[0].node.text` (best-effort).
- `buildIndexedPostPreview`: preencher `takenAt` (hoje está sempre `null`) como ISO
  string a partir do unix (`new Date(takenAt*1000).toISOString()`).

`packages/shared-instagram/src/feed-parse.ts` (`parseFeedItems`):
- ler `item.taken_at` (unix seconds) → `takenAt`; caption de `item.caption.text`.

`apps/api/src/instagram/apify-preview.client.ts`:
- ler `post.timestamp` (ISO) → `Math.floor(Date.parse(...)/1000)`; fallback
  `post.takenAt`/`post.taken_at`.

### 5.2. `JobSignedAssetDto` + preview DTO

`packages/shared-contracts/src/index.ts`:

```ts
export const jobSignedAssetDtoSchema = z.object({
  id: z.string().uuid(),
  storageKey: z.string(),
  contentType: z.string(),
  url: z.string(),
  expiresAt: z.string(),
  // novos (opcionais p/ retrocompat com jobs antigos):
  kind: z.enum(['post', 'profile']).optional(),
  shortcode: z.string().nullable().optional(),
  slot: z.number().int().min(0).optional(),
});
```

> `instagramPostPreviewItemSchema` já tem `takenAt` (string nullable) — passa a ser
> preenchido. Sem mudança de schema aí.

---

## 6. Algoritmos

### 6.1. Download dedupado — `ensureMediaAsset` (partilhado: scrape + backfill)

Função partilhada que garante os bytes de um `(shortcode, slot)` em S3, chamada
por `uploadScrapeAssets` (worker de scrape) **e** pelo worker de backfill (§6.6).
Para cada `(shortcode, slot)` a processar:

```
mediaKey = `${shortcode}:${slot}`
existing = MediaAsset.findUnique({ where: { mediaKey } })
if existing:
    # HIT — sem rede
    MediaAsset.update lastUsedAt = now()
    storageKey, contentType = existing.{storageKey, contentType}
else:
    # MISS — descarrega 1×
    { body, contentType } = fetchBytes(url)              # já existe
    ext = guessExtFromMime(contentType)
    storageKey = `media/${shortcode}/${slot}.${ext}`
    putObjectBytes(storageKey, body, contentType)        # idempotente (overwrite)
    existing = MediaAsset.upsert({ where:{mediaKey}, create:{...}, update:{ lastUsedAt: now() } })
# sempre cria a referência por-job:
Asset.create({ jobId, storageKey, contentType, byteSize, kind:'post', shortcode, slot, mediaAssetId: existing.id })
```

- Avatar: `mediaKey = profile:<igUserId>`, `kind='profile'`, key
  `media/profile/<igUserId>.<ext>` (re-PUT em mudança — overwrite).
- Concorrência: manter o pool de 5. O `upsert` por `mediaKey` torna corridas
  seguras (dois workers a descarregar o mesmo slot → ambos PUT idempotente, um
  upsert vence; bytes idênticos).
- Falha de download de um slot: log + continua (não falha o job); `imagesReady`
  do post fica `false` (retry numa próxima passagem).

### 6.2. Refresh incremental do catálogo (preview) — `refreshProfileCatalog(username)`

Chamado no caminho da **página 1** da preview.

**Cold (perfil ainda não em catálogo):**
1. `web_profile_info` (1 pedido) → profile + page-1 nodes (com `takenAt`).
2. (opcional, limitado por tier/`MAX_INCREMENTAL_PAGES`) algumas páginas de feed
   para encher a 1ª vista.
3. Upsert `IgProfile`; upsert `IgPost[]`; **enfileira** backfill (§6.6) das imagens
   (slot 0 de cada post visível); set high-water marks (`newestPostAt/Shortcode`,
   `oldestPostAt/Cursor`).

**Warm (perfil já em catálogo) — só se `now - lastRefreshedAt > REFRESH_TTL`:**
1. Adquirir lock Redis `lock:catalog:<username>` (`SET NX PX 30000`). Se falhar →
   **outro pedido está a tratar**; servir catálogo atual e sair (sem pedido IG).
2. `web_profile_info` (1 pedido) → refresh metadados + page-1 nodes.
3. `newPosts = nodes.filter(n => n.shortcode ∉ catálogo && n.takenAt > newestPostAt)`.
4. **Guard de posts fixados (pinned):** NÃO parar no primeiro shortcode conhecido
   (um pinned antigo pode estar acima de posts novos). Regra de paragem:
   - parar de paginar quando uma página **não contribui shortcodes novos** *e* o
     seu `max(takenAt) <= newestPostAt` (entrámos claramente em território
     conhecido), **ou**
   - ao fim de `MAX_INCREMENTAL_PAGES` páginas (teto de pedidos).
   Se a page-1 é **toda** nova (≥12 novos) → continuar via feed `max_id`.
5. Upsert `IgPost` dos `newPosts`; **enfileirar** backfill de imagens (§6.6);
   atualizar `newestPostAt = max(takenAt)`, `newestShortcode`, `lastRefreshedAt = now`.
6. Libertar lock.

**Deletions:** posts apagados no IG continuam no catálogo (preview ligeiramente
stale). GC/verificação preguiçosa trata isto (Fase 5). Aceitável em v1.

### 6.3. Deep-scroll (páginas para além do catálogo)

Quando a página pedida ultrapassa o que o catálogo tem **e** `catalogComplete=false`:
1. Retomar paginação **descendente** com `oldestCursor` (feed `max_id`) — sem
   recomeçar do topo.
2. Buscar só as páginas em falta (respeitando tier cap), upsert `IgPost`,
   **enfileirar** backfill (§6.6), avançar `oldestPostAt/Cursor`.
3. Se a paginação esgota (`more_available=false`) → `catalogComplete = true`.
4. Resultado: depois de alguém scrollar 5 páginas, ficam em catálogo para sempre;
   o próximo utilizador lê-as do Postgres (0 pedidos IG).

### 6.4. Serving da preview a partir do catálogo

```
posts = IgPost.findMany({
  where: { profileId },
  orderBy: [{ takenAt: 'desc' }, { shortcode: 'desc' }],
  skip: (previewPage-1)*12, take: 12,
})
covers = MediaAsset.findMany({ where: { shortcode in posts.map(...), slot: 0 } })
signed = storage.signGetObjects(covers.map(c => c.storageKey))
postsPreview[].thumbnailUrl = signedUrl(cover)   // URL S3 assinada, transparente p/ UI
```

- `hasNextPreviewPage` = existem mais posts em catálogo **ou** `!catalogComplete`.
- Posts com `imagesReady=false` (ainda sem bytes em S3 — janela do modo `async`):
  servir a **URL CDN do IG** no `thumbnailUrl` **e enfileirar** o backfill (§6.6).
  Assim que o backfill conclui, as próximas previews servem a **URL S3 assinada**.
  A UI é agnóstica ao tipo de URL.

> **Update 2026-06-14:** implementada a **paginação catalog-aware da preview** (distinta
> do import resolve-from-catalog abaixo, ainda pendente). Página 2+ passa a ser
> catalog-first via `tryServeCatalogPage` (`getPostsPage`/`countPosts` + covers S3),
> com `recordCatalogPosts` a fazer write-through dos posts paginados no caminho live.
> Motivo: os actores Apify de posts não expõem cursor — o catálogo é a única fonte de
> paginação incremental sem sessão IG. Ver `docs/tasks/TASK-catalog-aware-pagination.md`.

### 6.5. Import resolve-from-catalog (Fase 4)

No `JobsService.create`, **antes** de enfileirar: se o catálogo cobre a seleção
pedida e todos os `MediaAsset` existem (`imagesReady`), resolver o job
**sincronamente** (criar `Asset[]` a apontar para os `MediaAsset`, marcar
`succeeded`, `resultStoragePrefix=null`/sentinela) → **0 pedidos IG, 0 downloads**.
Só enfileira o worker quando há lacunas (posts/slots em falta). O worker, ao correr,
beneficia na mesma do dedup §6.1.

### 6.6. Backfill assíncrono de imagens (modo `async`) — fila `media-backfill-v1`

A preview **nunca bloqueia** para descarregar bytes. Ao descobrir posts novos (ou
ao servir posts com `imagesReady=false`), enfileira um job BullMQ:

- **Payload:** `{ shortcode, slots: [{ slot, url }], igUserId?, profilePicUrl? }` —
  leva as **URLs CDN capturadas no mesmo fetch que descobriu os posts**. As URLs IG
  expiram, por isso o backfill corre depressa (fila com `attempts` + backoff curto).
- **Dedup in-flight:** `jobId = "media:" + shortcode` → o BullMQ colapsa enqueues
  duplicados do mesmo post. No consumo, reverificar `MediaAsset` por `mediaKey` e
  saltar slots já existentes (idempotente mesmo sob corrida com o worker de scrape).
- **Consumidor:** novo `Worker` (em `apps/worker/src/main.ts` ou módulo próprio) a
  escutar `media-backfill-v1` → chama `ensureMediaAsset(...)` por slot (a **mesma**
  função do §6.1) → quando todos os slots existem, `IgPost.update imagesReady=true`.
- **Falha (URL expirada / download falha):** deixar `imagesReady=false`; a próxima
  preview que sirva esse post re-enfileira com URL fresca (que acabou de obter) — sem
  re-scrape dedicado. Slots que falham não bloqueiam os que passam.
- **Serving durante a janela:** ver §6.4 — `thumbnailUrl` cai na URL CDN do IG até
  os bytes existirem; depois passa a URL S3 assinada. Transparente para a UI.

> O catálogo (`IgPost`) é escrito **imediatamente** na preview; só os *bytes* é que
> chegam a S3 de forma assíncrona. Por isso a deteção de "posts novos" é exata desde
> o primeiro instante, mesmo antes do backfill terminar.

---

## 7. Decisão: como descarregar imagens de posts novos → **`async`**

Três modos (env `CATALOG_IMAGE_BACKFILL_MODE`), **mesmo estado final** (bytes em
S3), diferindo em *quando o utilizador espera* e *que infra é precisa*:

- **`eager` (blocking):** a preview descarrega **antes** de responder. Sem infra
  nova; o 1º utilizador a ver o perfil espera o download.
- **`async` (✅ ESCOLHIDO — default):** a preview responde **já** (URL CDN efémera
  do IG para posts novos) e **enfileira** `media-backfill-v1`, que descarrega para
  S3 a seguir (§6.6). Preview sempre rápida; requer fila + worker novos e o guard
  in-flight descrito.
- **`lazy`:** o catálogo guarda só metadados; os bytes entram em S3 no import (ou
  numa preview futura que não possa usar a URL IG). Mais barato; posts previstos mas
  nunca importados ficam sem cópia no store.

**Plano (async):**
- Extrair a lógica do §6.1 para `ensureMediaAsset(prisma, { kind, shortcode, slot, url, igUserId? })`
  — partilhada pelo worker de scrape **e** pelo worker de backfill.
- A preview/​catálogo **enfileira** o backfill e nunca bloqueia; o serving usa a URL
  do IG até `imagesReady` (§6.4/§6.6).
- `eager` e `lazy` ficam implementados atrás da mesma flag (troca sem reescrita — só
  muda o ponto de invocação: inline vs fila vs no-op).

---

## 8. Mudanças planeadas (ficheiro a ficheiro, por fase)

Implementação **faseada** — cada fase é shippável e isolável atrás de flags.

### Fase 0 — Fundações (schema, contratos, config, helpers)

| Ficheiro | Mudança |
|----------|---------|
| `apps/api/prisma/schema.prisma` | **edição** — adicionar `MediaAsset`, `IgProfile`, `IgPost`; campos novos em `Asset` |
| `apps/api/prisma/migrations/<ts>_persistent_ig_catalog/` | **novo** — migração gerada |
| `packages/shared-contracts/src/instagram-timeline-parse.ts` | **edição** — `takenAt`/`caption` em `TimelinePostItem`; parse de `taken_at_timestamp`; preencher `takenAt` no preview item |
| `packages/shared-instagram/src/feed-parse.ts` | **edição** — parse `taken_at`/caption |
| `packages/shared-contracts/src/index.ts` | **edição** — `jobSignedAssetDtoSchema` ganha `kind/shortcode/slot` |
| `apps/api/src/instagram/apify-preview.client.ts` | **edição** — parse `timestamp`→`takenAt` |
| `apps/api/.env.example` + `apps/worker/.env.example` (se existir) | **edição** — novas env vars (§10) |
| `packages/shared-instagram/src/storage-keys.ts` *(ou novo módulo partilhado)* | **novo** — `mediaStorageKey(shortcode, slot, ext)`, `profileStorageKey(igUserId, ext)`, `mediaKeyForPost/Profile` (usado por api + worker) |

### Fase 1 — Dedup global de bytes (maior poupança, baixo risco)

| Ficheiro | Mudança |
|----------|---------|
| `apps/worker/src/storage/ensure-media-asset.ts` | **novo** — `ensureMediaAsset(prisma, { kind, shortcode, slot, url, igUserId? })` (algoritmo §6.1): HIT sem rede / MISS fetch+PUT+upsert. **Partilhado** por scrape (Fase 1) + backfill (Fase 3b) |
| `apps/worker/src/storage/upload-scrape-assets.ts` | **edição** — passa a chamar `ensureMediaAsset` por slot; cria a `Asset` (`kind/shortcode/slot/mediaAssetId`); key global `media/...` |
| `apps/worker/src/storage/s3-client.ts` | **edição** — `mediaStoragePrefix`/helpers (ou usar o módulo partilhado) |
| `apps/worker/src/plan/quota-usage.ts` | **edição** — `countBillableJobImages` passa a contar `Asset.kind='post'` (não `/thumbs/`) |
| `apps/api/src/jobs/jobs.service.ts` | **edição** — `getOne` inclui `kind/shortcode/slot` no `signedAssets` |
| `apps/figma-plugin/src/code.ts` | **edição** — agrupar por `shortcode/slot` do DTO; avatar por `kind==='profile'`; **fallback** ao regex p/ jobs antigos |
| `apps/framer-plugin/src/FramerHost.ts` | **edição** — idem |

### Fase 2 — Persistência write-through do catálogo (sem mudar o read path)

| Ficheiro | Mudança |
|----------|---------|
| `apps/api/src/instagram/catalog/ig-catalog.service.ts` | **novo** — `upsertProfile`, `upsertPosts`, `recordMediaAsset`, `getProfileWithPosts`, high-water marks |
| `apps/api/src/instagram/catalog/ig-catalog.module.ts` | **novo** — módulo Nest |
| `apps/api/src/instagram/instagram-preview.service.ts` | **edição** — após cada fetch direto/Apify, **write-through** ao catálogo (best-effort, não bloqueia resposta) |
| `apps/worker/src/instagram/scrape-runner.ts` | **edição** — após scrape, persistir `IgProfile/IgPost` (worker partilha o Prisma client) |

### Fase 3a — Preview catalog-first + incremental (o grande ganho)

| Ficheiro | Mudança |
|----------|---------|
| `apps/api/src/instagram/catalog/catalog-preview-source.ts` | **novo** — `refreshProfileCatalog` (§6.2), deep-scroll (§6.3), serving (§6.4), lock Redis; **enfileira** backfill (§6.6) em vez de descarregar inline |
| `apps/api/src/instagram/instagram-preview.service.ts` | **edição** — `getOrFetchPreviewBase` passa a: L1 Redis → L2 catálogo (catalog-preview-source) → L3 direto/Apify; assinar covers S3; cursores passam a ser do catálogo |
| `apps/api/src/instagram/preview-source.types.ts` | **edição** — tipos p/ resposta do catálogo (cursor próprio) |
| `apps/api/src/storage/storage.service.ts` | **edição (opcional)** — helper p/ assinar muitas keys com cache curto |
| `apps/api/src/cache/redis-cache.module.ts` | (sem mudança; reutilizar cliente p/ lock) |

### Fase 3b — Infra de backfill assíncrono (§6.6, modo `async`)

| Ficheiro | Mudança |
|----------|---------|
| `packages/shared-contracts/src/index.ts` | **edição** — `MEDIA_BACKFILL_V1_QUEUE = 'media-backfill-v1'` + `mediaBackfillV1JobPayloadSchema` (`{ shortcode, slots: [{slot,url}], igUserId?, profilePicUrl? }`) |
| `apps/api/src/instagram/catalog/ig-catalog.module.ts` | **edição** — `BullModule.registerQueue({ name: 'media-backfill-v1' })`; injeta a `Queue` no `catalog-preview-source` p/ enfileirar com `jobId='media:'+shortcode` |
| `apps/worker/src/backfill/media-backfill.processor.ts` | **novo** — handler: por slot chama `ensureMediaAsset`; ao concluir todos, `IgPost.update imagesReady=true`; reverifica `MediaAsset` p/ idempotência |
| `apps/worker/src/main.ts` | **edição** — arrancar **2º** `Worker` na fila `media-backfill-v1` (concorrência própria; `attempts`+backoff **curto** por causa das URLs efémeras) |

### Fase 4 — Import resolve-from-catalog (import quase sem IG)

| Ficheiro | Mudança |
|----------|---------|
| `apps/api/src/jobs/jobs.service.ts` | **edição** — `create` tenta resolver sincronamente do catálogo (§6.5); só enfileira em caso de lacuna |
| `apps/api/src/jobs/jobs.module.ts` | **edição** — injetar `IgCatalogService`/`StorageService` |

### Fase 5 — GC + observabilidade

| Ficheiro | Mudança |
|----------|---------|
| `apps/worker/src/maintenance/media-gc.ts` | **novo** — cron: apaga `MediaAsset` (e objeto S3) com `lastUsedAt` > `MEDIA_GC_DAYS` e sem `Asset` a referenciar; prune `IgPost` órfãos |
| `apps/api/prisma/schema.prisma` (`ScrapeTelemetry`) | **edição (opcional)** — distinguir `cacheHit` por camada (`l1`/`l2`/`l3`) |
| `apps/api/src/instagram/instagram-telemetry.service.ts` | **edição** — registar camada servida |

---

## 9. Edge cases (não esquecer)

1. **Posts fixados (pinned)** aparecem no topo fora de ordem cronológica →
   o guard incremental (§6.2.4) usa `takenAt` boundary + set de shortcodes, não
   "primeiro conhecido". Ordenação do catálogo é por `takenAt desc` (pinned afunda
   para a posição cronológica — **desvio assumido** vs IG; documentar).
2. **`takenAt` ausente** (parse antigo/edge) → usar `firstSeenAt` no ingest;
   `IgPost.takenAt` nunca nulo.
3. **Cover (slot 0) == 1º slide do carrossel** — garantir que o slot 0 é sempre a
   1ª imagem para o `mediaKey` ser consistente entre import expandido e não-expandido.
4. **Colisão de download concorrente** do mesmo `mediaKey` → `upsert` idempotente +
   PUT overwrite (bytes idênticos). Sem corrupção.
5. **Apagar um Job** (cascade) apaga `Asset` mas **não** `MediaAsset`/objeto S3
   (prefixo `media/` ≠ `jobs/`). Confirmar que nenhum GC apaga por prefixo `jobs/`
   às cegas (não existe hoje).
6. **Jobs antigos** (`Asset` sem `kind/shortcode/slot`, keys `jobs/<id>/thumbs/…`)
   → serving e plugins mantêm **fallback** ao parsing por regex. Não migrar dados
   antigos (deixar expirar/co-existir).
7. **Avatar muda** → re-PUT em `media/profile/<igUserId>.<ext>` (overwrite). Presign
   com TTL limita staleness. (Alternativa: key por content-hash.)
8. **Perfil privado / 404 / rate-limit no top-check** → servir catálogo (stale) e
   **não** falhar; só falhar hard se não houver catálogo **e** IG falhar.
9. **Username muda no IG** mas `igUserId` é o mesmo → `IgProfile.username` é único;
   detetar por `igUserId` e atualizar `username` (upsert por `igUserId` quando
   disponível, senão por `username`).
10. **Conteúdo NSFW/indisponível/geo-blocked** no download → trata como falha de
    slot (skip, `imagesReady=false`).
11. **Vídeos** → guardamos o **cover** (thumbnail) como slot 0; não descarregamos o
    vídeo. `isVideo=true`.
12. **MinIO/S3 não configurado** (`isS3Configured()=false`) → catálogo de bytes
    desativa graciosamente; cai no comportamento atual (URLs CDN diretas). Catálogo
    de **metadados** pode continuar (mas sem serving de imagem do store).
13. **Redis indisponível** (lock) → degradar: sem lock, permitir o fetch (pior caso:
    fetch duplicado ocasional, nunca incorreto).
14. **Tier caps de preview** (`assertPreviewPageAllowed`: Free ≤3, Pro ≤12, Max ∞)
    mantêm-se — aplicam-se ao **catálogo** tal como hoje ao IG.
15. **Quota/billing** — reuso de bytes **não** muda o que o utilizador é cobrado;
    `countBillableJobImages` conta `Asset.kind='post'` (existe mesmo em reuso 100%).
16. **`mediaCount` 0 do Apify post-scraper** (já tratado em `ApifyPreviewSource`) →
    paginação/`hasNext` derivam de `parsedPosts.length`; catálogo usa `oldestCursor`/
    `catalogComplete` em vez de depender de `mediaCount`.
17. **Idempotência do worker** — re-execução de um job não duplica downloads
    (`MediaAsset` dedup) nem `Asset` (re-criar é aceitável; opcional: dedup por
    `(jobId, shortcode, slot)` com unique).
18. **Tamanho/limites** — manter `ASSET_MAX_BYTES`, `STORAGE_MAX_THUMBNAILS*`.
19. **Migração de `BigInt`** (`byteSize`) — serialização JSON já tratada no projeto;
    não expor `MediaAsset` cru em respostas.
20. **Race "post novo a meio da paginação"** — IG insere post entre páginas durante
    o scroll → possível shortcode repetido entre páginas; o upsert por `shortcode`
    único deduplica.
21. **URL CDN expira antes do backfill correr** (modo `async`) → o download falha;
    `imagesReady` fica `false`; a próxima preview re-enfileira com URL fresca. Fila
    com backoff **curto** minimiza a janela.
22. **Enqueue duplicado do mesmo post** (vários users veem em simultâneo) →
    `jobId='media:'+shortcode` colapsa no BullMQ; a reverificação de `MediaAsset` no
    consumo evita re-download mesmo se dois jobs passarem.
23. **Backfill corre antes da row `IgPost` existir** → ordem garantida: escrever
    `IgPost` **antes** de enfileirar. O handler tolera `IgPost` ausente (faz o
    `ensureMediaAsset` e salta o update de `imagesReady`, que uma passagem futura
    corrige).
24. **Worker de backfill em baixo / fila atrasada** → preview continua a servir URLs
    CDN do IG (degradação graciosa); `imagesReady` fica `true` quando a fila recupera.
    Nada bloqueia o utilizador.

---

## 10. Configuração / env vars novas

| Var | Default | Descrição |
|-----|---------|-----------|
| `CATALOG_ENABLED` | `false` (rollout dark) | liga a leitura catalog-first (Fase 3) |
| `CATALOG_WRITE_THROUGH` | `true` | liga a persistência write-through (Fase 2) |
| `CATALOG_REFRESH_TTL_MS` | `300000` (5min) | janela sem top-check ao IG |
| `CATALOG_MAX_INCREMENTAL_PAGES` | `5` | teto de páginas IG por top-check |
| `CATALOG_IMAGE_BACKFILL_MODE` | `async` | `eager`\|`async`\|`lazy` (§7); `async` = fila `media-backfill-v1` |
| `MEDIA_BACKFILL_CONCURRENCY` | `4` | concorrência do worker de backfill (§6.6) |
| `MEDIA_BACKFILL_ATTEMPTS` | `3` | tentativas BullMQ antes de desistir (URLs efémeras) |
| `MEDIA_GC_DAYS` | `90` | idade `lastUsedAt` p/ GC (Fase 5) |

`.env.example` (api + worker) e `docs/RAILWAY.md` actualizados.

---

## 11. Rollout (seguro)

1. **Fase 0+1 dark:** schema migrado, dedup de bytes no worker ativo (já poupa
   storage/banda no import). Keys novas `media/…`; plugins com fallback. Verificar
   import Figma + Framer ponta-a-ponta.
2. **Fase 2:** write-through ligado (`CATALOG_WRITE_THROUGH=true`). Catálogo
   **enche-se** sem mudar leitura. Observar crescimento das tabelas.
3. **Fase 3b primeiro (infra de backfill):** deploy do **2º worker** (`media-backfill-v1`)
   e da fila **antes** de ligar a leitura catalog-first — assim que o catálogo
   começar a enfileirar, há quem consuma. Sem consumidor, os jobs acumulam (mas a
   preview degrada para URLs IG, não quebra).
4. **Fase 3a canário:** `CATALOG_ENABLED=true` primeiro em staging; comparar
   `postsPreview` catálogo vs IG (mesmo conjunto/ordem). Confirmar que `imagesReady`
   transita para `true` e que o serving passa a URLs S3. Medir queda de pedidos IG.
5. **Fase 4:** import fast-path.
6. **Fase 5:** GC + métricas por camada.

Reversível: `CATALOG_ENABLED=false` volta ao caminho IG/Redis atual sem perder
dados.

---

## 12. Plano de testes

- **Unit (contracts):** `parseTimelineSampleFromUserNode`/`parseFeedItems`/Apify
  extraem `takenAt` corretamente (fixtures com `taken_at_timestamp`/`taken_at`).
- **Unit (worker):** `uploadScrapeAssets` — HIT (sem fetch, cria `Asset` a apontar
  para `MediaAsset` existente) vs MISS (1 fetch+PUT+upsert). `countBillableJobImages`
  conta por `kind`.
- **Unit (catalog):** guard incremental (pinned no topo; page-1 toda nova; paragem
  por `takenAt` boundary; teto de páginas).
- **Integração (api):** preview do mesmo perfil 2× → 2ª serve do catálogo (mock IG
  com contador de chamadas = 0 dentro do TTL; = 1 após TTL sem posts novos).
  Deep-scroll backfill persiste e a 2ª leitura não bate no IG.
- **E2E plugins:** Figma + Framer importam com o novo DTO (`kind/shortcode/slot`)
  **e** com jobs antigos (fallback regex). Carrosséis agrupados na ordem certa.
- **Reliability:** Redis down (lock) e S3 down → degradação graciosa, sem 500.

---

## 13. Porquê

- **Custo/recursos:** o IG é caro e arriscado (sessões/proxies/Apify, rate-limits,
  bloqueios). Re-scrape e re-download idênticos são desperdício direto. O catálogo
  + dedup content-addressed reduzem pedidos IG e storage para o **mínimo teórico**
  (1× por bytes; 1 top-check por janela; 0 para o que já temos).
- **Velocidade/fiabilidade:** servir de Postgres+S3 é mais rápido e previsível que
  do IG; menos exposição a 429/bloqueios; degradação graciosa (catálogo stale em
  vez de erro).
- **Efeito de rede ("crowd-sourced"):** quanto mais utilizadores, mais completo o
  catálogo — o trabalho de um beneficia todos (o cenário pedido: "alguém scrollou 5
  páginas → o próximo só precisa do topo / do 1 post novo").
- **Desacoplamento de dívida técnica:** remover o parsing frágil da string
  `storageKey` (4 consumidores) em favor de metadados explícitos torna o sistema
  mais robusto e o storage livre para ser content-addressed.

---

## 14. Documentação a actualizar (no fim da task)

- `CLAUDE.md` — secções "Import flow", "Preview — infinite scroll", "Apify";
  acrescentar secção "Persistent IG catalog + media dedup" (camadas L1/L2/L3,
  layout `media/…`, modelos novos).
- `docs/RAILWAY.md` + `.env.example` (api/worker) — env vars §10.
- `README.md` (raiz + `apps/api`) — tabela de endpoints/flux (preview catalog-first).
- ADRs — acrescentar **ADR novo** "Persistent IG catalog & content-addressed media
  store" (decisão, alternativas, trade-offs: ordenação por `takenAt` vs pinned,
  eager vs async download). Não reescrever ADRs antigos.
- Esta task: marcar fases concluídas à medida.

---

## 15. Resumo da ordem de execução

1. ✅ **FEITO** — Fase 0 (schema + migração `20260614002313_persistent_ig_catalog` +
   `takenAt`/`caption` nos 3 parsers + DTO + `instagramPostSummaryItemSchema` + helpers de key).
2. ✅ **FEITO** — Fase 1 (dedup global via `ensureMediaAsset` + `upload-scrape-assets`
   + `Asset` metadata + `countBillableJobImages` por `kind` + `signedAssets` DTO +
   plugins Figma/Framer com fallback. Testes: `ensure-media-asset.test.ts`,
   `instagram-timeline-parse.test.ts`. Typechecks + builds verdes).
3. ✅ **FEITO (parcial)** — Fase 2 (write-through catálogo no **lado API**:
   `IgCatalogService.writeThrough` + `IgCatalogModule`, chamado em
   `getOrFetchPreviewBase` nos dois caminhos de fetch fresco; gated por
   `CATALOG_WRITE_THROUGH`, best-effort. **Worker-side write-through adiado** p/
   Fase 3b/4 — onde o worker fica catalog-aware e se extrai um módulo partilhado;
   a preview sozinha já popula o catálogo que a Fase 3a lê).
4. ✅ **FEITO** — Fase 3b (infra backfill: `MEDIA_BACKFILL_V1_QUEUE` + payload em
   shared-contracts; fila registada em `QueueModule`; enqueue em `IgCatalogService`
   gated por `CATALOG_BACKFILL_ENABLED`; 2º `Worker` + `media-backfill.processor`)
   + Fase 3a (preview catalog-first: `fetchFreshBase` → `tryServeFromCatalog` com
   top-check incremental sob lock Redis, serve `IgPost` ordenado por `takenAt desc`
   com covers S3 assinados; gated por `CATALOG_ENABLED`, default OFF).
   Typechecks + builds + testes verdes. **Nota:** boot DI não validado localmente
   (quirk pré-existente do nest-build no Node 24); padrões de injeção idênticos aos
   já em produção (`@InjectQueue` como em `jobs.service`). Deep-scroll para além de
   `fetchCount` ainda cai no fetch live (persistência descendente = follow-up).
5. Fase 4 (import resolve-from-catalog).
6. Fase 5 (GC + telemetria por camada).
7. Actualizar documentação (§14).
