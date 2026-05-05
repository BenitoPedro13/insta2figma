import { useCallback, useEffect, useState } from 'react';

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

function ChromeHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="chrome-header">
      <div className="chrome-brand">
        <div className="chrome-logo" aria-hidden>
          <span className="chrome-logo-inner" />
        </div>
        <span className="chrome-title">{title}</span>
      </div>
      <button type="button" className="chrome-close" onClick={onClose} aria-label="Fechar plugin">
        ×
      </button>
    </header>
  );
}

export function App() {
  const [base, setBase] = useState('http://127.0.0.1:3333');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const onMsg = (ev: MessageEvent<{ pluginMessage?: unknown }>) => {
      const pm = ev.data?.pluginMessage as
        | { type?: string; text?: string; message?: unknown }
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
      const done = pm as { error?: boolean; placed?: number; total?: number };
      setStatus(
        done.error
          ? 'Colocação: nada importado ou erro.'
          : `Colocados ${done.placed}/${done.total} no canvas.`,
      );
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

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

  const onCancel = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  }, []);

  return (
    <div className="plugin-shell">
      <ChromeHeader title="Insta2Figma" onClose={onCancel} />
      <div className="plugin-body">
        <h2>Insta2Figma</h2>
        <div className="field">
          <label htmlFor="api-base">API (base)</label>
          <input
            id="api-base"
            type="text"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email (sessão MVP)</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev@local.test"
          />
        </div>
        <div className="field">
          <label htmlFor="username">Username Instagram</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="google"
          />
        </div>
        <div className="plugin-actions">
          <button type="button" className="primary" disabled={importing} onClick={onImport}>
            Importar perfil para o canvas
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Fechar
          </button>
        </div>
        <p className="status-line">{status}</p>
      </div>
    </div>
  );
}
