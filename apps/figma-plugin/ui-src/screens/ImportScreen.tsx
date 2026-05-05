import { useCallback, type FormEvent } from 'react';

type ImportScreenProps = {
  base: string;
  email: string;
  username: string;
  status: string;
  importing: boolean;
  onBaseChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onUsernameChange: (v: string) => void;
  onImport: () => void;
  onBack: () => void;
  onClose: () => void;
};

export function ImportScreen({
  base,
  email,
  username,
  status,
  importing,
  onBaseChange,
  onEmailChange,
  onUsernameChange,
  onImport,
  onBack,
  onClose,
}: ImportScreenProps) {
  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      onImport();
    },
    [onImport],
  );

  return (
    <div className="import-screen">
      <button type="button" className="import-back" onClick={onBack}>
        ‹ Back
      </button>
      <div className="list-rule" />
      <form className="import-form" onSubmit={onSubmit}>
        <div className="import-section-label">Ligação (MVP)</div>
        <div className="field">
          <label htmlFor="api-base">API (base)</label>
          <input
            id="api-base"
            type="text"
            value={base}
            onChange={(e) => onBaseChange(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email (sessão)</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="dev@local.test"
          />
        </div>
        <div className="import-section-label">What Instagram?</div>
        <div className="field">
          <label htmlFor="username">Username (sem @)</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="ex.: archillect"
            autoComplete="off"
          />
        </div>
        <div className="plugin-actions">
          <button type="submit" className="primary" disabled={importing}>
            Importar perfil para o canvas
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
        <p className="status-line">{status}</p>
      </form>
    </div>
  );
}
