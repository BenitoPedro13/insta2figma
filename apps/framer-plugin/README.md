# Insta2Figma — Framer Plugin

Framer plugin that imports Instagram posts directly onto the canvas.
Shares the full UI with the Figma plugin via `packages/plugin-ui`.

## Architecture

```
apps/framer-plugin/
  src/
    main.tsx        entry point — mounts shared App with FramerHost
    FramerHost.ts   PluginHost implementation — calls API directly (no bridge)
  framer.json       plugin manifest (name, permissions, icon)
  vite.config.ts    aliases for @insta2figma/plugin-ui, shared-contracts, @/
```

The `FramerHost` replaces the message-passing bridge used by the Figma plugin. Since
the Framer plugin iframe can make authenticated `fetch` calls directly (CORS allowed),
it calls the API itself, stores the JWT in `localStorage`, and places images on the
canvas via `framer.uploadImage` + `framer.createFrameNode`.

## Dev server

```bash
pnpm dev
```

Starts a Vite dev server at **`https://localhost:5173`** (HTTPS required by Framer).

**In Framer:** Main menu → Plugins → Developer Tools → Development Plugin → point to `https://localhost:5173`.

**API CORS for local dev:** add `https://localhost:5173` to `CORS_ORIGINS` in `apps/api/.env`
(or in Railway env vars when testing against production).

## Build

```bash
pnpm build   # outputs to dist/
pnpm pack    # package for Framer Marketplace submission
```

## Environment variables

The Framer plugin has no build-time env vars. All runtime config (API URL, token) is
handled inside `FramerHost.ts`.

See `apps/framer-plugin/.env.example` for any optional overrides.

## Permissions

Declared in `framer.json`:

| Permission | Used for |
|------------|---------|
| `addImage` | `framer.uploadImage` (upload image asset to Framer) |
| `createNode` | `framer.createFrameNode` (create frames on canvas) |

## Canvas layout

Images are placed in a nested stack:
- **Outer frame** (`@username`): vertical stack, 8px row gap
- **Row frames**: horizontal stack, 8px column gap
- **Image frames**: fixed width (280px), aspect-ratio height, `backgroundImage` set

When `expandCarouselImages` is enabled, carousel images are grouped per post using
the `storageKey` from the signed assets — mirrors the Figma plugin's `groupAssetsIntoPostRows`.

## Shared UI

The plugin renders `<App host={new FramerHost()} />` from `packages/plugin-ui`.
Any UI change (screens, components, styles) goes in that package and applies to both
Figma and Framer automatically.

For architecture details see [CLAUDE.md](../../CLAUDE.md).
