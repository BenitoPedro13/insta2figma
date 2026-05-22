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
  toggleFavorite,
  upsertAfterSuccessfulImport,
  type HistoryEntry,
} from './lib/historyStorage';
import { ImportScreen, type PostSelectionMode, type PostTimelineOrder } from './screens/ImportScreen';

type ProfilePreview = {
  username: string;
  mediaCount: number;
  isPrivate: boolean;
  profilePicUrlHd?: string;
  estimatedImportImages: number;
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  postsPreview?: {
    index: number;
    shortcode: string;
    isVideo?: boolean;
    thumbnailUrl?: string | null;
    carouselCount?: number;
  }[];
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
  const [maxPosts, setMaxPosts] = useState(12);
  const [selectionMode, setSelectionMode] = useState<PostSelectionMode>('recent');
  const [startIndex, setStartIndex] = useState(1);
  const [postCount, setPostCount] = useState(1);
  const [timelineOrder, setTimelineOrder] = useState<PostTimelineOrder>('newest_first');
  const [expandCarouselImages, setExpandCarouselImages] = useState(false);
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const lastImportUsername = useRef('');
  const previewReqId = useRef(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewThumbsLoading, setPreviewThumbsLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [planTier, setPlanTier] = useState<'free' | 'pro'>('free');
  const [jobsRemaining, setJobsRemaining] = useState<number | null>(null);
  const [jobsLimit, setJobsLimit] = useState<number | null>(null);
  const [maxPostsLimit, setMaxPostsLimit] = useState(12);
  const [allowCarousel, setAllowCarousel] = useState(false);
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
          const carousel = q.expandCarouselImages === true;
          setAllowCarousel(carousel);
          if (!carousel) setExpandCarouselImages(false);
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
        setPreviewLoading(false);
        setPreviewError('');
        const postsPreview = Array.isArray(pm.postsPreview)
          ? (pm.postsPreview as ProfilePreview['postsPreview'])
          : undefined;
        const thumbsPending =
          typeof pm.thumbsPending === 'number' && Number.isFinite(pm.thumbsPending)
            ? pm.thumbsPending
            : 0;
        setPreviewThumbsLoading(thumbsPending > 0);
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
      if (pm.type === 'profile-preview-thumb') {
        const reqId = pm.requestId;
        if (typeof reqId !== 'number' || reqId !== previewReqId.current) return;
        const shortcode = typeof pm.shortcode === 'string' ? pm.shortcode : '';
        const thumbnailUrl =
          typeof pm.thumbnailUrl === 'string' ? pm.thumbnailUrl : null;
        if (!shortcode || !thumbnailUrl) return;
        setPreview((prev) => {
          if (!prev?.postsPreview) return prev;
          return {
            ...prev,
            postsPreview: prev.postsPreview.map((p) =>
              p.shortcode === shortcode ? { ...p, thumbnailUrl } : p,
            ),
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
        setPreviewLoading(false);
        setPreviewThumbsLoading(false);
        setPreview(null);
        setPreviewError(
          typeof pm.message === 'string' ? pm.message : 'Could not load profile preview.',
        );
        return;
      }
      if (pm.type === 'import-error') {
        setImporting(false);
        setStatus(`Error: ${pm.message != null ? msgToText(pm.message) : 'unknown'}`);
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
        ? `Placed ${done.placed ?? 0}/${done.total ?? 0} on the canvas.`
        : 'Nothing was placed on the canvas.';
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
        setActiveTab('history');
        setListStatus(summary);
      }
    };
    window.addEventListener('message', onMsg);
    parent.postMessage({ pluginMessage: { type: 'session-request' } }, '*');
    parent.postMessage({ pluginMessage: { type: 'history-request' } }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, [persistEntries]);

  const onUpgrade = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'billing-checkout' } }, '*');
  }, []);

  const selectProfile = useCallback((u: string) => {
    const user = String(u)
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!user) return;
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
      setPreviewLoading(false);
      setPreview(null);
      setPreviewError('');
      return;
    }
    const timer = window.setTimeout(() => {
      const reqId = previewReqId.current + 1;
      previewReqId.current = reqId;
      setPreviewLoading(true);
      setPreviewThumbsLoading(false);
      setPreviewError('');
      parent.postMessage(
        {
          pluginMessage: {
            type: 'profile-preview',
            requestId: reqId,
            username: user,
            maxPosts,
            expandCarouselImages,
            selectionMode,
            startIndex,
            postCount,
            timelineOrder,
            previewListSize: maxPostsLimit,
          },
        },
        '*',
      );
    }, 420);
    return () => window.clearTimeout(timer);
  }, [
    activeTab,
    importing,
    username,
    maxPosts,
    expandCarouselImages,
    selectionMode,
    startIndex,
    postCount,
    timelineOrder,
    maxPostsLimit,
  ]);

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
    lastImportUsername.current = user;
    setImporting(true);
    setStatus('Starting import…');
    const posts = Math.min(maxPostsLimit, Math.max(1, Math.floor(maxPosts)));
    parent.postMessage(
      {
        pluginMessage: {
          type: 'import-profile',
          username: user,
          maxPosts: posts,
          expandCarouselImages,
          selectionMode,
          startIndex,
          postCount,
          timelineOrder,
        },
      },
      '*',
    );
  }, [
    username,
    maxPosts,
    expandCarouselImages,
    quotaExceeded,
    maxPostsLimit,
    selectionMode,
    startIndex,
    postCount,
    timelineOrder,
  ]);

  const onToggleFavoriteRow = useCallback(
    (u: string) => {
      persistEntries((prev) => toggleFavorite(prev, u));
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
                listStatus={listStatus}
                username={username}
                maxPosts={maxPosts}
                maxPostsLimit={maxPostsLimit}
                selectionMode={selectionMode}
                startIndex={startIndex}
                postCount={postCount}
                timelineOrder={timelineOrder}
                expandCarouselImages={expandCarouselImages}
                allowCarousel={allowCarousel}
                quotaExceeded={quotaExceeded}
                planTier={planTier}
                sessionError={sessionError}
                status={status}
                importing={importing}
                preview={preview}
                previewLoading={previewLoading}
                previewThumbsLoading={previewThumbsLoading}
                previewError={previewError}
                onUsernameChange={setUsername}
                onMaxPostsChange={setMaxPosts}
                onSelectionModeChange={setSelectionMode}
                onStartIndexChange={setStartIndex}
                onPostCountChange={setPostCount}
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
