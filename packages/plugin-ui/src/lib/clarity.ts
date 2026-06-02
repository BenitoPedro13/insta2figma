declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

const PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID?.trim();

function bootClarity(projectId: string): void {
  if (window.clarity) return;

  (function clarityStub(c, l, a, r, i, t, y) {
    c[a] =
      c[a] ||
      function clarityQueue(...args: unknown[]) {
        (c[a].q = c[a].q || []).push(args);
      };
    t = l.createElement(r) as HTMLScriptElement;
    t.async = true;
    t.src = `https://www.clarity.ms/tag/${i}`;
    y = l.getElementsByTagName(r)[0];
    y.parentNode?.insertBefore(t, y);
  })(window, document, 'clarity', 'script', projectId);

  window.clarity?.('set', 'custom', 'app', 'insta2figma-figma-plugin');
}

/** Loads Microsoft Clarity once per plugin UI session (async, after first paint). */
export function initClarity(): void {
  if (!PROJECT_ID) {
    if (import.meta.env.DEV) {
      console.info(
        '[Insta2Figma] Clarity disabled — set VITE_CLARITY_PROJECT_ID in apps/figma-plugin/.env',
      );
    }
    return;
  }

  const start = () => bootClarity(PROJECT_ID);

  if ('requestIdleCallback' in window) {
    requestIdleCallback(start, { timeout: 3000 });
  } else {
    window.setTimeout(start, 1000);
  }
}

export function getClarityProjectId(): string | undefined {
  return PROJECT_ID || undefined;
}
