import { useCallback, useEffect, useRef, useState } from 'react';
import { PluginFooter } from './components/PluginFooter';
import { PluginResizeHandle } from './components/PluginResizeHandle';
import { PluginSidebar } from './components/PluginSidebar';
import type { ShellTab } from './components/PluginTabs';
import {
  clearLegacyIframeHistory,
  loadLegacyIframeHistory,
  parseHistoryPayload,
  sortHistory,
  removeFromHistory,
  toggleFavorite,
  upsertAfterSuccessfulImport,
  type HistoryEntry,
} from './lib/historyStorage';
import { computePreviewEstimates } from './lib/previewEstimates';
import { ImportScreen, type PostSelectionMode, type PostTimelineOrder } from './screens/ImportScreen';
import {
  buildContiguousIndices,
  PREVIEW_PAGE_SIZE,
  selectionInputFromIndices,
  toggleSelectedIndex,
} from '@insta2figma/shared-contracts';

const FREE_MAX_PREVIEW_PAGE = 3;

type ProfilePreviewPost = {
  index: number;
  shortcode: string;
  isVideo?: boolean;
  thumbnailUrl?: string | null;
  carouselCount?: number;
};

type ProfilePreview = {
  username: string;
  mediaCount: number;
  isPrivate: boolean;
  profilePicUrlHd?: string;
  estimatedImportImages: number;
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  postsPreview?: ProfilePreviewPost[];
  postsAvailable?: number;
  selectionWarning?: string;
};

function msgToText(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<ShellTab>('new-import');
  const [search, setSearch] = useState('');
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState('');

  const [username, setUsername] = useState('');
  const [maxPosts, setMaxPosts] = useState(0);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selectionMode, setSelectionMode] = useState<PostSelectionMode>('recent');
  const [startIndex, setStartIndex] = useState(1);
  const [postCount, setPostCount] = useState(1);
  const [timelineOrder, setTimelineOrder] = useState<PostTimelineOrder>('newest_first');
  const [expandCarouselImages, setExpandCarouselImages] = useState(false);
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const lastImportUsername = useRef('');
  const previewReqId = useRef(0);
  const previewFetchedForUsername = useRef('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewThumbsLoading, setPreviewThumbsLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewTotalPages, setPreviewTotalPages] = useState(1);
  const [previewPageLoading, setPreviewPageLoading] = useState(false);
  const [instagramUserId, setInstagramUserId] = useState<string | null>(null);
  const [pageCursors, setPageCursors] = useState<Record<number, string>>({});
  const [pagePostsCache, setPagePostsCache] = useState<
    Record<number, ProfilePreviewPost[]>
  >({});
  const [showProOverlay, setShowProOverlay] = useState(false);
  const [planTier, setPlanTier] = useState<'free' | 'pro'>('free');
  const [jobsRemaining, setJobsRemaining] = useState<number | null>(null);
  const [jobsLimit, setJobsLimit] = useState<number | null>(null);
  const [maxPostsLimit, setMaxPostsLimit] = useState(12);
  const [sessionError, setSessionError] = useState('');
  const [periodEndIso, setPeriodEndIso] = useState<string | null>(null);

  const quotaExceeded = jobsRemaining != null && jobsRemaining <= 0;

  const onCancel = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  }, []);

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

      if (pm.type === 'session-data') {
        setSessionError('');
        setPlanTier(pm.planTier === 'pro' ? 'pro' : 'free');
        const q = pm.quotas as Record<string, unknown> | undefined;
        if (q) {
          setJobsRemaining(
            typeof q.jobsRemaining === 'number'
              ? q.jobsRemaining
              : q.jobsRemaining === null
                ? null
                : null,
          );
          setJobsLimit(
            typeof q.jobsLimit === 'number'
              ? q.jobsLimit
              : q.jobsLimit === null
                ? null
                : null,
          );
          const mp =
            typeof q.maxPosts === 'number' && Number.isFinite(q.maxPosts)
              ? q.maxPosts
              : 12;
          setMaxPostsLimit(mp);
          setMaxPosts((prev) => Math.min(prev, mp));
        }
        const sub = pm.subscription as Record<string, unknown> | undefined;
        if (sub && typeof sub.currentPeriodEnd === 'string') {
          setPeriodEndIso(sub.currentPeriodEnd);
        } else if (sub && sub.currentPeriodEnd === null) {
          setPeriodEndIso(null);
        }
        return;
      }

      if (pm.type === 'session-error') {
        setSessionError(
          typeof pm.message === 'string'
            ? pm.message
            : 'Session unavailable. Sign in to Figma.',
        );
        return;
      }

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
        const loadedUser = String(pm.username ?? '')
          .trim()
          .replace(/^@+/, '')
          .toLowerCase();
        const page =
          typeof pm.previewPage === 'number' && Number.isFinite(pm.previewPage)
            ? Math.max(1, Math.floor(pm.previewPage))
            : 1;
        const postsPreview = Array.isArray(pm.postsPreview)
          ? (pm.postsPreview as ProfilePreviewPost[])
          : undefined;
        const thumbsPending =
          typeof pm.thumbsPending === 'number' && Number.isFinite(pm.thumbsPending)
            ? pm.thumbsPending
            : 0;
        const nextPreviewCursor =
          typeof pm.nextPreviewCursor === 'string' && pm.nextPreviewCursor.length > 0
            ? pm.nextPreviewCursor
            : null;

        if (page === 1) {
          if (loadedUser) previewFetchedForUsername.current = loadedUser;
          setPreviewLoading(false);
          setPreviewPageLoading(false);
          setPreviewError('');
          setPreviewPage(1);
          setPreviewThumbsLoading(thumbsPending > 0);
          setPreviewTotalPages(
            typeof pm.previewTotalPages === 'number' &&
              Number.isFinite(pm.previewTotalPages)
              ? Math.max(1, pm.previewTotalPages)
              : 1,
          );
          setInstagramUserId(
            typeof pm.instagramUserId === 'string' ? pm.instagramUserId : null,
          );
          setPagePostsCache(postsPreview ? { 1: postsPreview } : {});
          setPageCursors(nextPreviewCursor ? { 2: nextPreviewCursor } : {});
          setPreview({
            username: String(pm.username ?? ''),
            mediaCount:
              typeof pm.mediaCount === 'number' && Number.isFinite(pm.mediaCount)
                ? pm.mediaCount
                : 0,
            isPrivate: pm.isPrivate === true,
            estimatedImportImages:
              typeof pm.estimatedImportImages === 'number' &&
              Number.isFinite(pm.estimatedImportImages)
                ? pm.estimatedImportImages
                : 0,
            estimatedPostCovers:
              typeof pm.estimatedPostCovers === 'number' &&
              Number.isFinite(pm.estimatedPostCovers)
                ? pm.estimatedPostCovers
                : 0,
            estimatedCarouselExtras:
              typeof pm.estimatedCarouselExtras === 'number' &&
              Number.isFinite(pm.estimatedCarouselExtras)
                ? pm.estimatedCarouselExtras
                : 0,
            profilePicUrlHd:
              typeof pm.profilePicUrlHd === 'string' ? pm.profilePicUrlHd : undefined,
            postsPreview,
            postsAvailable:
              typeof pm.postsAvailable === 'number' && Number.isFinite(pm.postsAvailable)
                ? pm.postsAvailable
                : undefined,
            selectionWarning:
              typeof pm.selectionWarning === 'string' ? pm.selectionWarning : undefined,
          });
          return;
        }

        setPreviewPageLoading(false);
        setPreviewThumbsLoading(thumbsPending > 0);
        setPreviewPage(page);
        if (postsPreview) {
          setPagePostsCache((prev) => ({ ...prev, [page]: postsPreview }));
          setPageCursors((prev) =>
            nextPreviewCursor ? { ...prev, [page + 1]: nextPreviewCursor } : prev,
          );
          setPreview((prev) =>
            prev ? { ...prev, postsPreview } : prev,
          );
        }
        return;
      }
      if (pm.type === 'profile-preview-thumb') {
        const reqId = pm.requestId;
        if (typeof reqId !== 'number' || reqId !== previewReqId.current) return;
        const shortcode = typeof pm.shortcode === 'string' ? pm.shortcode : '';
        const thumbnailUrl =
          typeof pm.thumbnailUrl === 'string' ? pm.thumbnailUrl : null;
        if (!shortcode || !thumbnailUrl) return;
        setPreview((prev) => {
          if (!prev?.postsPreview) return prev;
          const updatedPosts = prev.postsPreview.map((p) =>
            p.shortcode === shortcode ? { ...p, thumbnailUrl } : p,
          );
          setPagePostsCache((cache) => {
            const next: Record<number, ProfilePreviewPost[]> = { ...cache };
            for (const [pageKey, posts] of Object.entries(next)) {
              next[Number(pageKey)] = posts.map((p) =>
                p.shortcode === shortcode ? { ...p, thumbnailUrl } : p,
              );
            }
            return next;
          });
          return {
            ...prev,
            postsPreview: updatedPosts,
          };
        });
        return;
      }
      if (pm.type === 'profile-preview-thumbs-done') {
        const reqId = pm.requestId;
        if (typeof reqId !== 'number' || reqId !== previewReqId.current) return;
        setPreviewThumbsLoading(false);
        return;
      }
      if (pm.type === 'profile-preview-error') {
        const reqId = pm.requestId;
        if (typeof reqId !== 'number' || reqId !== previewReqId.current) return;
        previewFetchedForUsername.current = '';
        setPreviewLoading(false);
        setPreviewPageLoading(false);
        setPreviewThumbsLoading(false);
        setPreview(null);
        setPreviewPage(1);
        setPreviewTotalPages(1);
        setInstagramUserId(null);
        setPageCursors({});
        setPagePostsCache({});
        setPreviewError(
          typeof pm.message === 'string' ? pm.message : 'Could not load profile preview.',
        );
        return;
      }
      if (pm.type === 'import-error') {
        setImporting(false);
        const raw =
          pm.message != null ? msgToText(pm.message) : 'Something went wrong.';
        setStatus(raw);
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
      const placed = done.placed ?? 0;
      const total = done.total ?? 0;
      const summary = ok
        ? `All done — ${placed} of ${total} images on the canvas.`
        : 'Nothing made it to the canvas this time.';
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
      }
    };
    window.addEventListener('message', onMsg);
    parent.postMessage({ pluginMessage: { type: 'session-request' } }, '*');
    parent.postMessage({ pluginMessage: { type: 'history-request' } }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, [persistEntries]);

  const resetPreviewPagination = useCallback(() => {
    setPreviewPage(1);
    setPreviewTotalPages(1);
    setPreviewPageLoading(false);
    setInstagramUserId(null);
    setPageCursors({});
    setPagePostsCache({});
  }, []);

  const onUpgrade = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'billing-checkout' } }, '*');
  }, []);

  const selectProfile = useCallback((u: string) => {
    const user = String(u)
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!user) return;
    setActiveTab('new-import');
    setUsername(user);
    setSelectedUsername(user);
    setStatus('');
    setListStatus('');
  }, []);

  useEffect(() => {
    if (importing) return;
    const user = String(username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!user) {
      previewFetchedForUsername.current = '';
      setPreviewLoading(false);
      resetPreviewPagination();
      setPreview(null);
      setPreviewError('');
      setSelectedIndices([]);
      setMaxPosts(0);
      setStartIndex(1);
      setPostCount(1);
      setSelectionMode('recent');
      return;
    }
    if (
      previewFetchedForUsername.current === user &&
      preview?.username.toLowerCase() === user
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const reqId = previewReqId.current + 1;
      previewReqId.current = reqId;
      previewFetchedForUsername.current = user;
      resetPreviewPagination();
      setPreviewLoading(true);
      setPreviewThumbsLoading(false);
      setPreviewError('');
      parent.postMessage(
        {
          pluginMessage: {
            type: 'profile-preview',
            requestId: reqId,
            username: user,
            maxPosts: Math.max(1, maxPostsLimit),
            expandCarouselImages: false,
            selectionMode: 'recent',
            startIndex: 1,
            postCount: maxPostsLimit,
            timelineOrder: 'newest_first',
            previewListSize: PREVIEW_PAGE_SIZE,
            previewPage: 1,
          },
        },
        '*',
      );
    }, 420);
    return () => window.clearTimeout(timer);
  }, [importing, username, preview?.username, maxPostsLimit, resetPreviewPagination]);

  const fetchPreviewPage = useCallback(
    (page: number) => {
      if (planTier === 'free' && page > FREE_MAX_PREVIEW_PAGE) {
        setShowProOverlay(true);
        return;
      }

      const user = String(username ?? '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase();
      if (!user || !preview?.username) return;

      const cached = pagePostsCache[page];
      if (cached) {
        setPreviewPage(page);
        setPreview((prev) => (prev ? { ...prev, postsPreview: cached } : prev));
        return;
      }

      const after = pageCursors[page];
      if (!after || !instagramUserId) return;

      const reqId = previewReqId.current + 1;
      previewReqId.current = reqId;
      setPreviewPageLoading(true);
      setPreviewThumbsLoading(false);
      parent.postMessage(
        {
          pluginMessage: {
            type: 'profile-preview',
            requestId: reqId,
            username: user,
            maxPosts: Math.max(1, maxPostsLimit),
            expandCarouselImages: false,
            selectionMode: 'recent',
            startIndex: 1,
            postCount: maxPostsLimit,
            timelineOrder: 'newest_first',
            previewListSize: PREVIEW_PAGE_SIZE,
            previewPage: page,
            after,
            userId: instagramUserId,
          },
        },
        '*',
      );
    },
    [
      planTier,
      username,
      preview?.username,
      pagePostsCache,
      pageCursors,
      instagramUserId,
      maxPostsLimit,
    ],
  );

  /** Slider / selection — local estimate only; no Instagram refetch. */
  useEffect(() => {
    if (importing || previewLoading) return;
    const user = String(username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!user || !preview?.username) return;
    if (user !== preview.username.toLowerCase()) return;

    const next = computePreviewEstimates(preview.postsPreview, {
      selectedIndices,
      rangeMode: selectionMode === 'range',
      timelineOrder,
      expandCarouselImages,
      postsAvailable: preview.postsAvailable,
    });

    setPreview((prev) => {
      if (!prev) return prev;
      if (
        prev.estimatedImportImages === next.estimatedImportImages &&
        prev.estimatedPostCovers === next.estimatedPostCovers &&
        prev.estimatedCarouselExtras === next.estimatedCarouselExtras &&
        prev.selectionWarning === next.selectionWarning
      ) {
        return prev;
      }
      return { ...prev, ...next };
    });
  }, [
    importing,
    previewLoading,
    username,
    preview?.username,
    preview?.postsPreview,
    preview?.postsAvailable,
    selectedIndices,
    selectionMode,
    timelineOrder,
    expandCarouselImages,
  ]);

  const onMaxPostsChange = useCallback((count: number) => {
    setSelectionMode('recent');
    setMaxPosts(count);
    setSelectedIndices(buildContiguousIndices(1, count));
  }, []);

  const onRangeChange = useCallback((start: number, length: number) => {
    setSelectionMode('range');
    setStartIndex(start);
    setPostCount(length);
    setSelectedIndices(buildContiguousIndices(start, length));
  }, []);

  const onSelectionModeChange = useCallback(
    (mode: PostSelectionMode) => {
      if (mode === 'range') {
        const length = Math.max(1, selectedIndices.length || maxPosts || 1);
        const start = selectedIndices[0] ?? 1;
        setStartIndex(start);
        setPostCount(length);
        setSelectedIndices(buildContiguousIndices(start, length));
      } else {
        const count = selectedIndices.length;
        setMaxPosts(count);
        setSelectedIndices(buildContiguousIndices(1, count));
      }
      setSelectionMode(mode);
    },
    [maxPosts, selectedIndices],
  );

  const onTogglePostIndex = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = toggleSelectedIndex(prev, index);
      setMaxPosts(next.length);
      if (next.length > 0) {
        setStartIndex(next[0]!);
        setPostCount(next.length);
      } else {
        setStartIndex(1);
        setPostCount(0);
      }
      setSelectionMode((mode) => (mode === 'range' ? 'multi' : mode));
      return next;
    });
  }, []);

  const onImport = useCallback(() => {
    const user = String(username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!user) {
      setStatus('Enter a username.');
      return;
    }
    if (quotaExceeded) {
      setStatus('Monthly quota used up. Upgrade to Pro.');
      return;
    }
    if (selectedIndices.length < 1) {
      setStatus('Select at least one post.');
      return;
    }
    lastImportUsername.current = user;
    previewReqId.current += 1;
    setImporting(true);
    setStatus('Kicking things off…');
    const scrapeInput = selectionInputFromIndices(selectedIndices, {
      rangeMode: selectionMode === 'range',
      timelineOrder,
    });
    parent.postMessage(
      {
        pluginMessage: {
          type: 'import-profile',
          username: user,
          expandCarouselImages,
          ...scrapeInput,
        },
      },
      '*',
    );
  }, [
    username,
    selectedIndices,
    expandCarouselImages,
    quotaExceeded,
    selectionMode,
    timelineOrder,
  ]);

  const onToggleFavoriteRow = useCallback(
    (u: string) => {
      persistEntries((prev) => toggleFavorite(prev, u));
    },
    [persistEntries],
  );

  const onRemoveFromHistoryRow = useCallback(
    (u: string) => {
      const key = u.trim().toLowerCase();
      persistEntries((prev) => removeFromHistory(prev, key));
      setSelectedUsername((sel) => (sel === key ? null : sel));
    },
    [persistEntries],
  );

  const listTab = activeTab === 'favorites' ? 'favorites' : 'history';

  return (
    <div className="plugin-shell relative flex min-h-0 flex-col">
      <div className="plugin-frame flex min-h-0 flex-1">
        <PluginSidebar />
        <div className="plugin-main flex min-h-0 min-w-0 flex-1 flex-col bg-bg-white-0">
          <div className="plugin-container flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="plugin-content flex min-h-0 flex-1 flex-col overflow-hidden">
              <ImportScreen
                activeTab={activeTab}
                onTabChange={setActiveTab}
                listTab={listTab}
                search={search}
                onSearchChange={setSearch}
                historyEntries={historyEntries}
                selectedUsername={selectedUsername}
                onSelectProfile={selectProfile}
                onToggleFavorite={onToggleFavoriteRow}
                onRemoveFromHistory={onRemoveFromHistoryRow}
                listStatus={listStatus}
                username={username}
                maxPosts={maxPosts}
                maxPostsLimit={maxPostsLimit}
                selectedIndices={selectedIndices}
                selectionMode={selectionMode}
                startIndex={startIndex}
                postCount={postCount}
                timelineOrder={timelineOrder}
                expandCarouselImages={expandCarouselImages}
                quotaExceeded={quotaExceeded}
                planTier={planTier}
                sessionError={sessionError}
                status={status}
                importing={importing}
                preview={preview}
                previewLoading={previewLoading}
                previewPageLoading={previewPageLoading}
                previewThumbsLoading={previewThumbsLoading}
                previewError={previewError}
                previewPage={previewPage}
                previewTotalPages={previewTotalPages}
                onPreviewPageChange={fetchPreviewPage}
                onPreviewBlockedAdvance={() => setShowProOverlay(true)}
                showProOverlay={showProOverlay}
                onCloseProOverlay={() => setShowProOverlay(false)}
                onUsernameChange={setUsername}
                onMaxPostsChange={onMaxPostsChange}
                onSelectionModeChange={onSelectionModeChange}
                onStartIndexChange={setStartIndex}
                onPostCountChange={setPostCount}
                onRangeChange={onRangeChange}
                onTogglePostIndex={onTogglePostIndex}
                onTimelineOrderChange={setTimelineOrder}
                onExpandCarouselChange={setExpandCarouselImages}
                onImport={onImport}
                onUpgrade={onUpgrade}
              />
            </div>
          </div>
          <PluginFooter
            planTier={planTier}
            jobsRemaining={jobsRemaining}
            jobsLimit={jobsLimit}
            periodEndIso={periodEndIso}
            onUpgrade={onUpgrade}
          />
        </div>
      </div>
      <PluginResizeHandle />
    </div>
  );
}
