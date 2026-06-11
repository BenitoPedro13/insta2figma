# TASK: Uso anónimo dos plugins (sem obrigatoriedade de conta)

**Status:** Em progresso  
**Data:** 2026-06-11

---

## Cenário actual

### Figma plugin
- `bootstrapSession()` em `apps/figma-plugin/src/code.ts` cria conta silenciosa via `authFigmaUser(figmaUserId)` quando não há sessão guardada — na prática o utilizador Figma raramente vê o ecrã de login.
- Problema residual: quando o token expira **e** o refresh falha, envia `show-login` ao UI, bloqueando o plugin mesmo o utilizador já tendo conta.

### Framer plugin
- `FramerHost.handleSessionRequest()` em `apps/framer-plugin/src/FramerHost.ts` emite `{ type: 'show-login' }` imediatamente se `this.token` estiver vazio. Plugin completamente bloqueado sem login.
- `handleProfilePreview()` e `handleImport()` enviam sempre `Authorization: Bearer <token>`. Sem token → 401 na API.

### API
- `GET /v1/instagram/profile-preview` tem `@UseGuards(AuthGuard('jwt'))` → rejeita pedidos sem JWT válido com 401.
- `POST /v1/jobs` também requer JWT (mantém-se, por design).

### Plugin UI
- `LoginScreen` é um overlay bloqueante sobre todo o UI quando `showLogin = true`.
- Não há forma de fechar o overlay sem fazer login.

---

## Objectivo

Permitir que ambos os plugins funcionem sem conta criada. Free tier aplica-se a utilizadores anónimos. Login continua disponível para aceder a Pro/Max.

---

## Mudanças planeadas

### 1. `apps/api/src/auth/optional-jwt-auth.guard.ts` *(ficheiro novo)*
Guard NestJS que não lança excepção quando o JWT está ausente ou inválido — retorna `null` como user. Token presente e válido continua a popular `req.user` normalmente.

### 2. `apps/api/src/instagram/instagram.controller.ts`
- Substituir `@UseGuards(AuthGuard('jwt'))` por `@UseGuards(OptionalJwtAuthGuard)` no `getProfilePreview`.
- `req.user` tipado como `RequestUser | null`.
- Sem user: usa `planTier = 'free'` directamente (sem query à BD) e `callerUserId = null`.

### 3. `apps/figma-plugin/src/code.ts`
- Em `bootstrapSession()`, quando token expira + refresh falha: tentar `authFigmaUser` como fallback em vez de emitir `show-login`. O `show-login` só dispara se esse fallback também falhar.

### 4. `apps/framer-plugin/src/FramerHost.ts`
- `handleSessionRequest()`: sem token → emitir `session-data` com free tier guest (sem `show-login`).
- `handleProfilePreview()`: não enviar header `Authorization` quando não há token.
- `handleImport()`: se não há token → emitir `show-login` antes de prosseguir (import requer conta).

### 5. `packages/plugin-ui/src/screens/LoginScreen.tsx`
- Adicionar prop `onDismiss?: () => void`. Quando presente, mostrar botão de fechar no overlay.

### 6. `packages/plugin-ui/src/App.tsx`
- Passar `onDismiss` ao `LoginScreen` quando o login não é obrigatório (ex: utilizador carregou em "Sign in" voluntariamente).
- Quando `show-login` chega de import sem autenticação (Framer), o dismiss fecha o overlay sem logout.

---

## Porquê

O modelo actual força criação de conta antes de qualquer interacção com o plugin. Isso cria fricção desnecessária no onboarding, especialmente no Framer onde não existe o fallback de auto-auth via Figma user ID. O free tier já define limites suficientes para uso anónimo (3 páginas de preview, quota de imagens). Utilizadores anónimos que queiram importar ou aumentar limites são incentivados a criar conta — mas não bloqueados antes de ver valor.

---

## Ficheiros afectados

| Ficheiro | Tipo de mudança |
|----------|----------------|
| `apps/api/src/auth/optional-jwt-auth.guard.ts` | Novo |
| `apps/api/src/instagram/instagram.controller.ts` | Edição |
| `apps/figma-plugin/src/code.ts` | Edição |
| `apps/framer-plugin/src/FramerHost.ts` | Edição |
| `packages/plugin-ui/src/screens/LoginScreen.tsx` | Edição |
| `packages/plugin-ui/src/App.tsx` | Edição |
