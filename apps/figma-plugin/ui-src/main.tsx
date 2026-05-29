import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initClarity } from './lib/clarity';
import { ThemePreferenceProvider } from './lib/themePreference';
import './globals.css';
import './index.css';

function Root() {
  return (
    <ThemePreferenceProvider>
      <App />
    </ThemePreferenceProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

initClarity();
