# TASK — Paginação catalog-aware (Fase 4 do catálogo persistente)

## Cenário actual

A preview da página 1 já pode ser servida do catálogo (`tryServeFromCatalog`), mas a
**paginação (página 2+)** ignora o catálogo: vai sempre ao caminho live —
`fetchFeedPageByNumber` → IG cursor directo (precisa de sessão viva) → fallback Apify.

Como os actores Apify de posts **não expõem cursor** (confirmado nos input-schemas:
só `resultsLimit`/`onlyPostsNewerThan`/`directUrls`), paginar via Apify = re-scrape do
topo a cada scroll (12 → 24 → 36…). E com as sessões IG mortas, o cursor nativo do IG
(que já está implementado e seria incremental) devolve 401.

Além disso, os posts trazidos pela paginação **não são escritos no catálogo** — só a
página 1 é persistida no write-through. Logo o catálogo nunca cresce além de ~12 posts.

## Mudanças planeadas

### 1. `apps/api/src/instagram/catalog/ig-catalog.service.ts`
- `getPostsPage(profileId, skip, take)` — janela de posts por offset, ordenada
  `takenAt desc` (mesmo critério de `getRecentPosts`).
- `countPosts(profileId)` — total de posts no catálogo (para `hasNextPreviewPage`).

### 2. `apps/api/src/instagram/instagram-preview.service.ts`
- **`tryServeCatalogPage(username, previewPage, timelineOrder, selection, ctx)`** —
  serve a página N do catálogo:
  - lê `getPostsPage(profile.id, (N-1)*12, 12)`; se vazio → `null` (catálogo não cobre →
    cai no live, que popula p/ próxima vez).
  - assina covers S3 (`getCoverAssets` + `storage.signGetObjects`); se **algum cover
    faltar** na página → `null` (cai no live; evita imagens partidas; auto-cura via
    backfill, agora que o enqueue está corrigido).
  - devolve via `buildPaginatedPreviewResponse` (índices a partir de `(N-1)*12+1`),
    `hasNextPreviewPage = total > N*12 || !catalogComplete`, sem Apify nem sessão.
- **Wiring**: no início do branch `previewPage > 1` de `getProfilePreview`, tentar
  `tryServeCatalogPage` primeiro; só se devolver `null` seguir o caminho live actual.
- **`recordCatalogPosts(username, igUserId, posts)`** — wrapper de `catalog.writeThrough`
  para os posts trazidos pela paginação live; chamado após `fetchFeedPageByNumber`, para
  o catálogo crescer (e enfileirar backfill dos covers das páginas seguintes).

## Porquê
- Paginação incremental **de verdade**, sem depender de cursor do Apify (que não existe
  p/ posts) nem de sessões IG vivas.
- O catálogo passa a acumular todos os posts vistos → próximas visitas (mesmo de outro
  utilizador, após a cache Redis expirar) servem da DB, sem custo Apify.
- Aproveita a infra já construída (IgPost, MediaAsset covers, backfill).

## Comportamento esperado
- 1ª travessia de um perfil novo: página 2 ainda cai no live (catálogo só tem pág.1 e
  covers por backfillar) → scrape + write-through + enqueue backfill.
- Travessias seguintes (após backfill encher os covers): páginas 2+ servidas da DB.
- `newest_first` (default) alinhado com `takenAt desc`. `oldest_first` mantém a limitação
  já existente do serve de página 1 (ordena dentro da página) — fora de âmbito.

## Ficheiros afectados
| Ficheiro | Mudança |
|----------|---------|
| `apps/api/src/instagram/catalog/ig-catalog.service.ts` | edição — `getPostsPage` + `countPosts` |
| `apps/api/src/instagram/instagram-preview.service.ts` | edição — `tryServeCatalogPage`, wiring no branch page>1, `recordCatalogPosts` |
| `CLAUDE.md` | doc — paginação catalog-first (Fase 4) |
| `docs/tasks/TASK-persistent-ig-catalog-dedup.md` | nota — Fase 4 (parcial) implementada |
