# Insta2Figma

Monorepo descrito em [docs/ARQUITETURA-INSTA2FIGMA.md](docs/ARQUITETURA-INSTA2FIGMA.md).

## Requisitos

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9 (`corepack enable` recomendado)

## Comandos

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Importar no Figma após `pnpm build`: `apps/figma-plugin/dist/manifest.json` — ver [apps/figma-plugin/README.md](apps/figma-plugin/README.md).
