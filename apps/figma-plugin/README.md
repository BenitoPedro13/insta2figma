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

## Fonte da UI (React)

- Código editável em `ui-src/` (`App.tsx`, estilos). `pnpm build` corre **Vite** com **`vite-plugin-singlefile`** (JS/CSS inlinados em `dist/index.html` → `dist/ui.html`). Isto é necessário porque **`figma.showUI(__html__)`** injeta HTML no iframe: referências externas `<script src="./assets/...">` **não resolvem** e a UI fica em branco.

- Depois corre **esbuild** em `src/code.ts` com `__html__` = string do `ui.html` gerado.
- O ficheiro `ui.html` na raíz do pacote é **legado**; o build passou a gerar `dist/ui.html` a partir do Vite. Não dependas dele para produzir `dist/`.

- **Histórico:** o ecrã inicial é a lista **History / Favorites** (persistido em **`figma.clientStorage`** no main thread via mensagens `history-request` / `history-save`; o `localStorage` do iframe **não** é fiável quando fechas o plugin). Após um import com sucesso, o username é adicionado ou actualizado; **★** marca favoritos. Clique na linha abre imediatamente o formulário com username pré-preenchido. *(Avatares na lista: preferem asset assinado `profile.*`; fallback para placeholder com inicial.)*

- **Formulário de importação:** agora só exibe campos de produto (username, nº de posts, preferência de carrossel). **API base e email foram removidos da UI** para alinhar ao design; configuração de conexão/auth fica no `code.ts` (main thread).

## Uso local (MVP)

1. **`pnpm infra:up`**, **`pnpm dev:api`** e **`pnpm dev:worker`**, com `S3_*` preenchidos (mesmos valores na API e no worker que em [apps/api/.env.example](../../apps/api/.env.example)).
2. Abre o plugin (passos em «Importar no Figma»). No ecrã de importação, preenche **username**, ajusta posts/carrossel, valida o preview e importa.
3. O `code.ts` (main) obtém JWT (`register`/`login`), cria job `SCRAPE_PROFILE`, faz polling até `succeeded`, chama **`?include=signedAssets`** e envia as URLs ao canvas.

As chamadas **`fetch` à API** correm no **contexto principal do plugin** (`code.ts`), não no iframe da UI — assim **`http://127.0.0.1`** é permitido também no **Figma no browser**, sem *mixed content* no iframe. A UI envia mensagens de intenção (`profile-preview`, `import-profile`) e recebe estados via `import-status` / `import-done` / `import-error` / `profile-preview-*`.

No preview, o backend devolve `profilePicDataUrl` + estimativas (`estimatedPostCovers`, `estimatedCarouselExtras`, `estimatedImportImages`). O botão primário usa essa estimativa: **Importar X imagens**.

## Configuração interna do plugin (dev)

Atualmente os defaults de conexão/auth ficam no `code.ts`:

- `DEFAULT_API_BASE`
- `DEFAULT_SESSION_EMAIL`

Isto remove ruído da UI e alinha ao design. Para produção, mover esta configuração para fluxo de sessão real ou settings controlados.

Para MinIO/S3, o download das imagens continua a ser `fetch` no `code.ts`; confirma **`networkAccess`** e domínios assinados quando saíres de dev — ver nota abaixo.

A API deve expor **CORS** para pedidos que ainda possam vir de outros contextos; com `CORS_ORIGINS` vazio a API do monorepo define origens Figma por omissão.

## Nota `networkAccess`

`allowedDomains: ["*"]` é apenas para desenvolvimento com o proxy actual. Antes de produção, restringir a domínios explícitos (API + storage), conforme o guia de implementação Fase 8.
