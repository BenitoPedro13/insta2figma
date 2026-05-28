# AlignUI no plugin Figma

Design system [AlignUI](https://alignui.com/docs/v1.2/installation/next) integrado em **Vite + React** (não Next.js).

## Uso padrão

### Botão + ícone Remix

```tsx
import * as Button from '@/components/ui/button';
import { RiInstagramFill } from '@remixicon/react';

export function Example() {
  return (
    <Button.Root variant="primary" mode="filled" size="medium">
      <Button.Icon as={RiInstagramFill} />
      Import Feed
    </Button.Root>
  );
}
```

### Utilitário `cn`

```tsx
import { cn } from '@/utils/cn';

<div className={cn('text-text-strong-950', isActive && 'bg-primary-alpha-10')} />
```

### Dark mode

Adiciona a classe `dark` no `<html>` (no plugin, via `document.documentElement`):

```ts
document.documentElement.classList.toggle('dark', true);
```

Tokens e utilitários Tailwind vêm de `ui-src/globals.css`.

## Regenerar tokens

```bash
pnpm --filter @insta2figma/figma-plugin run alignui:globals
```

Defaults: primary **Blue**, neutral **Gray**, formato **oklch**.

## Adicionar mais componentes

Copia o código de [alignui.com/docs/v1.2/ui](https://alignui.com/docs/v1.2/ui) para `ui-src/components/ui/<nome>.tsx` e exporta em `ui-src/components/ui/index.ts`.
