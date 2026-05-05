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

## Nota `networkAccess`

`allowedDomains: ["*"]` é apenas para desenvolvimento com o proxy actual. Antes de produção, restringir a domínios explícitos (API + storage), conforme o guia de implementação Fase 8.
