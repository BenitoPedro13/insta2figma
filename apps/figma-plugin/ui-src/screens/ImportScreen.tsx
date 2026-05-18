import { useCallback, type FormEvent } from 'react';
import { PostPreviewList, type PostPreviewItem } from '../components/PostPreviewList';

export type PostSelectionMode = 'recent' | 'single' | 'range';
export type PostTimelineOrder = 'newest_first' | 'oldest_first';

type ImportScreenProps = {
  username: string;
  maxPosts: number;
  maxPostsLimit: number;
  selectionMode: PostSelectionMode;
  startIndex: number;
  postCount: number;
  timelineOrder: PostTimelineOrder;
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
    postsPreview?: PostPreviewItem[];
    postsAvailable?: number;
    selectionWarning?: string;
  } | null;
  previewLoading: boolean;
  previewThumbsLoading: boolean;
  previewError: string;
  onUsernameChange: (v: string) => void;
  onMaxPostsChange: (v: number) => void;
  onSelectionModeChange: (v: PostSelectionMode) => void;
  onStartIndexChange: (v: number) => void;
  onPostCountChange: (v: number) => void;
  onTimelineOrderChange: (v: PostTimelineOrder) => void;
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
  selectionMode,
  startIndex,
  postCount,
  timelineOrder,
  expandCarouselImages,
  allowCarousel,
  quotaExceeded,
  planTier,
  status,
  importing,
  preview,
  previewLoading,
  previewThumbsLoading,
  previewError,
  onUsernameChange,
  onMaxPostsChange,
  onSelectionModeChange,
  onStartIndexChange,
  onPostCountChange,
  onTimelineOrderChange,
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

  const onPickPostIndex = useCallback(
    (index: number) => {
      onStartIndexChange(index);
      if (selectionMode === 'recent') {
        onSelectionModeChange('single');
      }
    },
    [onSelectionModeChange, onStartIndexChange, selectionMode],
  );

  const ctaLabel = (() => {
    if (importing) return 'A importar…';
    const estimated = preview?.estimatedImportImages;
    if (typeof estimated === 'number' && Number.isFinite(estimated) && estimated > 0) {
      return `Importar ${estimated} ${estimated === 1 ? 'imagem' : 'imagens'}`;
    }
    if (selectionMode === 'single') return `Importar post #${startIndex}`;
    if (selectionMode === 'range') {
      return `Importar posts #${startIndex}–#${startIndex + postCount - 1}`;
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
                ? previewThumbsLoading
                  ? 'A carregar miniaturas…'
                  : 'A validar perfil…'
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

        {preview?.postsPreview && preview.postsPreview.length > 0 ? (
          <PostPreviewList
            items={preview.postsPreview}
            timelineOrder={timelineOrder}
            selectionMode={selectionMode}
            startIndex={startIndex}
            postCount={selectionMode === 'recent' ? maxPosts : postCount}
            postsAvailable={preview.postsAvailable ?? preview.postsPreview.length}
            selectionWarning={preview.selectionWarning}
            onSelectIndex={onPickPostIndex}
          />
        ) : null}

        <div className="import-section-label">Como importar?</div>
        <div className="field">
          <label htmlFor="selection-mode">Modo</label>
          <select
            id="selection-mode"
            value={selectionMode}
            onChange={(e) => onSelectionModeChange(e.target.value as PostSelectionMode)}
          >
            <option value="recent">Posts recentes (do 1º em diante)</option>
            <option value="single">Post único por posição</option>
            <option value="range">Intervalo por posição</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="timeline-order">Ordem da timeline</label>
          <select
            id="timeline-order"
            value={timelineOrder}
            onChange={(e) => onTimelineOrderChange(e.target.value as PostTimelineOrder)}
          >
            <option value="newest_first">Mais recente primeiro (#1 = último post)</option>
            <option value="oldest_first">Mais antigo primeiro (#1 = post mais antigo visível)</option>
          </select>
        </div>

        {selectionMode === 'recent' ? (
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
        ) : (
          <>
            <div className="field">
              <label htmlFor="start-index">Posição inicial (#)</label>
              <input
                id="start-index"
                type="number"
                min={1}
                max={maxPostsLimit}
                step={1}
                value={Number.isFinite(startIndex) ? startIndex : ''}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (!Number.isFinite(n)) {
                    onStartIndexChange(1);
                    return;
                  }
                  onStartIndexChange(Math.min(maxPostsLimit, Math.max(1, n)));
                }}
              />
            </div>
            {selectionMode === 'range' ? (
              <div className="field">
                <label htmlFor="post-count">Quantidade de posts</label>
                <input
                  id="post-count"
                  type="number"
                  min={1}
                  max={maxPostsLimit}
                  step={1}
                  value={Number.isFinite(postCount) ? postCount : ''}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (!Number.isFinite(n)) {
                      onPostCountChange(1);
                      return;
                    }
                    onPostCountChange(Math.min(maxPostsLimit, Math.max(1, n)));
                  }}
                />
              </div>
            ) : null}
          </>
        )}

        <p className="import-hint">
          {preview
            ? `Estimativa atual: ${preview.estimatedImportImages} imagem(ns) para importar.`
            : 'Escolhe o modo e vê a lista indexada acima para confirmar a posição.'}
        </p>
        {preview ? (
          <p className="import-hint">
            Capas: {preview.estimatedPostCovers} · Carrossel extra:{' '}
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
