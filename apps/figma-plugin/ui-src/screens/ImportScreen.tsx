import { useCallback, useState, type FormEvent } from "react";
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiInformationFill,
  RiInstagramFill,
  RiLoader4Line,
} from "@remixicon/react";
import { PanelHeader } from "../components/PanelHeader";
import { PluginTabs, type ShellTab } from "../components/PluginTabs";
import {
  PostPreviewList,
  type PostPreviewItem,
} from "../components/PostPreviewList";
import type { HistoryEntry } from "../lib/historyStorage";
import { ListScreen, type ListTab } from "./ListScreen";
import * as FancyButton from "../components/ui/fancy-button";
import * as Input from "../components/ui/input";
import * as Button from "../components/ui/button";
import { CheckboxLabel } from "../components/ui/checkbox-label";
import { CounterField } from "../components/ui/counter-field";
import { cn } from "../utils/cn";

export type PostSelectionMode = "recent" | "single" | "range";
export type PostTimelineOrder = "newest_first" | "oldest_first";

type ImportScreenProps = {
  activeTab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  listTab: ListTab;
  search: string;
  onSearchChange: (q: string) => void;
  historyEntries: HistoryEntry[];
  selectedUsername: string | null;
  onSelectProfile: (username: string) => void;
  onToggleFavorite: (username: string) => void;
  listStatus: string;
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
  planTier: "free" | "pro";
  sessionError?: string;
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
  activeTab,
  onTabChange,
  listTab,
  search,
  onSearchChange,
  historyEntries,
  selectedUsername,
  onSelectProfile,
  onToggleFavorite,
  listStatus,
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
  sessionError,
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
      if (selectionMode === "recent") {
        onSelectionModeChange("single");
      }
    },
    [onSelectionModeChange, onStartIndexChange, selectionMode],
  );

  const ctaLabel = (() => {
    if (importing) return "Importing…";
    const estimated = preview?.estimatedImportImages;
    if (
      typeof estimated === "number" &&
      Number.isFinite(estimated) &&
      estimated > 0
    ) {
      return `Import ${estimated} ${estimated === 1 ? "image" : "images"}`;
    }
    if (selectionMode === "single") return `Import post #${startIndex}`;
    if (selectionMode === "range") {
      return `Import posts #${startIndex}–#${startIndex + postCount - 1}`;
    }
    return `Import Feed (${maxPosts} posts)`;
  })();

  const trimmedUsername = username.trim();
  const usernameLookupStatus = (() => {
    if (!trimmedUsername) return "idle" as const;
    if (previewLoading) return "searching" as const;
    if (preview?.username) return "found" as const;
    if (previewError) return "not-found" as const;
    return "idle" as const;
  })();
  const showUsernameLookup = usernameLookupStatus !== "idle";
  const isImportTab = activeTab === "new-import";

  return (
    <div className="new-import-screen flex min-h-0 flex-1 flex-col">
      <div className="new-import-layout flex min-h-0 flex-1 flex-row">
        <div className="new-import-left flex w-[466px] shrink-0 flex-col border-r border-stroke-soft-200 bg-bg-white-0">
          <PanelHeader planTier={planTier} sessionError={sessionError} />
          <PluginTabs active={activeTab} onChange={onTabChange} />
          {isImportTab ? (
            <form
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
              onSubmit={onSubmit}
            >
              <div className="new-import-field flex flex-col gap-2">
                <label
                  htmlFor="username"
                  className="new-import-label text-label-sm  text-text-strong-950"
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
                      placeholder="@profile"
                      autoComplete="off"
                      
                    />
                  </Input.Wrapper>
                </Input.Root>
                <div className="new-import-status-slot" aria-live="polite">
                  {!showUsernameLookup ? (
                    <p className="new-import-status new-import-status--visible m-0 text-paragraph-xs text-text-sub-600">
                      <RiInformationFill
                        size={16}
                        className="new-import-status-icon text-text-soft-400"
                        aria-hidden
                      />
                      Insert username or link
                    </p>
                  ) : (
                    <p
                      role="status"
                      className={cn(
                        "new-import-status new-import-status--visible text-paragraph-xs",
                        usernameLookupStatus === "found" && "text-success-base",
                        usernameLookupStatus === "not-found" && "text-warning-base",
                        usernameLookupStatus === "searching" && "text-text-sub-600",
                      )}
                    >
                      {usernameLookupStatus === "searching" ? (
                        <>
                          <RiLoader4Line className="new-import-spinner" size={16} aria-hidden />
                          Searching username
                        </>
                      ) : null}
                      {usernameLookupStatus === "found" ? (
                        <>
                          <RiCheckLine className="new-import-status-icon" size={16} aria-hidden />
                          Username found
                        </>
                      ) : null}
                      {usernameLookupStatus === "not-found" ? (
                        <>
                          <RiInformationFill
                            className="new-import-status-icon"
                            size={16}
                            aria-hidden
                          />
                          Username not found
                        </>
                      ) : null}
                    </p>
                  )}
                </div>
              </div>

              <div className="profile-preview">
                <span className="profile-preview-avatar" aria-hidden>
                  {preview?.profilePicUrlHd ? (
                    <img
                      src={preview.profilePicUrlHd}
                      alt=""
                      className="profile-preview-avatar-img"
                    />
                  ) : (
                    username.slice(0, 1).toUpperCase() || "?"
                  )}
                </span>
                <div className="profile-preview-meta">
                  <p className="profile-preview-main">
                    {previewLoading
                      ? previewThumbsLoading
                        ? "Loading thumbnails…"
                        : "Checking profile…"
                      : preview
                        ? `@${preview.username} · ${preview.mediaCount} posts`
                        : username.trim()
                          ? "No preview yet."
                          : "Enter a username to preview."}
                  </p>
                  {preview?.isPrivate ? (
                    <p className="profile-preview-sub">
                      Private account — posts may not be available to import.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="new-import-field flex flex-col gap-2">
                <label
                  htmlFor="max-posts-main"
                  className="new-import-label text-label-sm text-text-strong-950"
                >
                  Number of posts
                </label>
                <Input.Counter
                  id="max-posts-main"
                  value={maxPosts}
                  min={1}
                  max={maxPostsLimit}
                  onChange={onMaxPostsChange}
                />
                <p className="m-0 text-paragraph-xs text-text-sub-600">
                  {preview
                    ? `Estimate: ${preview.estimatedImportImages} image(s) · Covers ${preview.estimatedPostCovers} · Carousel +${preview.estimatedCarouselExtras}`
                    : "How many recent posts to import."}
                </p>
              </div>

              <div className="new-import-checks">
                <CheckboxLabel
                  label="Ignore Reels"
                  hint="Coming soon"
                  checked={false}
                  disabled
                />
                <CheckboxLabel
                  label="Import carousel images"
                  hint={!allowCarousel ? "Available on Pro" : undefined}
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
                  <span className="text-label-sm font-semibold text-text-strong-950">
                    Advanced
                  </span>
                  <RiArrowDownSLine
                    className={cn(
                      "new-import-advanced-chevron",
                      advancedOpen && "is-open",
                    )}
                    aria-hidden
                  />
                </button>
                {advancedOpen ? (
                  <div className="new-import-advanced-panel">
                    <div className="field">
                      <label
                        htmlFor="selection-mode"
                        className="text-label-sm text-text-sub-600"
                      >
                        Selection mode
                      </label>
                      <select
                        id="selection-mode"
                        className="new-import-select"
                        value={selectionMode}
                        onChange={(e) =>
                          onSelectionModeChange(
                            e.target.value as PostSelectionMode,
                          )
                        }
                      >
                        <option value="recent">
                          Recent posts (from #1 onward)
                        </option>
                        <option value="single">Single post by position</option>
                        <option value="range">Range by position</option>
                      </select>
                    </div>
                    <div className="field">
                      <label
                        htmlFor="timeline-order"
                        className="text-label-sm text-text-sub-600"
                      >
                        Timeline order
                      </label>
                      <select
                        id="timeline-order"
                        className="new-import-select"
                        value={timelineOrder}
                        onChange={(e) =>
                          onTimelineOrderChange(
                            e.target.value as PostTimelineOrder,
                          )
                        }
                      >
                        <option value="newest_first">
                          Newest first (#1 = latest post)
                        </option>
                        <option value="oldest_first">
                          Oldest first (#1 = oldest visible post)
                        </option>
                      </select>
                    </div>
                    {selectionMode !== "recent" ? (
                      <CounterField
                        id="start-index"
                        label="Start position (#)"
                        value={startIndex}
                        min={1}
                        max={maxPostsLimit}
                        onChange={onStartIndexChange}
                      />
                    ) : null}
                    {selectionMode === "range" ? (
                      <CounterField
                        id="post-count"
                        label="Number of posts in range"
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
                  Monthly quota used up on the{" "}
                  {planTier === "pro" ? "Pro" : "Free"} plan.
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
                  {quotaExceeded ? "Quota used up" : ctaLabel}
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
                <p className="status-line text-paragraph-xs text-text-sub-600">
                  {status}
                </p>
              ) : null}
            </form>
          ) : (
            <ListScreen
              tab={listTab}
              search={search}
              onSearchChange={onSearchChange}
              entries={historyEntries}
              selectedUsername={selectedUsername}
              onOpenImportForProfile={onSelectProfile}
              onToggleFavorite={onToggleFavorite}
              listStatus={listStatus}
            />
          )}
        </div>

        <div className="new-import-right" aria-live="polite">
          {preview?.postsPreview && preview.postsPreview.length > 0 ? (
            <PostPreviewList
              items={preview.postsPreview}
              timelineOrder={timelineOrder}
              selectionMode={selectionMode}
              startIndex={startIndex}
              postCount={selectionMode === "recent" ? maxPosts : postCount}
              postsAvailable={
                preview.postsAvailable ?? preview.postsPreview.length
              }
              selectionWarning={preview.selectionWarning}
              onSelectIndex={onPickPostIndex}
            />
          ) : (
            <div className="new-import-preview-empty flex h-full w-full flex-col items-center justify-center p-6 text-center">
              <p className="new-import-preview-title m-0 text-label-sm font-semibold text-text-strong-950">
                Preview
              </p>
              <p className="new-import-preview-copy mt-1.5 max-w-[240px] text-paragraph-xs text-text-sub-600">
                {username.trim()
                  ? previewLoading
                    ? "Loading preview…"
                    : previewError
                      ? previewError
                      : "No posts in preview yet."
                  : "Enter an Instagram username to see a preview here."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
