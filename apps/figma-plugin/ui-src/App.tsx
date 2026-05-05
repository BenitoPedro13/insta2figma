import { useCallback, useEffect, useRef, useState } from 'react';
import { ChromeHeader } from './components/ChromeHeader';
import {
  clearLegacyIframeHistory,
  loadLegacyIframeHistory,
  parseHistoryPayload,
  sortHistory,
  toggleFavorite,
  upsertAfterSuccessfulImport,
  type HistoryEntry,
} from './lib/historyStorage';
import { ImportScreen } from './screens/ImportScreen';
import { ListScreen, type ListTab } from './screens/ListScreen';

type View = 'list' | 'import';
type ProfilePreview = {
  username: string;
  mediaCount: number;
  isPrivate: boolean;
  profilePicUrlHd?: string;
};

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
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState('');

  const [base, setBase] = useState('http://127.0.0.1:3333');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [maxPosts, setMaxPosts] = useState(12);
  const [expandCarouselImages, setExpandCarouselImages] = useState(false);
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const lastImportUsername = useRef('');
  const previewReqId = useRef(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState<ProfilePreview | null>(null);

  const onCancel = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  }, []);

  const openImport = useCallback(
    (opts?: { clearUsername?: boolean; username?: string }) => {
      setView('import');
      setStatus('');
      setListStatus('');
      if (opts?.clearUsername) {
        setUsername('');
        setSelectedUsername(null);
        return;
      }
      if (opts?.username != null && String(opts.username).trim() !== '') {
        const u = String(opts.username)
          .trim()
          .replace(/^@+/, '')
          .toLowerCase();
        setUsername(u);
        setSelectedUsername(u);
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
        parent.postMessage({ pluginMessage: { type: 'history-save', entries: next } }, '*');
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const onMsg = (ev: MessageEvent<{ pluginMessage?: unknown }>) => {
      const pm = ev.data?.pluginMessage as Record<string, unknown> | undefined;
      if (!pm || typeof pm.type !== 'string') return;

      if (pm.type === 'history-data') {
        let entries = parseHistoryPayload(pm.entries);
        if (entries.length === 0) {
          const legacy = loadLegacyIframeHistory();
          if (legacy.length > 0) {
            entries = sortHistory(legacy);
            clearLegacyIframeHistory();
            parent.postMessage({ pluginMessage: { type: 'history-save', entries } }, '*');
          }
        } else {
          clearLegacyIframeHistory();
        }
        setHistoryEntries(sortHistory(entries));
        return;
      }

      if (pm.type === 'import-status' && typeof pm.text === 'string') {
        setStatus(pm.text);
        return;
      }
      if (pm.type === 'profile-preview-data') {
        const reqId = pm.requestId;
        if (typeof reqId !== 'number' || reqId !== previewReqId.current) return;
        setPreviewLoading(false);
        setPreviewError('');
        setPreview({
          username: String(pm.username ?? ''),
          mediaCount:
            typeof pm.mediaCount === 'number' && Number.isFinite(pm.mediaCount)
              ? pm.mediaCount
              : 0,
          isPrivate: pm.isPrivate === true,
          profilePicUrlHd:
            typeof pm.profilePicUrlHd === 'string' ? pm.profilePicUrlHd : undefined,
        });
        return;
      }
      if (pm.type === 'profile-preview-error') {
        const reqId = pm.requestId;
        if (typeof reqId !== 'number' || reqId !== previewReqId.current) return;
        setPreviewLoading(false);
        setPreview(null);
        setPreviewError(
          typeof pm.message === 'string' ? pm.message : 'Falha no preview do perfil.',
        );
        return;
      }
      if (pm.type === 'import-error') {
        setImporting(false);
        setStatus(`Erro: ${pm.message != null ? msgToText(pm.message) : 'desconhecido'}`);
        return;
      }
      if (pm.type !== 'import-done') return;
      setImporting(false);
      const done = pm as {
        error?: unknown;
        placed?: number;
        total?: number;
        profilePicUrl?: unknown;
      };
      const ok = !done.error;
      const summary = ok
        ? `Colocados ${done.placed ?? 0}/${done.total ?? 0} no canvas.`
        : 'Colocação: nada importado ou erro.';
      setStatus(summary);
      const profilePicUrl =
        typeof done.profilePicUrl === 'string' && done.profilePicUrl.trim() !== ''
          ? done.profilePicUrl.trim()
          : undefined;
      if (ok && lastImportUsername.current) {
        persistEntries((prev) =>
          upsertAfterSuccessfulImport(prev, lastImportUsername.current, {
            profilePicUrl: profilePicUrl ?? null,
          }),
        );
        setView('list');
        setListStatus(summary);
      }
    };
    window.addEventListener('message', onMsg);
    parent.postMessage({ pluginMessage: { type: 'history-request' } }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, [persistEntries]);

  useEffect(() => {
    if (view !== 'import' || importing) return;
    const norm = normBase(base);
    const mail = String(email ?? '').trim();
    const user = String(username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!norm || !mail || !user) {
      setPreviewLoading(false);
      setPreview(null);
      setPreviewError('');
      return;
    }
    const timer = window.setTimeout(() => {
      const reqId = previewReqId.current + 1;
      previewReqId.current = reqId;
      setPreviewLoading(true);
      setPreviewError('');
      parent.postMessage(
        {
          pluginMessage: {
            type: 'profile-preview',
            requestId: reqId,
            base: norm,
            email: mail,
            username: user,
          },
        },
        '*',
      );
    }, 420);
    return () => window.clearTimeout(timer);
  }, [view, importing, base, email, username]);

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
    const posts = Math.min(50, Math.max(1, Math.floor(maxPosts)));
    parent.postMessage(
      {
        pluginMessage: {
          type: 'import-profile',
          base: norm,
          email: mail,
          username: user,
          maxPosts: posts,
          expandCarouselImages,
        },
      },
      '*',
    );
  }, [base, email, username, maxPosts, expandCarouselImages]);

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
            onOpenImportForProfile={(u) => openImport({ username: u })}
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
            maxPosts={maxPosts}
            expandCarouselImages={expandCarouselImages}
            status={status}
            importing={importing}
            preview={preview}
            previewLoading={previewLoading}
            previewError={previewError}
            onBaseChange={setBase}
            onEmailChange={setEmail}
            onUsernameChange={setUsername}
            onMaxPostsChange={setMaxPosts}
            onExpandCarouselChange={setExpandCarouselImages}
            onImport={onImport}
            onBack={() => setView('list')}
            onClose={onCancel}
          />
        )}
      </div>
    </div>
  );
}
