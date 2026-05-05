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

## Uso local (MVP)

1. **`pnpm infra:up`**, **`pnpm dev:api`** e **`pnpm dev:worker`**, com `S3_*` preenchidos (mesmos valores na API e no worker que em [apps/api/.env.example](../../apps/api/.env.example)).
2. Abre o plugin (passos acima) e define **API** (ex.: `http://127.0.0.1:3333`), **email** e **username** Instagram → **Importar perfil para o canvas**.
3. A UI obtém JWT (`register` ou `login`), cria um job `SCRAPE_PROFILE`, faz polling até `succeeded`, chama **`?include=signedAssets`** e envia as URLs ao `code.ts`, que faz `fetch`, `createImage` e uma grelha de rectângulos.

As chamadas **`fetch` à API** correm no **contexto principal do plugin** (`code.ts`), não no iframe da UI — assim **`http://127.0.0.1`** é permitido também no **Figma no browser**, sem *mixed content* no iframe. A UI apenas envia `{ type: 'import-profile', base, email, username }` e recebe actualizações via `import-status` / `import-done` / `import-error`.

Para MinIO/S3, o download das imagens continua a ser `fetch` no `code.ts`; confirma **`networkAccess`** e domínios assinados quando saíres de dev — ver nota abaixo.

A API deve expor **CORS** para pedidos que ainda possam vir de outros contextos; com `CORS_ORIGINS` vazio a API do monorepo define origens Figma por omissão.

## Nota `networkAccess`

`allowedDomains: ["*"]` é apenas para desenvolvimento com o proxy actual. Antes de produção, restringir a domínios explícitos (API + storage), conforme o guia de implementação Fase 8.
