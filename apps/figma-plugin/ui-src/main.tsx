import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useFigmaTheme } from './lib/useFigmaTheme';
import './globals.css';
import './index.css';

function Root() {
  useFigmaTheme();
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
