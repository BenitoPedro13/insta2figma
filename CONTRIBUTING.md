# Contributing to Insta2Figma

## Setup

```bash
pnpm bootstrap   # installs deps, starts Docker, runs DB migrations
pnpm dev         # starts API + worker
```

See [README.md](README.md) for full onboarding steps.

## Branch naming

```
feat/short-description
fix/short-description
chore/short-description
docs/short-description
```

## PRs

- Target `main`.
- Keep PRs focused — one concern per PR.
- Include a short description of *why* the change is needed, not just what it does.
- If the change affects both Figma and Framer plugins, test both before requesting review.

## Commit style

```
✨ UPDATE: short description of what changed
```

The emoji prefix is optional but consistent with existing history (`✨ UPDATE`, `🐛 FIX`, `📝 DOCS`).

## Code conventions

- TypeScript strict mode throughout.
- No `any` in new code — use `unknown` + type narrowing.
- Comments only when the *why* is non-obvious. No docblocks on trivial functions.
- No unused imports or variables.

## Adding a feature to both plugins

Features visible in the UI live in `packages/plugin-ui`. Platform-specific behaviour
goes in the host implementations:

| What | Where |
|------|-------|
| New UI component or screen | `packages/plugin-ui/src/` |
| New message type (UI → host) | `packages/plugin-ui/src/host.ts` + `App.tsx` |
| Figma implementation | `apps/figma-plugin/ui-src/FigmaHost.ts` + `src/code.ts` |
| Framer implementation | `apps/framer-plugin/src/FramerHost.ts` |
| API endpoint | `apps/api/src/` |
| Worker job | `apps/worker/src/` |

See [CLAUDE.md](CLAUDE.md) for the full architecture guide.

## Tests

```bash
pnpm test                  # all packages
pnpm --filter @insta2figma/shared-contracts test
```

Unit tests live next to source files (`*.spec.ts`). Integration tests for the worker
require a running Postgres + Redis — use `pnpm infra:up` before running them.

## Environment variables

Copy `.env.example` → `.env` in each app before running:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/figma-plugin/.env.example apps/figma-plugin/.env  # optional
```

Never commit `.env` files.
