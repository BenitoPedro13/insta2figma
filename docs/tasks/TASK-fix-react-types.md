# TASK: Fix React type declarations em packages/plugin-ui

**Status:** Em progresso  
**Data:** 2026-06-11

---

## Cenário actual

`packages/plugin-ui` não consegue resolver os tipos do React:
- `Cannot find declaration file for module 'react'` (TS7016)
- `Cannot find declaration file for module 'react/jsx-runtime'` (TS7016)

Como consequência, todos os callbacks de `setState` perdem inferência de tipo e os parâmetros `prev` ficam implicitamente `any` (TS7006).

Causa: pnpm não faz hoisting por defeito — cada package só vê as dependências que declarar explicitamente no seu `package.json`. Se `@types/react` estiver só no `devDependencies` do app (framer-plugin, figma-plugin) mas não no `packages/plugin-ui`, o TypeScript não o encontra ao compilar esse package isoladamente.

---

## Mudanças planeadas

### 1. `packages/plugin-ui/package.json`
Adicionar `@types/react` e `@types/react-dom` em `devDependencies` (ou como peerDevDependencies) para que o package resolva os tipos directamente, independente do app que o consome.

### 2. `packages/plugin-ui/tsconfig.json` (se necessário)
Confirmar que `"types": ["react"]` ou paths estão correctos.

---

## Porquê

Sem os tipos do React o TS infere `any` em todos os callbacks de setState, perdendo-se toda a segurança de tipos em `App.tsx`. Além disso, o LSP do VS Code fica com erros em todo o ficheiro, tornando o desenvolvimento difícil.

---

## Ficheiros afectados

| Ficheiro | Tipo de mudança |
|----------|----------------|
| `packages/plugin-ui/package.json` | Edição |
| `packages/plugin-ui/tsconfig.json` | Edição (se necessário) |
