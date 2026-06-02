# Plugin Figma (Insta2Figma)

Contratos partilhados: `@insta2figma/shared-contracts`.

## Build

Na raíz do monorepo:

```bash
pnpm exec turbo build --filter=@insta2figma/figma-plugin
```

ou `pnpm build` (builda todos os pacotes).

## Importar no Figma

1. Gerar artefactos: `pnpm build` na raíz.
2. Figma → **Plugins** → **Development** → **Import plugin from manifest…**
3. Seleccionar: `apps/figma-plugin/dist/manifest.json`

O `manifest.json` na pasta `dist/` referencia `code.js` e `ui.html` no mesmo directório (ver [ARQUITETURA-INSTA2FIGMA.md](../../docs/ARQUITETURA-INSTA2FIGMA.md) §4.4).

## Shared UI (`packages/plugin-ui`)

A UI do plugin vive em `packages/plugin-ui/src/` — **não** em `ui-src/` (que só contém o entry point `main.tsx` e `FigmaHost.ts`).

| Ficheiro | Propósito |
|----------|-----------|
| `packages/plugin-ui/src/App.tsx` | Componente raíz; recebe `{ host: PluginHost }` |
| `packages/plugin-ui/src/host.ts` | Interface `PluginHost` + tipos de mensagem |
| `packages/plugin-ui/src/HostContext.tsx` | React context para aceder ao host em componentes filhos |
| `apps/figma-plugin/ui-src/FigmaHost.ts` | Implementação Figma — wraps `parent.postMessage` |

O alias `@insta2figma/plugin-ui` e `@` em `vite.config.ts` apontam para `packages/plugin-ui/src/`, por isso imports com `@/utils/cn` resolvem correctamente.

O Tailwind v4 precisa de `@source "."` em `packages/plugin-ui/src/globals.css` para varrer os componentes do package (fora do `root` Vite).

## AlignUI (design system)

Tailwind v4 + tokens AlignUI em `ui-src/globals.css`. Componentes em `ui-src/components/ui/` (ex.: `Button.Root`, `Button.Icon`) e ícones `@remixicon/react`.

Guia de uso: [docs/ALIGNUI.md](./docs/ALIGNUI.md).

```bash
pnpm --filter @insta2figma/figma-plugin run alignui:globals   # regenerar tokens
```

Requisito: **Node 20+** para o build (Tailwind Oxide).

## Fonte da UI (React)

- Código editável em `ui-src/` (`App.tsx`, estilos). `pnpm build` corre **Vite** com **`vite-plugin-singlefile`** (JS/CSS inlinados em `dist/index.html` → `dist/ui.html`). Isto é necessário porque **`figma.showUI(__html__)`** injeta HTML no iframe: referências externas `<script src="./assets/...">` **não resolvem** e a UI fica em branco.

- Depois corre **esbuild** em `src/code.ts` com `__html__` = string do `ui.html` gerado.
- O ficheiro `ui.html` na raíz do pacote é **legado**; o build passou a gerar `dist/ui.html` a partir do Vite. Não dependas dele para produzir `dist/`.

- **Histórico:** o ecrã inicial é a lista **History / Favorites** (persistido em **`figma.clientStorage`** no main thread via mensagens `history-request` / `history-save`; o `localStorage` do iframe **não** é fiável quando fechas o plugin). Após um import com sucesso, o username é adicionado ou actualizado; **★** marca favoritos. Clique na linha abre imediatamente o formulário com username pré-preenchido. *(Avatares na lista: preferem asset assinado `profile.*`; fallback para placeholder com inicial.)*

- **Formulário de importação:** agora só exibe campos de produto (username, nº de posts, preferência de carrossel). **API base e email foram removidos da UI** para alinhar ao design; configuração de conexão/auth fica no `code.ts` (main thread).

## Uso local (MVP)

1. Corre **`pnpm bootstrap`** na raiz (onboarding automático).
2. Arranca **`pnpm dev`** na raiz (API + worker no mesmo terminal) ou `pnpm dev:api` + `pnpm dev:worker`, com `S3_*` preenchidos (mesmos valores na API e no worker que em [apps/api/.env.example](../../apps/api/.env.example)).
3. Abre o plugin (passos em «Importar no Figma»). Precisas de **sessão iniciada no Figma** (`figma.currentUser`).
4. No ecrã de importação: **username**, posts/carrossel, preview e import.
5. O `code.ts` (main) autentica com **`POST /v1/auth/figma`**, guarda JWT em `clientStorage`, chama **`GET /v1/me`** (plano/quotas), cria job `SCRAPE_PROFILE`, polling, **`?include=signedAssets`**, coloca imagens no canvas.

### Upgrade Pro (Polar)

- Banner **Upgrade to Pro** → checkout no browser (`figma.openExternal`).
- Configuração Polar + ngrok para webhooks: **[docs/DEV-POLAR-NGROK.md](../../docs/DEV-POLAR-NGROK.md)**.
- Cartão sandbox: `4242 4242 4242 4242`.

As chamadas **`fetch` à API** correm no **contexto principal do plugin** (`code.ts`), não no iframe da UI — assim **`http://127.0.0.1`** é permitido também no **Figma no browser**, sem *mixed content* no iframe. A UI envia mensagens de intenção (`profile-preview`, `import-profile`) e recebe estados via `import-status` / `import-done` / `import-error` / `profile-preview-*`.

No preview, o backend devolve `profilePicDataUrl` + estimativas (`estimatedPostCovers`, `estimatedCarouselExtras`, `estimatedImportImages`). O botão primário usa essa estimativa: **Importar X imagens**.

## Configuração da API (local vs Railway)

Em `src/api-base.ts`:

- **Local:** `http://localhost:3333` (manifest: `devAllowedDomains`)
- **Produção:** `https://insta2figma-production.up.railway.app`

Por omissão (`INSTA2FIGMA_API_MODE=auto`), ao abrir o plugin:

1. Faz probe a `GET /v1/health` na API local (2s).
2. Se responder → usa **local** (`pnpm dev` a correr).
3. Senão → usa **Railway**.

Forçar no build:

```bash
pnpm --filter @insta2figma/figma-plugin run build:local   # só localhost:3333
pnpm --filter @insta2figma/figma-plugin run build:prod    # só Railway
pnpm --filter @insta2figma/figma-plugin build             # auto (recomendado)
```

Outro domínio Railway: `INSTA2FIGMA_PRODUCTION_API_BASE=https://... pnpm --filter @insta2figma/figma-plugin build`

Sessão: `POST /v1/auth/figma`; JWT em `insta2figma:session:v1`. Ao mudar de local → produção, a sessão é limpa automaticamente.

Para MinIO/S3, o download das imagens continua a ser `fetch` no `code.ts`; confirma **`networkAccess`** e domínios assinados quando saíres de dev — ver nota abaixo.

A API deve expor **CORS** para pedidos que ainda possam vir de outros contextos; com `CORS_ORIGINS` vazio a API do monorepo define origens Figma por omissão.

## Nota `networkAccess`

`manifest.json` lista API local, Railway, CDNs Instagram e `https://t3.storageapi.dev` (object storage wrapped-mug). Se mudares de provider de storage, acrescenta o novo domínio em `allowedDomains`, faz rebuild do plugin e reimporta o manifest.
