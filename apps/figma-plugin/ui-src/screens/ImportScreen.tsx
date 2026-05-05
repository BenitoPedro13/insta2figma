import { useCallback, type FormEvent } from 'react';

type ImportScreenProps = {
  base: string;
  email: string;
  username: string;
  maxPosts: number;
  expandCarouselImages: boolean;
  status: string;
  importing: boolean;
  preview: {
    username: string;
    mediaCount: number;
    isPrivate: boolean;
    profilePicUrlHd?: string;
    estimatedImportImages: number;
  } | null;
  previewLoading: boolean;
  previewError: string;
  onBaseChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onUsernameChange: (v: string) => void;
  onMaxPostsChange: (v: number) => void;
  onExpandCarouselChange: (v: boolean) => void;
  onImport: () => void;
  onBack: () => void;
  onClose: () => void;
};

export function ImportScreen({
  base,
  email,
  username,
  maxPosts,
  expandCarouselImages,
  status,
  importing,
  preview,
  previewLoading,
  previewError,
  onBaseChange,
  onEmailChange,
  onUsernameChange,
  onMaxPostsChange,
  onExpandCarouselChange,
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
        <p className="import-hint">
          Enter only the username without &apos;@&apos;.
        </p>
        <div className="profile-preview">
          <span className="profile-preview-avatar" aria-hidden>
            {preview?.profilePicUrlHd ? (
              <img src={preview.profilePicUrlHd} alt="" className="profile-preview-avatar-img" />
            ) : (
              username.slice(0, 1).toUpperCase() || '?'
            )}
          </span>
          <div className="profile-preview-meta">
            <p className="profile-preview-main">
              {previewLoading
                ? 'A validar perfil…'
                : preview
                  ? `@${preview.username} · ${preview.mediaCount} posts`
                  : username.trim()
                    ? 'Sem preview ainda.'
                    : 'Introduce um username para preview.'}
            </p>
            {preview?.isPrivate ? (
              <p className="profile-preview-sub">Conta privada: o scrape pode não trazer posts.</p>
            ) : null}
            {previewError ? <p className="profile-preview-sub">{previewError}</p> : null}
          </div>
        </div>

        <div className="import-section-label">Import how many posts?</div>
        <div className="field">
          <label htmlFor="max-posts">Número de posts</label>
          <input
            id="max-posts"
            type="number"
            min={1}
            max={50}
            step={1}
            value={Number.isFinite(maxPosts) ? maxPosts : ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) {
                onMaxPostsChange(1);
                return;
              }
              onMaxPostsChange(Math.min(50, Math.max(1, n)));
            }}
          />
        </div>
        <p className="import-hint">
          {preview
            ? `Estimativa atual: ${preview.estimatedImportImages} imagem(ns) para importar.`
            : 'Posts will be imported chronologically.'}
        </p>

        <div className="import-section-label">Preferences</div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={expandCarouselImages}
            onChange={(e) => onExpandCarouselChange(e.target.checked)}
          />
          Export all images from carousel posts
        </label>

        <div className="plugin-actions">
          <button type="submit" className="primary" disabled={importing}>
            {importing ? 'A importar…' : `Importar (${maxPosts} posts)`}
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
