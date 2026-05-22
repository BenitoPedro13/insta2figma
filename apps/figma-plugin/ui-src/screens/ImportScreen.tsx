import { useCallback, useState, type FormEvent } from 'react';
import { RiArrowDownSLine, RiInstagramFill, RiLoader4Line } from '@remixicon/react';
import { PostPreviewList, type PostPreviewItem } from '../components/PostPreviewList';
import * as FancyButton from '../components/ui/fancy-button';
import * as Input from '../components/ui/input';
import * as Button from '../components/ui/button';
import { CheckboxLabel } from '../components/ui/checkbox-label';
import { CounterField } from '../components/ui/counter-field';
import { cn } from '../utils/cn';

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
}: ImportScreenProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  const searching = previewLoading && username.trim().length > 0;

  return (
    <div className="new-import-screen">
      <form className="new-import-layout" onSubmit={onSubmit}>
        <div className="new-import-left">
          <div className="new-import-field">
            <label
              htmlFor="username"
              className="new-import-label text-label-sm font-semibold text-text-strong-950"
            >
              What Instagram?
            </label>
            <Input.Root size="medium">
              <Input.Wrapper>
                <Input.Icon as={RiInstagramFill} />
                <Input.Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => onUsernameChange(e.target.value)}
                  placeholder="ex.: archillect"
                  autoComplete="off"
                />
              </Input.Wrapper>
            </Input.Root>
            <p className="new-import-hint text-paragraph-xs text-text-sub-600">
              Enter only the username without &apos;@&apos;.
            </p>
          </div>

          {searching ? (
            <p className="new-import-status text-paragraph-xs text-text-sub-600" role="status">
              <RiLoader4Line className="new-import-spinner" aria-hidden />
              Searching username…
            </p>
          ) : null}

          <div className="profile-preview">
            <span className="profile-preview-avatar" aria-hidden>
              {preview?.profilePicUrlHd ? (
                <img
                  src={preview.profilePicUrlHd}
                  alt=""
                  className="profile-preview-avatar-img"
                />
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
                <p className="profile-preview-sub">
                  Conta privada: o scrape pode não trazer posts.
                </p>
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

          <CounterField
            id="max-posts-main"
            label="Number of posts"
            hint={
              preview
                ? `Estimativa: ${preview.estimatedImportImages} imagem(ns) · Capas ${preview.estimatedPostCovers} · Carrossel +${preview.estimatedCarouselExtras}`
                : 'Quantidade de posts recentes a importar.'
            }
            value={maxPosts}
            min={1}
            max={maxPostsLimit}
            onChange={onMaxPostsChange}
          />

          <div className="new-import-checks">
            <CheckboxLabel
              label="Ignore Reels"
              hint="Em breve — standby"
              checked={false}
              disabled
            />
            <CheckboxLabel
              label="Import carousel images"
              hint={!allowCarousel ? 'Disponível no plano Pro' : undefined}
              checked={expandCarouselImages}
              disabled={!allowCarousel}
              onCheckedChange={onExpandCarouselChange}
            />
          </div>

          <div className="new-import-advanced">
            <button
              type="button"
              className="new-import-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              <span className="text-label-sm font-semibold text-text-strong-950">Avançado</span>
              <RiArrowDownSLine
                className={cn('new-import-advanced-chevron', advancedOpen && 'is-open')}
                aria-hidden
              />
            </button>
            {advancedOpen ? (
              <div className="new-import-advanced-panel">
                <div className="field">
                  <label htmlFor="selection-mode" className="text-label-sm text-text-sub-600">
                    Modo
                  </label>
                  <select
                    id="selection-mode"
                    className="new-import-select"
                    value={selectionMode}
                    onChange={(e) =>
                      onSelectionModeChange(e.target.value as PostSelectionMode)
                    }
                  >
                    <option value="recent">Posts recentes (do 1º em diante)</option>
                    <option value="single">Post único por posição</option>
                    <option value="range">Intervalo por posição</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="timeline-order" className="text-label-sm text-text-sub-600">
                    Ordem da timeline
                  </label>
                  <select
                    id="timeline-order"
                    className="new-import-select"
                    value={timelineOrder}
                    onChange={(e) =>
                      onTimelineOrderChange(e.target.value as PostTimelineOrder)
                    }
                  >
                    <option value="newest_first">
                      Mais recente primeiro (#1 = último post)
                    </option>
                    <option value="oldest_first">
                      Mais antigo primeiro (#1 = post mais antigo visível)
                    </option>
                  </select>
                </div>
                {selectionMode !== 'recent' ? (
                  <CounterField
                    id="start-index"
                    label="Posição inicial (#)"
                    value={startIndex}
                    min={1}
                    max={maxPostsLimit}
                    onChange={onStartIndexChange}
                  />
                ) : null}
                {selectionMode === 'range' ? (
                  <CounterField
                    id="post-count"
                    label="Quantidade de posts"
                    value={postCount}
                    min={1}
                    max={maxPostsLimit}
                    onChange={onPostCountChange}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {quotaExceeded ? (
            <p className="import-quota-warn">
              Quota mensal esgotada no plano {planTier === 'pro' ? 'Pro' : 'Free'}.
            </p>
          ) : null}

          <div className="new-import-actions">
            <FancyButton.Root
              type="submit"
              variant="primary"
              size="medium"
              className="w-full"
              disabled={importing || quotaExceeded}
            >
              <FancyButton.Icon as={RiInstagramFill} />
              {quotaExceeded ? 'Quota esgotada' : ctaLabel}
            </FancyButton.Root>
            {quotaExceeded ? (
              <Button.Root
                type="button"
                variant="primary"
                mode="stroke"
                size="medium"
                className="w-full"
                onClick={onUpgrade}
              >
                Upgrade to Pro
              </Button.Root>
            ) : null}
          </div>
          {status ? (
            <p className="status-line text-paragraph-xs text-text-sub-600">{status}</p>
          ) : null}
        </div>

        <div className="new-import-right" aria-live="polite">
          <div className="new-import-preview-empty">
            <p className="new-import-preview-title text-label-sm font-semibold text-text-strong-950">
              Preview
            </p>
            <p className="new-import-preview-copy text-paragraph-xs text-text-sub-600">
              {username.trim()
                ? previewLoading
                  ? 'A carregar preview…'
                  : preview?.postsPreview?.length
                    ? `${preview.postsPreview.length} posts no preview — grelha completa em breve.`
                    : 'Sem posts no preview ainda.'
                : 'Enter an Instagram username to see a preview here.'}
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
