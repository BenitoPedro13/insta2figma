# Auth — Magic Link + Google OAuth + Auto-auth por plataforma

Sistema de autenticação dos plugins Figma e Framer. Os utilizadores autenticam-se com **magic link** (email) ou **Google OAuth**, ou usam o free tier **sem login** via auto-auth com a identidade da plataforma. As contas são portáteis — o mesmo utilizador pode usar o plugin em qualquer workspace Figma/projecto Framer.

## Arquitectura

```
Plugin (Figma)                  API (Railway)               Google
──────────────                  ─────────────               ──────
bootstrap
  └─ loadStoredSession
       ├─ tem JWT válido  ──▶  GET /v1/me  ──▶  session-data (UI)
       ├─ expira < 2 dias ──▶  POST /auth/refresh
       └─ sem sessão      ──▶  show-login (overlay)

Magic link
  └─ email ──▶ POST /auth/magic-link  ──▶  Gmail API envia email
  └─ polling GET /auth/poll?pollingId=
  └─ user clica link ──▶ GET /auth/magic-link/verify ──▶ JWT stored
  └─ poll retorna done + JWT ──▶ sessão guardada

Google OAuth
  └─ GET /auth/google/start ──▶ URL OAuth + pollingId
  └─ figma.openExternal(url) ──▶ user autentica no browser
  └─ GET /auth/google/callback ──▶ JWT stored
  └─ poll retorna done + JWT ──▶ sessão guardada
```

## Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/v1/auth/magic-link` | Envia email com link, devolve `pollingId` |
| `GET`  | `/v1/auth/magic-link/verify` | Verifica token, cria utilizador, guarda JWT |
| `GET`  | `/v1/auth/google/start` | Devolve URL OAuth Google + `pollingId` |
| `GET`  | `/v1/auth/google/callback` | Callback Google, guarda JWT |
| `GET`  | `/v1/auth/poll?pollingId=` | Plugin faz polling até `status: done` |
| `POST` | `/v1/auth/refresh` | Renova JWT (requer auth) |
| `POST` | `/v1/auth/link-figma` | Liga `figmaUserId` à conta (requer auth) |
| `POST` | `/v1/auth/link-framer` | Liga `framerUserId` à conta (requer auth) |
| `POST` | `/v1/auth/figma` | Auto-auth por `figmaUserId` — free tier sem login |
| `POST` | `/v1/auth/framer` | Auto-auth por `framerUserId` — free tier sem login |

## Auto-auth sem login (free tier)

Nenhuma das plataformas expõe o email do utilizador ao plugin (`figma.currentUser` dá
`id`/`name`/`photoUrl`; `framer.getCurrentUser()` dá `id`/`name`/`avatarUrl`/`initials`).
Por isso, quando não há sessão, os plugins autenticam silenciosamente com a identidade
da plataforma:

- **Figma:** `ensureSession` (`code.ts`) → `POST /v1/auth/figma` com `figma.currentUser.id`
- **Framer:** `ensureFramerSession` (`FramerHost.ts`) → `POST /v1/auth/framer` com `framer.getCurrentUser().id`

O backend cria (ou reutiliza) um `User` com email sintético:
`figma+<id>@mailinator.com` / `framer+<id>@mailinator.com`. O utilizador fica no plano
free com quota tracking normal. O login real (magic link/Google) é o caminho de upgrade.

## Identidade de plataforma e analytics

- `User.figmaUserId` e `User.framerUserId` (ambos unique, nullable) registam de onde o
  utilizador usa o app — mesmo quando a conta é a mesma (login com o mesmo email nos
  dois plugins), porque `link-figma`/`link-framer` associam as identidades após o login.
- Cada job grava `Job.platform` (`"figma" | "framer"`), enviado pelos plugins no body de
  `POST /v1/jobs` — é a base para analytics de usage por plataforma.

## Env vars necessárias (Railway → API service)

```env
# URL pública da API — usada nos links de magic link
PUBLIC_API_URL=https://insta2figma-production.up.railway.app

# Google Cloud OAuth2 credentials
GOOGLE_CLIENT_ID=<client_id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client_secret>
GOOGLE_CALLBACK_URL=https://insta2figma-production.up.railway.app/v1/auth/google/callback

# Refresh token do Gmail (para enviar emails via Gmail API)
GOOGLE_REFRESH_TOKEN=<refresh_token>
GMAIL_FROM=teu@gmail.com

# JWT — aumentar para 30d para reduzir re-logins
JWT_EXPIRES_IN=30d
```

## Configuração Google Cloud (setup inicial)

### 1. Criar projecto e activar APIs

1. [console.cloud.google.com](https://console.cloud.google.com) → New Project → `Insta2Figma`
2. **APIs & Services → Library** → activar:
   - **Gmail API**
   - **Google Identity / People API**

### 2. OAuth Consent Screen

1. **APIs & Services → OAuth consent screen**
2. User Type: **External** → Create
3. Preencher:
   - App name: `Insta2Figma`
   - User support email: teu email
   - Developer contact: teu email
4. Scopes: adicionar `https://mail.google.com/` e `email`, `profile`
5. Test users: adicionar o teu email
6. **Publicar app** (In production) — evita refresh token a expirar a cada 7 dias

### 3. Criar credenciais OAuth2

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Insta2Figma`
4. Authorized redirect URIs:
   ```
   https://insta2figma-production.up.railway.app/v1/auth/google/callback
   https://developers.google.com/oauthplayground
   ```
5. Copiar **Client ID** e **Client Secret** → Railway env vars

### 4. Gerar Refresh Token (Gmail API)

> Só precisas de fazer isto uma vez. O refresh token não expira se o app estiver publicado.

1. Abre [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. ⚙️ (topo direito) → **Use your own OAuth credentials**
   - OAuth Client ID: `<GOOGLE_CLIENT_ID>`
   - OAuth Client Secret: `<GOOGLE_CLIENT_SECRET>`
3. Em "Input your own scopes" escreve: `https://mail.google.com/`
4. Clica **Authorize APIs** → faz login com a conta Gmail que vai enviar os emails
5. Clica **Exchange authorization code for tokens**
6. Copia o **Refresh Token** → `GOOGLE_REFRESH_TOKEN` no Railway

### 5. Regenerar Refresh Token (se expirar)

O refresh token expira se:
- O app estiver em modo "Testing" (expira em 7 dias) — **solução: publicar o app**
- O utilizador revogar o acesso em myaccount.google.com/permissions

Para regenerar: repete o Passo 4 e actualiza `GOOGLE_REFRESH_TOKEN` no Railway.

## Sessão do plugin

A sessão é guardada em `figma.clientStorage` com:

```typescript
{
  accessToken: string,  // JWT
  userId: string,       // ID do utilizador na nossa BD
  figmaUserId: string,  // ID do utilizador no Figma (para portabilidade)
  expiresAt: number,    // timestamp ms
}
```

**Ciclo de vida:**
- JWT dura `JWT_EXPIRES_IN` (padrão: 30 dias)
- Plugin renova automaticamente quando faltam < 2 dias para expirar (`POST /auth/refresh`)
- Se o JWT expirar de vez sem conseguir renovar → tenta auto-auth silencioso via
  identidade da plataforma; só se isso falhar aparece o overlay de login
- Sign out: menu ≡ → Sign out → apaga sessão local + overlay de login (dismissable —
  o free tier continua a funcionar via auto-auth)

## Portabilidade entre workspaces Figma

Após login (magic link ou Google), o plugin chama `POST /auth/link-figma` para ligar o `figmaUserId` actual à conta. Assim o mesmo utilizador pode usar o plugin em qualquer workspace Figma sem fazer login de novo — basta que a sessão não tenha expirado.

Se o utilizador abrir o plugin num workspace diferente sem sessão guardada, faz login uma vez e a conta é ligada automaticamente.

## Adicionar redirect URI para desenvolvimento local

Se precisas de testar Google OAuth localmente, adiciona ao Google Cloud → Credentials → Authorized redirect URIs:
```
http://localhost:3333/v1/auth/google/callback
```
E define localmente:
```env
GOOGLE_CALLBACK_URL=http://localhost:3333/v1/auth/google/callback
```
