import { useCallback, useEffect, useRef, useState } from 'react';
import { ChromeHeader } from './components/ChromeHeader';
import {
  loadHistory,
  saveHistory,
  sortHistory,
  toggleFavorite,
  upsertAfterSuccessfulImport,
  type HistoryEntry,
} from './lib/historyStorage';
import { ImportScreen } from './screens/ImportScreen';
import { ListScreen, type ListTab } from './screens/ListScreen';

type View = 'list' | 'import';

function normBase(b: string): string {
  return String(b ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function msgToText(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function App() {
  const [view, setView] = useState<View>('list');
  const [listTab, setListTab] = useState<ListTab>('history');
  const [search, setSearch] = useState('');
  const [historyEntries, setHistoryEntries] = useState(() => sortHistory(loadHistory()));
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState('');

  const [base, setBase] = useState('http://127.0.0.1:3333');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const lastImportUsername = useRef('');

  const onCancel = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  }, []);

  const openImport = useCallback(
    (opts?: { clearUsername?: boolean }) => {
      setView('import');
      setStatus('');
      setListStatus('');
      if (opts?.clearUsername) {
        setUsername('');
        setSelectedUsername(null);
        return;
      }
      if (selectedUsername) {
        setUsername(selectedUsername);
      }
    },
    [selectedUsername],
  );

  const persistEntries = useCallback(
    (updater: HistoryEntry[] | ((prev: HistoryEntry[]) => HistoryEntry[])) => {
      setHistoryEntries((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        saveHistory(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const onMsg = (ev: MessageEvent<{ pluginMessage?: unknown }>) => {
      const pm = ev.data?.pluginMessage as
        | { type?: string; text?: string; message?: unknown; placed?: number; total?: number; error?: boolean }
        | undefined;
      if (!pm?.type) return;
      if (pm.type === 'import-status' && pm.text) {
        setStatus(pm.text);
        return;
      }
      if (pm.type === 'import-error') {
        setImporting(false);
        setStatus(`Erro: ${pm.message != null ? msgToText(pm.message) : 'desconhecido'}`);
        return;
      }
      if (pm.type !== 'import-done') return;
      setImporting(false);
      const done = pm;
      const ok = !done.error;
      const summary = ok
        ? `Colocados ${done.placed}/${done.total} no canvas.`
        : 'Colocação: nada importado ou erro.';
      setStatus(summary);
      if (ok && lastImportUsername.current) {
        persistEntries((prev) => upsertAfterSuccessfulImport(prev, lastImportUsername.current));
        setView('list');
        setListStatus(summary);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [persistEntries]);

  const onImport = useCallback(() => {
    const norm = normBase(base);
    const mail = String(email ?? '').trim();
    const user = String(username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!norm || !mail || !user) {
      setStatus('Preenche API, email e username.');
      return;
    }
    lastImportUsername.current = user;
    setImporting(true);
    setStatus('A arrancar…');
    parent.postMessage(
      {
        pluginMessage: {
          type: 'import-profile',
          base: norm,
          email: mail,
          username: user,
        },
      },
      '*',
    );
  }, [base, email, username]);

  const onToggleFavoriteRow = useCallback(
    (u: string) => {
      persistEntries((prev) => toggleFavorite(prev, u));
    },
    [persistEntries],
  );

  return (
    <div className="plugin-shell">
      <ChromeHeader title="Insta2Figma" onClose={onCancel} />
      <div className={`plugin-body ${view === 'list' ? 'plugin-body--flush' : ''}`}>
        {view === 'list' ? (
          <ListScreen
            tab={listTab}
            onTabChange={setListTab}
            search={search}
            onSearchChange={setSearch}
            entries={historyEntries}
            selectedUsername={selectedUsername}
            onSelectUsername={setSelectedUsername}
            onToggleFavorite={onToggleFavoriteRow}
            onStartImport={() => openImport()}
            onAddNew={() => openImport({ clearUsername: true })}
            listStatus={listStatus}
          />
        ) : (
          <ImportScreen
            base={base}
            email={email}
            username={username}
            status={status}
            importing={importing}
            onBaseChange={setBase}
            onEmailChange={setEmail}
            onUsernameChange={setUsername}
            onImport={onImport}
            onBack={() => setView('list')}
            onClose={onCancel}
          />
        )}
      </div>
    </div>
  );
}
