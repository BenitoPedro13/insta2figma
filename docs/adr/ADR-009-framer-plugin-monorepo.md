# ADR-009: Suportar o plugin no Framer reutilizando a UI no monorepo

**Status:** Accepted
**Date:** 2026-06-02
**Implemented:** 2026-06-02
**Deciders:** Benito Pedro
**Tags:** plugin, framer, figma, monorepo, arquitetura, reuse, ui

---

## Context

O produto existe hoje como **plugin Figma** (`apps/figma-plugin`): o utilizador escreve um username do Instagram, vê preview do perfil, escolhe posts, e importa imagens para o canvas. O backend (API Nest + worker) é partilhado e agnóstico ao editor.

Queremos oferecer o **mesmo produto como plugin Framer**, aproveitando que já estamos num monorepo pnpm (`apps/*`, `packages/*`) e que o backend não muda. A questão é **quanto da UI e da lógica do plugin Figma pode ser reutilizada**, e **como estruturar isso**.

> **Nota de contexto (2026-06-02):** o plugin Figma **ainda não está em produção** — está em fim de desenvolvimento. Isto enfraquece bastante o driver de "não desestabilizar produção": não há produção a proteger. Logo, faz sentido fazer a extração partilhada **já**, enquanto o código está fresco e os dois plugins passam a ser desenvolvidos em conjunto, em vez de duplicar primeiro e consolidar depois.

### A diferença arquitetural fundamental

Esta é a decisão que molda tudo o resto.

| | **Figma (atual)** | **Framer (alvo)** |
|---|---|---|
| Modelo | Dois contextos: `code.ts` (main thread sandbox, sem DOM) + `ui-src/` (iframe React) | **Um único iframe React** que importa `framer` de `framer-plugin` |
| Comunicação | `postMessage` entre `code.ts` ↔ iframe | Chamadas diretas ao objeto `framer` (async) |
| Rede (`fetch`) | Só no `code.ts`, e é **buffered** (proxy via `postMessageAndWait`, sem streaming) | `fetch` real do browser no iframe (com CORS) |
| Storage | `figma.clientStorage` (só main thread) | `localStorage` real do browser |
| Identidade do editor | `figma.currentUser.id` (usado no auth legado / `link-figma`) | Sem equivalente directo; irrelevante com o auth novo (magic link + Google) |
| Inserir imagem | `figma.createImage(bytes)` + geometria manual de retângulos | `framer.addImage({ image: url })` — **aceita URLs directamente** |
| Abrir URL externo | `figma.openExternal(url)` | `window.open(url)` / API do Framer |
| Janela | `figma.ui` (tamanho no manifest) | `framer.showUI({ width, height, position, resizable })` |

Fonte: Framer Developers — Concepts ("plugins são aplicações React a correr num iframe seguro; ao contrário do modelo de dois threads do Figma, o Framer usa um único iframe que comunica com o editor via a API `framer`").

### Estado real do acoplamento na UI atual

Levantamento do código (`apps/figma-plugin/ui-src`):

- **Apenas 3 ficheiros** tocam em `postMessage`: `App.tsx`, `components/PluginResizeHandle.tsx`, `components/ProUpgradeOverlay.tsx` (29 chamadas no total, concentradas no `App.tsx`).
- **Todo o resto** — `components/*`, `components/ui/*`, `screens/*` (ImportScreen, ListScreen, LoginScreen), `lib/*`, `utils/*` — é **React + Tailwind puro, sem qualquer acoplamento ao host**.
- `@insta2figma/shared-contracts` **já é consumido** pelo `ui-src` (App, planTier, previewEstimates, ImportScreen, ListScreen) — ou seja, o build do plugin já resolve packages do workspace. Um novo `packages/*` resolve da mesma forma.

**Conclusão:** a esmagadora maioria da UI é portável tal como está. O acoplamento ao Figma está concentrado em ~3 ficheiros e na camada `code.ts`.

---

## Problem Statement

**Como adicionar `apps/framer-plugin` reutilizando o máximo da UI existente, sem duplicar código a longo prazo e sem pôr em risco o plugin Figma em produção?**

---

## Decision Drivers

1. **Reuse máximo** — a UI (componentes, screens, estilos, libs puras) deve ser partilhada, não copiada.
2. **Não regredir o Figma** — o plugin Figma está em fim de desenvolvimento (auth, billing, import, long-poll funcionam). Não está em produção, por isso o custo de uma regressão é baixo (apanha-se em dev), mas continuamos a querer paridade de comportamento ao migrar.
3. **Backend inalterado** — a API e o worker servem ambos os plugins sem mudanças (excepto CORS).
4. **Diferença de host isolada** — rede, storage, inserção de imagem e abertura de URLs diferem entre Figma e Framer; essa diferença deve estar atrás de uma fronteira única.
5. **Validar incógnitas cedo** — várias suposições sobre o Framer precisam de um spike antes de comprometer arquitetura (ver Spikes).

---

## Considered Options

### Opção A: Copiar `ui-src` para `apps/framer-plugin` e adaptar

**Como:** duplicar a pasta `ui-src` no novo app, trocar as chamadas `postMessage` por chamadas `framer`/`fetch`.

**Prós:** arranque rápido; zero risco para o Figma (não se toca nele).

**Contras:** duplicação permanente — cada correção/feature de UI passa a ter de ser feita em dois sítios. Diverge com o tempo. Contraria o driver #1.

**Decisão:** rejeitado como solução final. (Útil só como atalho de spike descartável.)

### Opção B: Extrair a UI partilhada para `packages/plugin-ui` + adaptador de host (recomendado)

**Como:** mover os componentes/screens/libs puros para um package partilhado. Definir uma interface `PluginHost` que abstrai as 4 operações específicas do editor (rede, storage, inserir imagem, abrir URL). Cada app fornece o seu adaptador:
- `apps/figma-plugin` → adaptador que faz bridge via `postMessage` para `code.ts` (mantém o que já existe).
- `apps/framer-plugin` → adaptador que chama `framer`/`fetch`/`localStorage` diretamente.

**Prós:**
- UI partilhada de verdade — uma correção serve os dois plugins.
- A diferença de host fica num único ficheiro por app (o adaptador).
- Faseável: o Framer entra primeiro consumindo o package; o Figma só migra para o package depois, quando o Framer estiver validado.

**Contras:**
- Exige extrair e parametrizar a UI (refactor moderado, mas de baixo risco — o acoplamento são 3 ficheiros).

**Decisão:** **adoptado**, em fases (ver Implementation Plan).

### Opção C: Reescrever já a UI atrás de uma abstração total agora

**Como:** refatorar o Figma e construir o Framer em simultâneo sobre a abstração, num só passo.

**Contras:** mexe no plugin Figma de produção ao mesmo tempo que se valida uma plataforma nova com incógnitas por resolver — viola o driver #2. Risco concentrado.

**Decisão:** rejeitado — o mesmo destino (Opção B fase 3) atingido com menos risco se for faseado.

---

## Decision

**Opção B, faseada:** extrair `packages/plugin-ui` com uma interface `PluginHost`; construir `apps/framer-plugin` a consumir o package com um adaptador Framer; migrar o Figma para o package só numa fase posterior. A diferença entre editores vive exclusivamente no adaptador de host de cada app.

### A interface `PluginHost`

A fronteira única entre a UI partilhada e cada editor. Só estas operações diferem entre Figma e Framer:

```ts
// packages/plugin-ui/src/host.ts
export interface PluginHost {
  // — Sessão / storage —
  loadSession(): Promise<StoredSession | null>;
  saveSession(session: StoredSession): Promise<void>;
  clearSession(): Promise<void>;

  // — Histórico / favoritos —
  loadHistory(): Promise<HistoryEntry[]>;
  saveHistory(entries: HistoryEntry[]): Promise<void>;

  // — Rede — (Figma: proxy via code.ts; Framer: fetch directo)
  apiFetch(url: string, init?: RequestInit): Promise<Response>;

  // — Inserir imagens no canvas —
  placeImages(assets: SignedImageAsset[], opts: PlaceOptions): Promise<PlaceResult>;

  // — URLs externos (checkout, OAuth, links) —
  openExternal(url: string): void;

  // — Identidade do editor (Figma tem; Framer devolve null) —
  getEditorUserId(): string | null;

  // — Tamanho/relayout da janela do plugin (opcional) —
  resize?(width: number, height: number): void;
}
```

A UI partilhada (`App` + screens) recebe um `PluginHost` e nunca chama `figma.*`, `framer.*`, `postMessage`, `fetch` ou `localStorage` diretamente. Toda a especificidade de plataforma resolve-se no adaptador.

---

## Inventário: reutilizável vs. net-new

### Reutilizável tal como está (mover para `packages/plugin-ui`)
- `components/ui/*` (button, input, slider, switch, checkbox, segmented-control, pagination, tooltip, fancy-button…) — puros.
- `components/*` presentacionais (AccountBadge, PostPreviewList, Skeletons, PostCountSlider, ImportStatusLine, PanelHeader, PluginMenuDropdown…).
- `screens/ImportScreen.tsx`, `ListScreen.tsx`, `LoginScreen.tsx` — presentacionais via callbacks.
- `lib/planTier.ts`, `lib/previewEstimates.ts`, `lib/pluginLinks.ts` — puros.
- `lib/historyStorage.ts` — a lógica de merge/sort é pura; a persistência passa a vir do `PluginHost`.
- `utils/*`, `index.css`/tokens Tailwind, `hooks/use-tab-observer.ts`.
- `@insta2figma/shared-contracts` — já partilhado; sem mudança.

### Refactor pequeno (parametrizar pelo `PluginHost`)
- `App.tsx` — substituir as 29 chamadas `postMessage` por chamadas `host.*`. É o grosso do trabalho de extração, mas mecânico.
- `components/PluginResizeHandle.tsx` → `host.resize?.()`.
- `components/ProUpgradeOverlay.tsx` → `host.openExternal` / fluxo de checkout via host.

### Net-new no `apps/framer-plugin`
- Scaffold `framer-plugin` (`npm create framer-plugin@latest`): `framer.json`, `vite.config`, `index.html`, `main.tsx`.
- **Adaptador Framer** (`FramerHost implements PluginHost`):
  - `apiFetch` → `fetch` directo.
  - `load/saveSession`, `load/saveHistory` → `localStorage`.
  - `openExternal` → `window.open` (ou API Framer — spike).
  - `getEditorUserId` → `null`.
  - `placeImages` → `framer.addImage({ image: url })` por asset + layout no modelo de nós do Framer (**a única peça de lógica genuinamente nova** — ver spike de layout).
- `framer.showUI({...})` no arranque com as dimensões da UI.

### Backend
- **Única mudança:** acrescentar a origin do iframe do Framer a `CORS_ORIGINS` (a API já permite `null` + domínios Figma; ver `apps/api/src/main.ts`). A origin exacta do Framer é um spike (#1).

---

## Implementation Plan (faseado)

### Fase 0 — Spikes (validar incógnitas antes de comprometer arquitetura)
Spike descartável: um `apps/framer-plugin` mínimo via `npm create framer-plugin@latest` que valida, com hardcode:
1. **CORS / origin** — `fetch` autenticado à API Railway a partir do iframe Framer funciona? Qual é o `Origin` enviado? → define o valor a pôr em `CORS_ORIGINS`.
2. **`framer.addImage({ image: url })`** — aceita uma URL assinada do nosso S3 e a URL do proxy de imagem da API? Coloca no canvas?
3. **`window.open`** — abre o checkout Polar / OAuth Google a partir do iframe? Se bloqueado, qual é a API do Framer para abrir URL externo?
4. **`localStorage`** — persiste entre reaberturas do plugin no Framer?
5. **Long-poll** — `GET /v1/me/plan-events` segurado ~25s funciona do iframe Framer (é `fetch` normal; deve funcionar).
6. **Layout de grelha** — qual o caminho no modelo de nós do Framer para colocar N imagens numa grelha (ou aceitar o placement default)?

### Fase 1 — Extrair `packages/plugin-ui` e migrar o Figma
1. Criar `packages/plugin-ui` (mesmo padrão de package do workspace).
2. Mover os ficheiros puros (inventário acima) para lá.
3. Definir `PluginHost` e refatorar `App.tsx` para receber um `host`.
4. Criar `FigmaHost implements PluginHost` em `apps/figma-plugin` que faz exactamente o bridge `postMessage` actual.
5. O `apps/figma-plugin` passa a importar a UI do package, injectando `FigmaHost`. **Validar paridade de comportamento** (auth, preview, import, billing, long-poll) antes de seguir.

### Fase 2 — `apps/framer-plugin`
1. Scaffold com `framer-plugin` SDK.
2. `FramerHost implements PluginHost`.
3. Importar a UI de `packages/plugin-ui`, injectar `FramerHost`, `framer.showUI(...)`.
4. Implementar `placeImages` no modelo de nós do Framer (resultado do spike #6).
5. Acrescentar a origin do Framer a `CORS_ORIGINS` (resultado do spike #1).

### Ordem recomendada (Figma não está em produção)
Como não há produção a proteger, **extrair o package partilhado já** (Fase 1) e construir o Framer por cima (Fase 2) é o caminho mais limpo: evita duplicação desde o início e os dois plugins partilham a UI a partir do primeiro dia. Uma regressão na migração do Figma apanha-se em dev a custo baixo.

> Só se preferíssemos um demo Framer no ar antes de mexer no Figma é que valeria a pena a ordem inversa (Framer com cópia temporária → extrair depois). Com o Figma em dev, isto deixou de ser necessário.

---

## Spikes / Open Questions

1. **Origin do iframe Framer** (CORS) — **bloqueante**. Sem isto, nem auth nem import funcionam. Validar antes de tudo.
2. **`framer.addImage` com URLs do nosso S3/proxy** — confirma que evitamos toda a lógica de download/bytes do Figma. Quase certo, mas validar.
3. **Abrir URL externo** (`window.open` vs API Framer) — afecta checkout + Google OAuth.
4. **`localStorage` persistente** no plugin Framer — afecta sessão/JWT e histórico.
5. **Layout de import** — modelo de nós do Framer para grelha de N imagens; é o único net-new de lógica de canvas.
6. **Identidade do editor** — confirmar que o Framer não dá um user id estável; com o auth novo (magic link + Google) isto é irrelevante, mas convém confirmar que não há regressão de portabilidade de sessão.
7. **`framer.showUI` dimensões/resizable** — mapear o layout atual (UI larga com sidebar) para os limites do Framer.

---

## Consequences

### Positivo
- UI partilhada real: uma base de componentes/screens para os dois editores.
- Diferença de plataforma isolada num único adaptador por app (`PluginHost`).
- Backend praticamente inalterado (só CORS).
- O Framer **simplifica** partes: `fetch` real (sem o proxy buffered do Figma), `addImage` por URL (sem download/bytes/prefetch), `localStorage` (sem clientStorage), e o auth novo (magic link + Google) dispensa a identidade do editor.
- Faseável: o Figma de produção pode ficar intacto durante a validação do Framer.

### Negativo
- Refactor de extração da UI (concentrado em ~3 ficheiros + `App.tsx`).
- `placeImages` para o Framer é lógica genuinamente nova (modelo de nós/layout diferente).
- Duas pipelines de build (Figma: build.mjs custom; Framer: vite do SDK).

### Riscos

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Origin do Framer não permitida por CORS | Média | Spike #1 primeiro; adicionar a `CORS_ORIGINS` |
| `addImage` não aceitar as nossas URLs | Baixa | Spike #2; fallback: `addImage({ image: { type: 'bytes', bytes, mimeType } })` |
| `window.open` bloqueado no iframe | Média | Spike #3; usar API de URL externo do Framer |
| Extração da UI introduzir regressão no Figma | Média | Ordem alternativa: Framer primeiro com cópia; migrar Figma só com paridade validada |
| Layout de grelha no Framer ser limitado | Média | Aceitar placement default na v1; refinar depois |

---

## References

- Framer Developers — Concepts: arquitetura de iframe único, API `framer` ([framer.com/developers/concepts](https://www.framer.com/developers/concepts))
- Framer Developers — Assets: `addImage`/`uploadImage`/`addSVG` (aceitam URL, File, bytes) ([framer.com/developers/assets](https://www.framer.com/developers/assets))
- Framer Developers — Modes & showUI ([framer.com/developers/modes](https://www.framer.com/developers/modes), [reference/plugins-show-ui](https://www.framer.com/developers/reference/plugins-show-ui))
- Framer Developers — Quick Start: `npm create framer-plugin@latest` ([framer.com/developers/plugins-quick-start](https://www.framer.com/developers/plugins-quick-start))
- `apps/figma-plugin/ui-src/App.tsx` — hub de `postMessage` (29 chamadas; a parametrizar pelo `PluginHost`)
- `apps/figma-plugin/src/code.ts` — lógica de host do Figma (a espelhar no `FigmaHost`/`FramerHost`)
- `apps/api/src/main.ts:29-54` — allowlist de CORS (acrescentar origin do Framer)
- ADR-008 — long-polling do plano; o endpoint `/v1/me/plan-events` é reutilizado tal e qual pelo Framer
- `docs/AUTH.md` — auth por magic link + Google; agnóstico ao editor, central para o Framer
```
