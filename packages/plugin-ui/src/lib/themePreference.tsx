import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'insta2figma:theme-preference:v1';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return 'system';
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  root.dataset.theme = preference;

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark =
    preference === 'dark' || (preference === 'system' && mq.matches);
  root.classList.toggle('dark', isDark);
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const stored = readStoredPreference();
    applyTheme(stored);
    return stored;
  });

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useLayoutEffect(() => {
    applyTheme(preference);

    if (preference !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme('system');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [preference]);

  return (
    <ThemePreferenceContext.Provider value={{ preference, setPreference }}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error('useThemePreference must be used within ThemePreferenceProvider');
  }
  return ctx;
}
