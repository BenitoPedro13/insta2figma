import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ThemePreferenceProvider, initClarity } from '@insta2figma/plugin-ui';
import { FigmaHost } from './FigmaHost';

const host = new FigmaHost();

function Root() {
  return (
    <ThemePreferenceProvider>
      <App host={host} />
    </ThemePreferenceProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

initClarity();
