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
  maxAccessiblePreviewPage,
  parseInstagramUsername,
  parseInstagramUsernameDetailed,
  PREVIEW_PAGE_SIZE,
  PRO_MAX_PREVIEW_PAGE,
  selectionInputFromIndices,
  toggleSelectedIndex,
} from '@insta2figma/shared-contracts';

const PROFILE_LINK_ONLY_MSG =
  'Use a profile link or @username, not a post or reel link.';

function resolveUsernameInput(raw: string): {
  username: string;
  unsupportedUrl: boolean;
} {
  const parsed = parseInstagramUsernameDetailed(raw);
  return {
    username: parsed.username,
    unsupportedUrl: parsed.kind === 'unsupported_url',
  };
}
import { parsePlanTier, type PlanTier } from './lib/planTier';

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
  imageCount?: number;
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

function isContiguous(sorted: number[]): boolean {
  return sorted.every((value, idx) => idx === 0 || value === sorted[idx - 1] + 1);
}

function deriveSelectionModeFromIndices(
  indices: number[],
  currentMode: PostSelectionMode,
): PostSelectionMode {
  if (indices.length === 0) return 'recent';
  if (currentMode === 'range' && !isContiguous(indices)) return 'multi';
  if (isContiguous(indices) && indices[0] === 1) return 'recent';
  if (isContiguous(indices)) return 'range';
  return 'multi';
}

function parseInstagramUserId(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.floor(raw));
  }
  return null;
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
  const previewPageReqId = useRef(0);
  const previewFetchedForUsername = useRef('');
  const previewPageRef = useRef(1);
  const lastLoadedPreviewPageRef = useRef(1);
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
  const pagePostsCacheRef = useRef<Record<number, ProfilePreviewPost[]>>({});
  const [showProOverlay, setShowProOverlay] = useState(false);
  const [planTier, setPlanTier] = useState<PlanTier>('free');
  const [imagesRemaining, setImagesRemaining] = useState<number | null>(null);
  const [imagesLimit, setImagesLimit] = useState<number | null>(null);
  const [maxPostsLimit, setMaxPostsLimit] = useState(50);
  const [maxImagesLimit, setMaxImagesLimit] = useState(100);
  const [sessionError, setSessionError] = useState('');
  const [periodEndIso, setPeriodEndIso] = useState<string | null>(null);

  useEffect(() => {
    previewPageRef.current = previewPage;
  }, [previewPage]);

  useEffect(() => {
    pagePostsCacheRef.current = pagePostsCache;
  }, [pagePostsCache]);

  const quotaExceeded = imagesRemaining != null && imagesRemaining <= 0;

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
        setPlanTier(parsePlanTier(pm.planTier));
        const q = pm.quotas as Record<string, unknown> | undefined;
        if (q) {
          setImagesRemaining(
            typeof q.imagesRemaining === 'number'
              ? q.imagesRemaining
              : q.imagesRemaining === null
                ? null
                : typeof q.jobsRemaining === 'number'
                  ? q.jobsRemaining
                  : null,
          );
          setImagesLimit(
            typeof q.imagesLimit === 'number'
              ? q.imagesLimit
              : q.imagesLimit === null
                ? null
                : typeof q.jobsLimit === 'number'
                  ? q.jobsLimit
                  : null,
          );
          const mp =
            typeof q.maxPosts === 'number' && Number.isFinite(q.maxPosts)
              ? q.maxPosts
              : 50;
          setMaxPostsLimit(mp);
          setMaxPosts((prev) => Math.min(prev, mp));
          const mi =
            typeof q.maxImagesPerJob === 'number' && Number.isFinite(q.maxImagesPerJob)
              ? q.maxImagesPerJob
              : 100;
          setMaxImagesLimit(mi);
        }
        const sub = pm.subscription as Record<string, unknown> | undefined;
        const quotaPeriodEnd =
          typeof (pm.quotas as Record<string, unknown> | undefined)?.periodEnd ===
          'string'
            ? String((pm.quotas as Record<string, unknown>).periodEnd)
            : null;
        if (quotaPeriodEnd) {
          setPeriodEndIso(quotaPeriodEnd);
        } else if (sub && typeof sub.currentPeriodEnd === 'string') {
          setPeriodEndIso(sub.currentPeriodEnd);
        } else if (sub && sub.currentPeriodEnd === null) {
          setPeriodEndIso(null);
        } else {
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
        const requestKind =
          pm.requestKind === 'page' ? ('page' as const) : ('initial' as const);
        const expectedReqId =
          requestKind === 'page' ? previewPageReqId.current : previewReqId.current;
        if (typeof reqId !== 'number' || reqId !== expectedReqId) return;
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

        if (requestKind === 'initial' && page === 1) {
          if (previewPageRef.current > 1) return;
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
          setInstagramUserId(parseInstagramUserId(pm.instagramUserId));
          setPagePostsCache(postsPreview ? { 1: postsPreview } : {});
          setPageCursors(nextPreviewCursor ? { 2: nextPreviewCursor } : {});
          lastLoadedPreviewPageRef.current = 1;
          setPreview({
            username: String(pm.username ?? ''),
            mediaCount:
              typeof pm.mediaCount === 'number' && Number.isFinite(pm.mediaCount)
                ? pm.mediaCount
                : 0,
            isPrivate: pm.isPrivate === true,
            imageCount:
              typeof pm.imageCount === 'number' && Number.isFinite(pm.imageCount)
                ? pm.imageCount
                : undefined,
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
        setPreviewError('');
        setPreviewPage(page);
        const resolvedInstagramUserId = parseInstagramUserId(pm.instagramUserId);
        if (resolvedInstagramUserId) {
          setInstagramUserId(resolvedInstagramUserId);
        }
        if (
          typeof pm.previewTotalPages === 'number' &&
          Number.isFinite(pm.previewTotalPages)
        ) {
          setPreviewTotalPages(Math.max(1, pm.previewTotalPages));
        }
        if (postsPreview) {
          setPagePostsCache((prev) => ({ ...prev, [page]: postsPreview }));
          setPageCursors((prev) =>
            nextPreviewCursor ? { ...prev, [page + 1]: nextPreviewCursor } : prev,
          );
          setPreview((prev) =>
            prev ? { ...prev, postsPreview } : prev,
          );
          lastLoadedPreviewPageRef.current = page;
        }
        return;
      }
      if (pm.type === 'profile-preview-thumb') {
        const reqId = pm.requestId;
        const requestKind =
          pm.requestKind === 'page' ? ('page' as const) : ('initial' as const);
        const expectedReqId =
          requestKind === 'page' ? previewPageReqId.current : previewReqId.current;
        if (typeof reqId !== 'number' || reqId !== expectedReqId) return;
        const shortcode = typeof pm.shortcode === 'string' ? pm.shortcode : '';
        const thumbnailUrl =
          typeof pm.thumbnailUrl === 'string' ? pm.thumbnailUrl : null;
        if (!shortcode || !thumbnailUrl) return;
        setPreview((prev) => {
          if (!prev?.postsPreview) return prev;
          const updatedPosts = prev.postsPreview.map((p) =>
            p.shortcode === shortcode ? { ...p, thumbnailUrl } : p,
          );
          const activePage = previewPageRef.current;
          setPagePostsCache((cache) => {
            const pagePosts = cache[activePage];
            if (!pagePosts) return cache;
            return {
              ...cache,
              [activePage]: pagePosts.map((p) =>
                p.shortcode === shortcode ? { ...p, thumbnailUrl } : p,
              ),
            };
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
        const requestKind =
          pm.requestKind === 'page' ? ('page' as const) : ('initial' as const);
        const expectedReqId =
          requestKind === 'page' ? previewPageReqId.current : previewReqId.current;
        if (typeof reqId !== 'number' || reqId !== expectedReqId) return;
        setPreviewThumbsLoading(false);
        return;
      }
      if (pm.type === 'profile-preview-error') {
        const reqId = pm.requestId;
        const requestKind =
          pm.requestKind === 'page' ? ('page' as const) : ('initial' as const);
        const expectedReqId =
          requestKind === 'page' ? previewPageReqId.current : previewReqId.current;
        if (typeof reqId !== 'number' || reqId !== expectedReqId) return;
        if (requestKind === 'page') {
          setPreviewPageLoading(false);
          setPreviewThumbsLoading(false);
          const fallbackPage = lastLoadedPreviewPageRef.current;
          setPreviewPage(fallbackPage);
          const cached = pagePostsCacheRef.current[fallbackPage];
          if (cached) {
            setPreview((prev) => (prev ? { ...prev, postsPreview: cached } : prev));
          }
          setPreviewError(
            typeof pm.message === 'string' ? pm.message : 'Could not load profile preview.',
          );
          return;
        }
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
    previewPageReqId.current += 1;
    setPreviewPage(1);
    setPreviewTotalPages(1);
    setPreviewPageLoading(false);
    setInstagramUserId(null);
    setPageCursors({});
    setPagePostsCache({});
    lastLoadedPreviewPageRef.current = 1;
  }, []);

  const onBillingCheckoutPro = useCallback(
    (cycle: 'monthly' | 'yearly' = 'monthly') => {
      parent.postMessage(
        { pluginMessage: { type: 'billing-checkout', plan: 'pro', cycle } },
        '*',
      );
    },
    [],
  );

  const onBillingCheckoutMax = useCallback(
    (cycle: 'monthly' | 'yearly' = 'monthly') => {
      parent.postMessage(
        { pluginMessage: { type: 'billing-checkout', plan: 'max', cycle } },
        '*',
      );
    },
    [],
  );

  const openUpgradeOverlay = useCallback(() => {
    setShowProOverlay(true);
  }, []);

  const onManage = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'billing-portal' } }, '*');
  }, []);

  const onOpenExternal = useCallback((url: string) => {
    parent.postMessage({ pluginMessage: { type: 'open-external', url } }, '*');
  }, []);

  const selectProfile = useCallback((u: string) => {
    const user = parseInstagramUsername(String(u));
    if (!user) return;
    setActiveTab('new-import');
    setUsername(user);
    setSelectedUsername(user);
    setStatus('');
    setListStatus('');
  }, []);

  useEffect(() => {
    if (importing) return;
    const { username: user, unsupportedUrl } = resolveUsernameInput(
      String(username ?? ''),
    );
    if (unsupportedUrl) {
      previewFetchedForUsername.current = '';
      setPreviewLoading(false);
      resetPreviewPagination();
      setPreview(null);
      setPreviewError(PROFILE_LINK_ONLY_MSG);
      return;
    }
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
    if (previewFetchedForUsername.current === user) {
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
  }, [importing, username, maxPostsLimit, resetPreviewPagination]);

  const fetchPreviewPage = useCallback(
    (page: number) => {
      const tierPageCap =
        planTier === 'max'
          ? Number.MAX_SAFE_INTEGER
          : planTier === 'pro'
            ? PRO_MAX_PREVIEW_PAGE
            : 3;
      if (page > tierPageCap) {
        setShowProOverlay(true);
        return;
      }

      const user = parseInstagramUsername(String(username ?? ''));
      if (!user || !preview?.username) return;

      const cached = pagePostsCache[page];
      if (cached) {
        setPreviewPage(page);
        setPreview((prev) => (prev ? { ...prev, postsPreview: cached } : prev));
        lastLoadedPreviewPageRef.current = page;
        return;
      }

      setPreviewPage(page);
      const reqId = previewPageReqId.current + 1;
      previewPageReqId.current = reqId;
      setPreviewPageLoading(true);
      setPreviewThumbsLoading(false);
      setPreviewError('');
      parent.postMessage(
        {
          pluginMessage: {
            type: 'profile-preview',
            requestKind: 'page',
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
            ...(pageCursors[page] ? { after: pageCursors[page] } : {}),
            ...(instagramUserId ? { userId: instagramUserId } : {}),
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
    const user = parseInstagramUsername(String(username ?? ''));
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
      setSelectionMode((mode) => deriveSelectionModeFromIndices(next, mode));
      return next;
    });
  }, []);

  const onImport = useCallback(() => {
    const { username: user, unsupportedUrl } = resolveUsernameInput(
      String(username ?? ''),
    );
    if (unsupportedUrl) {
      setStatus(PROFILE_LINK_ONLY_MSG);
      return;
    }
    if (!user) {
      setStatus('Enter a username.');
      return;
    }
    if (quotaExceeded) {
      setStatus('Monthly image quota used up. Upgrade to continue importing.');
      return;
    }
    const estimatedImages =
      typeof preview?.estimatedImportImages === 'number' &&
      Number.isFinite(preview.estimatedImportImages) &&
      preview.estimatedImportImages > 0
        ? preview.estimatedImportImages
        : selectedIndices.length;
    if (estimatedImages > maxImagesLimit) {
      setStatus(
        `Each import can use at most ${maxImagesLimit} images. Reduce your selection or turn off carousel expansion.`,
      );
      return;
    }
    if (imagesRemaining != null && estimatedImages > imagesRemaining) {
      setStatus(
        `This import needs ${estimatedImages} images but you only have ${imagesRemaining} left this month.`,
      );
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
          estimatedImportImages: estimatedImages,
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
    preview?.estimatedImportImages,
    imagesRemaining,
    maxImagesLimit,
  ]);

  const onToggleFavoriteRow = useCallback(
    (u: string) => {
      persistEntries((prev) => toggleFavorite(prev, u));
    },
    [persistEntries],
  );

  const onUsernameBlur = useCallback(() => {
    const parsed = parseInstagramUsername(username);
    if (parsed && parsed !== username.trim()) {
      setUsername(parsed);
    }
  }, [username]);

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
                maxImagesLimit={maxImagesLimit}
                selectedIndices={selectedIndices}
                selectionMode={selectionMode}
                startIndex={startIndex}
                postCount={postCount}
                timelineOrder={timelineOrder}
                expandCarouselImages={expandCarouselImages}
                quotaExceeded={quotaExceeded}
                imagesRemaining={imagesRemaining}
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
                onUsernameBlur={onUsernameBlur}
                onMaxPostsChange={onMaxPostsChange}
                onSelectionModeChange={onSelectionModeChange}
                onStartIndexChange={setStartIndex}
                onPostCountChange={setPostCount}
                onRangeChange={onRangeChange}
                onTogglePostIndex={onTogglePostIndex}
                onTimelineOrderChange={setTimelineOrder}
                onExpandCarouselChange={setExpandCarouselImages}
                onImport={onImport}
                onShowUpgradeOverlay={openUpgradeOverlay}
                onBillingCheckout={onBillingCheckoutPro}
                onBillingCheckoutMax={onBillingCheckoutMax}
                onManage={onManage}
                onOpenExternal={onOpenExternal}
              />
            </div>
          </div>
          <PluginFooter
            planTier={planTier}
            imagesRemaining={imagesRemaining}
            imagesLimit={imagesLimit}
            periodEndIso={periodEndIso}
            onUpgrade={openUpgradeOverlay}
          />
        </div>
      </div>
      <PluginResizeHandle />
    </div>
  );
}
