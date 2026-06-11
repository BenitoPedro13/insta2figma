# TASK — Identidade de plataforma (Figma/Framer) + coluna `platform` para analytics

## Cenário actual

- **Figma**: funciona sem login explícito. `ensureSession` (`apps/figma-plugin/src/code.ts:817`)
  faz fallback para `authFigmaUser` → `POST /v1/auth/figma` com `figma.currentUser.id`.
  O backend cria/reutiliza `User` com `figmaUserId` (unique) e email sintético
  `figma+<id>@mailinator.com`. Login por email/Google chama `link-figma` para associar
  o `figmaUserId` à conta. Nenhuma plataforma expõe o email do utilizador ao plugin
  (confirmado nos docs oficiais) — o email sintético é a única opção sem login.
- **Framer**: `FramerHost.handleImport` bloqueia o import sem token (`show-login`).
  `handleSessionRequest` emite uma sessão guest fake mas o import é impossível sem login.
  A API do Framer expõe `framer.getCurrentUser()` → `{ id, name, avatarUrl, initials }`
  (id = 64 chars hex, sem email — tal como o Figma).
- **Banco**: não há forma de distinguir se um utilizador (mesmo com o mesmo email) usa o
  app via Figma ou Framer, nem de que plataforma veio cada job — bloqueia analytics de
  usage por plataforma.

## Mudanças planeadas

| Ficheiro | Tipo | Mudança |
|----------|------|---------|
| `apps/api/prisma/schema.prisma` | edição | `User.framerUserId String? @unique` (espelho de `figmaUserId`); `Job.platform String?` ("figma"\|"framer") |
| `apps/api/prisma/migrations/...` | novo | Migração `add_framer_user_id_and_job_platform` |
| `packages/shared-contracts/src/index.ts` | edição | `platform: z.enum(['figma','framer']).optional()` nos dois ramos de `createJobBodySchema` |
| `apps/api/src/auth/dto/framer-auth.dto.ts` | novo | `{ framerUserId, name? }` (espelho do FigmaAuthDto) |
| `apps/api/src/auth/dto/link-framer.dto.ts` | novo | `{ framerUserId }` |
| `apps/api/src/auth/auth.service.ts` | edição | `authFramer` + `linkFramer` (espelhos de `authFigma`/`linkFigma`, email sintético `framer+<id>@mailinator.com`) |
| `apps/api/src/auth/auth.controller.ts` | edição | Rotas `POST /v1/auth/framer` e `POST /v1/auth/link-framer` |
| `apps/api/src/jobs/jobs.service.ts` | edição | Persistir `platform` no `tx.job.create` |
| `apps/figma-plugin/src/code.ts` | edição | Enviar `platform: 'figma'` no body de `POST /v1/jobs` |
| `apps/framer-plugin/src/FramerHost.ts` | edição | `ensureFramerSession()` (auto-auth via `framer.getCurrentUser()` → `/v1/auth/framer`); import deixa de exigir login (retry 1x em 401); `link-framer` após login email/Google; `platform: 'framer'` no body do job; `session-request` faz auto-auth antes de cair no guest fake |

Sem mudança em `Job.userId` (continua obrigatório) — o auto-auth cria sempre um `User` real,
por isso quota tracking continua a funcionar por utilizador.

## Porquê

1. **Import sem conta nos dois plugins**: o padrão já está provado no Figma; replicar no
   Framer com `framer.getCurrentUser().id` remove a fricção de login no free tier.
2. **Analytics de usage por plataforma**: com `framerUserId` no `User` e `platform` no `Job`,
   passa a ser possível saber no banco de onde cada utilizador usa o app — mesmo quando a
   conta é a mesma (login email/Google nos dois plugins), porque o `link-figma`/`link-framer`
   associa as identidades de plataforma e cada job regista a origem.

## Ficheiros afectados

- `apps/api/prisma/schema.prisma` — edição
- `apps/api/prisma/migrations/<timestamp>_add_framer_user_id_and_job_platform/` — novo
- `packages/shared-contracts/src/index.ts` — edição
- `apps/api/src/auth/dto/framer-auth.dto.ts` — novo
- `apps/api/src/auth/dto/link-framer.dto.ts` — novo
- `apps/api/src/auth/auth.service.ts` — edição
- `apps/api/src/auth/auth.controller.ts` — edição
- `apps/api/src/jobs/jobs.service.ts` — edição
- `apps/figma-plugin/src/code.ts` — edição
- `apps/framer-plugin/src/FramerHost.ts` — edição
