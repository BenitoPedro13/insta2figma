# Insta2Figma — Codebase Guide for Claude

## Workflow obrigatório antes de qualquer mudança

Antes de editar ou criar qualquer ficheiro de código, criar sempre um documento de task em `docs/tasks/TASK-<slug>.md` com:
1. **Cenário actual** — como funciona hoje, o que está bloqueado/errado
2. **Mudanças planeadas** — o que muda, ficheiro a ficheiro
3. **Porquê** — justificação com contexto de negócio/técnico
4. **Ficheiros afectados** — tabela com tipo de mudança (novo/edição/remoção)

O documento é escrito em silêncio (não mostrado ao utilizador no chat). Só depois de criado avançar com o código.

## What this project does

Insta2Figma imports Instagram posts (images, carousels) directly onto a design canvas. It ships as two plugins — **Figma** and **Framer** — backed by a shared NestJS API and a BullMQ worker.

## Monorepo layout

```
apps/
  api/              NestJS API — auth, jobs, billing (Polar), quotas
  worker/           BullMQ consumer — Instagram scrape, S3 upload
  figma-plugin/     Figma plugin (code.ts main thread + shared UI)
  framer-plugin/    Framer plugin (FramerHost + shared UI)
packages/
  plugin-ui/        Shared React UI for both plugins (App.tsx, all components)
  shared-contracts/ Zod schemas + types shared by API, worker, and plugins
  shared-instagram/ Instagram session pool, proxy pool, retry logic
  shared-config/    Base tsconfig + ESLint config
docs/               Architecture, ADRs, deployment guides
scripts/            Dev onboarding (setup.mjs), cookie helper
```

## Key architecture: PluginHost pattern

Both plugins render the same `<App host={host} />` from `packages/plugin-ui`.
The `PluginHost` interface (defined in `packages/plugin-ui/src/host.ts`) abstracts
all platform differences:

```ts
interface PluginHost {
  send(msg: HostMessage): void         // UI → host (trigger action)
  subscribe(handler) => () => void     // host → UI (receive results)
  readonly canResize?: boolean         // false in Framer (noop resize handle)
}
```

- **`FigmaHost`** (`apps/figma-plugin/ui-src/FigmaHost.ts`): wraps `parent.postMessage`
  / `window.addEventListener`. The Figma plugin's `code.ts` handles the heavy work.
- **`FramerHost`** (`apps/framer-plugin/src/FramerHost.ts`): calls the API directly
  from the plugin iframe (CORS allowed). Uses `framer.uploadImage` + `framer.createFrameNode`
  for canvas placement. Stores token in `localStorage`.

**Adding a feature to both plugins:**
1. Add the message type to `PluginHost` (`packages/plugin-ui/src/host.ts`)
2. Handle it in `App.tsx` (`packages/plugin-ui/src/App.tsx`) using `host.send()`
3. Implement in `FigmaHost` + `code.ts` for Figma
4. Implement in `FramerHost` for Framer

## Build commands

```bash
pnpm bootstrap          # first-time onboarding (env, Docker, DB, deps)
pnpm dev                # API + worker (same terminal)

# Figma plugin
node apps/figma-plugin/scripts/build.mjs   # full build → dist/
# or
pnpm --filter @insta2figma/figma-plugin run build

# Framer plugin
cd apps/framer-plugin && pnpm dev    # dev server at https://localhost:5173
cd apps/framer-plugin && pnpm build  # production build
```

## CSS / Tailwind

`packages/plugin-ui/src/globals.css` imports Tailwind v4 with `@source "."`.
The `@source "."` directive is **required** — without it, Tailwind v4 only scans
within the Vite root (`ui-src/` for Figma) and misses the package components.

Both plugins add an alias in their `vite.config.ts`:
```ts
'@insta2figma/plugin-ui': resolve(pluginUiSrc, 'index.ts'),
'@': pluginUiSrc,   // resolves @/utils/cn etc. to packages/plugin-ui/src/
```

## API base resolution

**Figma plugin (`code.ts`):** probes `localhost:3333/v1/health` at startup (2s timeout);
falls back to Railway. Build mode can be forced: `INSTA2FIGMA_API_MODE=local|production`.

**Framer plugin (`FramerHost.ts`):** hardcoded to Railway production. For local dev,
update `API` constant to `http://localhost:3333` and add
`CORS_ORIGINS=https://localhost:5173` to `apps/api/.env`.

## Auth flow

Magic link: `POST /v1/auth/magic-link` → returns `pollingId` → poll `GET /v1/auth/poll`
every 3s → receive JWT. Google OAuth: `GET /v1/auth/google/start` → open URL in browser
→ same polling.

**Figma:** JWT stored in `figma.clientStorage` via the main thread (`code.ts`).
**Framer:** JWT stored in `localStorage` (key: `insta2figma:token:v1`).

## Preview — infinite scroll

The post preview grid uses **infinite scroll** (not page-based pagination).

**State in `App.tsx`:**
- `hasMorePreview` — `previewTotalPages > 1` (or `previewPageCount < previewTotalPages` after load-more)
- `nextPreviewCursor` — cursor for the next page request (`after` param)
- `previewPageCount` — how many pages have been fetched (1-based, starts at 1 after initial load)
- `previewLoadingMore` — spinner guard; prevents double-fetch
- `tierLimitedPreview` — derived: `previewPageCount >= tierPageCap && nextPreviewCursor != null`
- `previewLoadMoreReqId` ref — cancels stale load-more responses on username change

**Flow:**
1. Initial load → `requestKind` omitted → response sets `previewPageCount = 1`, `hasMorePreview = previewTotalPages > 1`
2. User scrolls to bottom → `PostPreviewList` scroll listener fires `fetchNextPreviewPage()`
3. `fetchNextPreviewPage` sends `{ requestKind: 'page', previewPage: n+1, after: cursor }`
4. Response appends posts to `preview.postsPreview` (accumulates, never replaces)
5. Tier gating: Free ≤ 3 pages, Pro ≤ 12 pages, Max unlimited — enforced client-side by `tierLimitedPreview`; server also enforces via `assertPreviewPageAllowed()`
6. On page-load error, `hasMorePreview` is set to `false` to stop the infinite retry loop

**`PostPreviewList` scroll mechanism:**
- Scroll listener registered once (via `useEffect([], [])`) — reads latest `hasMore`/`onLoadMore` via refs to avoid stale closures and re-registration cascade
- One-time initial check (`didInitialCheckRef`) fires when `hasMore` first becomes `true` — handles content too short to scroll
- Threshold: 200px from bottom

**`PostPreviewPagination` component was removed** — delete any lingering references.

## Apify — dois actores para preview e paginação

O fallback Apify usa **dois actores distintos** com env vars separadas:

| Env var | Actor | Usado para |
|---------|-------|-----------|
| `APIFY_IG_PROFILE_ACTOR` | `apify~instagram-profile-scraper` | Carregamento inicial (página 1) — devolve metadados do perfil + primeiros posts |
| `APIFY_IG_POST_ACTOR` | `apify~instagram-scraper` | Paginação (página 2+) e imports — suporta 50+ posts via `directUrls` |

Se `APIFY_IG_POST_ACTOR` não estiver definido, o sistema usa `APIFY_IG_PROFILE_ACTOR` para tudo (comportamento legado, limitado a 12 posts).

**Detecção automática do formato:** `isPostScraperActor(actorId)` — se o ID não contiver `profile-scraper`, usa o formato `directUrls + resultsType: "posts"` (saída flat array); caso contrário, usa `usernames + latestPosts` (saída com envelope de perfil).

**`previewTotalPages` sem `mediaCount`:** quando o actor de posts não devolve `mediaCount` (sempre 0), `ApifyPreviewSource` estima a paginação com base em `parsedPosts.length` vs `fetchCount`.

## Criação de contas Instagram (scripts CDP)

Scripts locais para criar contas Google/Gmail e Instagram via Chrome DevTools Protocol:

| Script | O que faz |
|--------|-----------|
| `pnpm cdp:launch` | Cria conta Gmail (sem proxy) |
| `pnpm cdp:launch --proxy=N` | Cria conta Gmail via proxy linha N de `scripts/proxies.txt` |
| `pnpm cdp:proxy` | Cria conta Gmail via proxy aleatório (guarda em `.proxy-session`) |
| `pnpm cdp:instagram` | Cria conta Instagram com o último Gmail de `scripts/accounts.json` |
| `pnpm cdp:instagram:proxy` | Idem, reutilizando o proxy de `.proxy-session` |
| `pnpm cdp:pool` | Lê `scripts/sessions.json` e imprime `IG_SESSION_POOL` pronto a colar |

Ficheiros locais (todos em `.gitignore`):
- `scripts/accounts.json` — Gmail criado (email, password, proxy)
- `scripts/sessions.json` — sessão Instagram (account, cookie, proxy)
- `scripts/.proxy-session` — proxy activo para a sessão corrente
- `scripts/proxies.txt` — lista de proxies `host:port:user:pass`

Ver `docs/SESSION-MANAGEMENT.md` para o fluxo completo.

## Import flow

1. UI sends `import-profile` message with username + selection params.
2. **Figma:** `code.ts` calls `POST /v1/jobs` → polls job → downloads images in parallel
   (pool of 5) → `figma.createImage` + `figma.createRectangle` on canvas.
3. **Framer:** `FramerHost` calls `POST /v1/jobs` → polls → `fetch` images → 
   `framer.uploadImage` → `framer.createFrameNode` in a nested stack layout
   (outer = vertical stack, rows = horizontal stack, leaves = image frames).
4. Both use `storageKey` to group carousel images per post row when `expandCarouselImages=true`.

**Worker scrape pagination:** `HttpInstagramDataSource.fetchProfilePostsSample` fetches the
Instagram web profile (returns ≤12 posts), then paginates via `feedUrl(userId, maxId)` until
`allEdges.length >= fetchCount` or `more_available: false`. This fixed a bug where imports
were always capped at 12 posts regardless of `maxPosts`.

## Monorepo pitfalls

- **pnpm workspace deps**: `packages/plugin-ui` must declare all its npm deps in its
  own `package.json` (Radix UI, Remix Icons, Tailwind, etc.) or Rollup can't resolve them.
- **React deduplication**: `framer-plugin`'s `vite.config.ts` sets `resolve.dedupe: ['react', 'react-dom']`
  to avoid the "multiple React instances" error with the workspace symlink.
- **Framer `isAllowedTo`**: pass the **method name** (`"createFrameNode"`, `"addImage"`),
  NOT the permission identifier (`"createNode"`). Calling with wrong string throws
  `TypeError: We[t] is not iterable`.
- **Framer pin positioning**: child frame position inside a parent uses `WithPinsTrait`
  (`left: "Npx"`, `top: "Npx"`), NOT `x`/`y`. Use stack layout to avoid manual positioning.
