import { useCallback, type FormEvent } from 'react';

type ImportScreenProps = {
  username: string;
  maxPosts: number;
  maxPostsLimit: number;
  expandCarouselImages: boolean;
  allowCarousel: boolean;
  quotaExceeded: boolean;
  planTier: 'free' | 'pro';
  status: string;
  importing: boolean;
  preview: {
    username: string;
    mediaCount: number;
    isPrivate: boolean;
    profilePicUrlHd?: string;
    estimatedImportImages: number;
    estimatedPostCovers: number;
    estimatedCarouselExtras: number;
  } | null;
  previewLoading: boolean;
  previewError: string;
  onUsernameChange: (v: string) => void;
  onMaxPostsChange: (v: number) => void;
  onExpandCarouselChange: (v: boolean) => void;
  onImport: () => void;
  onUpgrade: () => void;
  onBack: () => void;
  onClose: () => void;
};

export function ImportScreen({
  username,
  maxPosts,
  maxPostsLimit,
  expandCarouselImages,
  allowCarousel,
  quotaExceeded,
  planTier,
  status,
  importing,
  preview,
  previewLoading,
  previewError,
  onUsernameChange,
  onMaxPostsChange,
  onExpandCarouselChange,
  onImport,
  onUpgrade,
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
  const ctaLabel = (() => {
    if (importing) return 'A importar…';
    const estimated = preview?.estimatedImportImages;
    if (typeof estimated === 'number' && Number.isFinite(estimated) && estimated > 0) {
      return `Importar ${estimated} ${estimated === 1 ? 'imagem' : 'imagens'}`;
    }
    return `Importar (${maxPosts} posts)`;
  })();

  return (
    <div className="import-screen">
      <button type="button" className="import-back" onClick={onBack}>
        ‹ Back
      </button>
      <div className="list-rule" />
      <form className="import-form" onSubmit={onSubmit}>
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
            max={maxPostsLimit}
            step={1}
            value={Number.isFinite(maxPosts) ? maxPosts : ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) {
                onMaxPostsChange(1);
                return;
              }
              onMaxPostsChange(Math.min(maxPostsLimit, Math.max(1, n)));
            }}
          />
        </div>
        <p className="import-hint">
          {preview
            ? `Estimativa atual: ${preview.estimatedImportImages} imagem(ns) para importar.`
            : 'Posts will be imported chronologically.'}
        </p>
        {preview ? (
          <p className="import-hint">
            Capas de posts: {preview.estimatedPostCovers} · Extras de carrossel:{' '}
            {preview.estimatedCarouselExtras} · Total: {preview.estimatedImportImages}
          </p>
        ) : null}

        <div className="import-section-label">Preferences</div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={expandCarouselImages}
            disabled={!allowCarousel}
            onChange={(e) => onExpandCarouselChange(e.target.checked)}
          />
          Export all images from carousel posts
          {!allowCarousel ? (
            <span className="import-hint"> (Pro)</span>
          ) : null}
        </label>

        {quotaExceeded ? (
          <p className="import-quota-warn">
            Quota mensal esgotada no plano {planTier === 'pro' ? 'Pro' : 'Free'}.
          </p>
        ) : null}

        <div className="plugin-actions">
          <button
            type="submit"
            className="primary"
            disabled={importing || quotaExceeded}
          >
            {quotaExceeded ? 'Quota esgotada' : ctaLabel}
          </button>
          {quotaExceeded ? (
            <button type="button" className="secondary" onClick={onUpgrade}>
              Upgrade to Pro
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
        <p className="status-line">{status}</p>
      </form>
    </div>
  );
}
