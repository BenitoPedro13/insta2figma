# TASK: Preview anónimo após logout funciona

**Status:** Em progresso  
**Data:** 2026-06-11

---

## Cenário actual

Após logout o utilizador fica bloqueado na LoginScreen e não consegue usar o preview.

**Causa 1 — logout não é dismissable:**
- Figma `code.ts`: `auth-logout` emite `{ type: 'show-login' }` sem `dismissable: true` → overlay não tem botão de fechar
- Framer `FramerHost.handleLogout()`: igual — `{ type: 'show-login' }` sem `dismissable: true`

**Causa 2 — Figma preview exige sessão:**
- `previewProfileViaApi()` (linha ~1251 em `code.ts`) chama `ensureSession(base)` que exige token válido
- Mesmo que o utilizador dispensasse o overlay, o próximo preview tentaria `ensureSession` → criaria conta silenciosa via `authFigmaUser` (o que é aceitável) mas lança erro se `figma.currentUser` não estiver disponível

---

## Mudanças planeadas

### 1. `apps/figma-plugin/src/code.ts`
- `auth-logout`: emitir `{ type: 'show-login', dismissable: true }` em vez de sem flag
- `previewProfileViaApi()`: tornar o token opcional — se não há sessão, fazer o pedido sem `Authorization` header (API já aceita anónimo via `OptionalJwtAuthGuard`)

### 2. `apps/framer-plugin/src/FramerHost.ts`
- `handleLogout()`: emitir `session-data` com free tier guest antes do `show-login`, e marcar `dismissable: true`

### 3. `packages/plugin-ui/src/App.tsx`
- Quando `show-login` chega, resetar `planTier` para `'free'` e `imagesRemaining` para `null` — para que ao dispensar o overlay o UI mostre free tier, não o tier anterior

---

## Ficheiros afectados

| Ficheiro | Tipo de mudança |
|----------|----------------|
| `apps/figma-plugin/src/code.ts` | Edição |
| `apps/framer-plugin/src/FramerHost.ts` | Edição |
| `packages/plugin-ui/src/App.tsx` | Edição |
