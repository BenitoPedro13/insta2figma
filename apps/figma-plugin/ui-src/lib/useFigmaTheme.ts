import { useEffect } from 'react';

/**
 * Sincroniza a classe `.dark` do AlignUI com o tema do iframe do Figma.
 * Com `themeColors: true` no showUI, o Figma define `prefers-color-scheme` no iframe.
 * A API `figma.ui.on('themechange')` não existe em todas as versões do runtime.
 */
export function useFigmaTheme() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      document.documentElement.classList.toggle('dark', mq.matches);
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
}
