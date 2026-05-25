import { useCallback, useEffect, type FormEvent } from "react";
import {
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
import { PostCountSlider } from "../components/PostCountSlider";
import * as FancyButton from "../components/ui/fancy-button";
import * as Input from "../components/ui/input";
import * as Button from "../components/ui/button";
import { CheckboxLabel } from "../components/ui/checkbox-label";
import { ImportStatusLine } from "../components/ImportStatusLine";
import { cn } from "../utils/cn";
import type { PostSelectionMode, PostTimelineOrder } from "@insta2figma/shared-contracts";

export type { PostSelectionMode, PostTimelineOrder };

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
  onRemoveFromHistory: (username: string) => void;
  listStatus: string;
  username: string;
  maxPosts: number;
  maxPostsLimit: number;
  selectedIndices: number[];
  selectionMode: PostSelectionMode;
  startIndex: number;
  postCount: number;
  timelineOrder: PostTimelineOrder;
  expandCarouselImages: boolean;
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
  onRangeChange: (start: number, length: number) => void;
  onTogglePostIndex: (index: number) => void;
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
  onRemoveFromHistory,
  listStatus,
  username,
  maxPosts,
  maxPostsLimit,
  selectedIndices,
  selectionMode,
  startIndex,
  postCount,
  timelineOrder,
  expandCarouselImages,
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
  onRangeChange,
  onTogglePostIndex,
  onTimelineOrderChange,
  onExpandCarouselChange,
  onImport,
  onUpgrade,
}: ImportScreenProps) {
  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      onImport();
    },
    [onImport],
  );

  const trimmedUsername = username.trim();
  const usernameLookupStatus = (() => {
    if (!trimmedUsername) return "idle" as const;
    if (previewLoading) return "searching" as const;
    if (preview?.username) return "found" as const;
    if (previewError) return "not-found" as const;
    return "idle" as const;
  })();
  const profileFound = usernameLookupStatus === "found";

  const ctaLabel = (() => {
    if (importing) return "Importing…";
    const images = preview?.estimatedImportImages;
    if (typeof images === "number" && Number.isFinite(images) && images > 0) {
      return `Import ${images} ${images === 1 ? "image" : "images"}`;
    }
    return "Import images";
  })();

  const rangeMode = selectionMode === "range";

  useEffect(() => {
    if (!profileFound && rangeMode) {
      onSelectionModeChange("recent");
    }
  }, [profileFound, rangeMode, onSelectionModeChange]);

  const canImport = !quotaExceeded && selectedIndices.length >= 1;

  const handleRangeModeChange = useCallback(
    (enabled: boolean) => {
      onSelectionModeChange(enabled ? "range" : "recent");
    },
    [onSelectionModeChange],
  );

  const handleRangeSliderChange = useCallback(
    (start: number, length: number) => {
      onRangeChange(start, length);
    },
    [onRangeChange],
  );

  const showUsernameLookup = usernameLookupStatus !== "idle";
  const isImportTab = activeTab === "new-import";

  const profilePreviewLabel = (() => {
    if (previewLoading && !preview?.username) return "Checking profile…";
    if (preview?.username) return `@${preview.username}`;
    return "Enter an Instagram to appear here";
  })();

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
                  What user?
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

              <div className="new-import-field flex flex-col gap-2">
                <PostCountSlider
                  profilePostCount={
                    preview?.mediaCount != null ? preview.mediaCount : null
                  }
                  planMaxPosts={maxPostsLimit}
                  planTier={planTier}
                  profileFound={profileFound}
                  rangeMode={rangeMode}
                  onRangeModeChange={handleRangeModeChange}
                  postCount={selectedIndices.length}
                  onPostCountChange={onMaxPostsChange}
                  rangeStart={startIndex}
                  rangeLength={postCount}
                  onRangeChange={handleRangeSliderChange}
                  disabled={importing}
                />
                
              </div>

              <div className="new-import-checks">
                <CheckboxLabel
                  label="Import carousel images"
                  checked={expandCarouselImages}
                  onCheckedChange={onExpandCarouselChange}
                />
                <CheckboxLabel
                  label="Ignore Reels"
                  hint="Coming soon"
                  checked={false}
                  disabled
                />
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
                  variant="neutral"
                  size="medium"
                  className="w-full"
                  disabled={importing || !canImport}
                >
                  <FancyButton.Icon as={RiInstagramFill} />
                  {quotaExceeded
                    ? "Quota used up"
                    : !canImport
                      ? "Select images to import"
                      : ctaLabel}
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
                <ImportStatusLine text={status} active={importing} />
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
              onRemoveFromHistory={onRemoveFromHistory}
              listStatus={listStatus}
            />
          )}
        </div>

        <div className="new-import-right flex min-h-0 min-w-0 flex-1 flex-col" aria-live="polite">
          <div className="profile-preview profile-preview--header">
            <span className="profile-preview-avatar" aria-hidden>
              {preview?.profilePicUrlHd ? (
                <img
                  src={preview.profilePicUrlHd}
                  alt=""
                  className="profile-preview-avatar-img"
                />
              ) : null}
            </span>
            <div className="profile-preview-meta">
              <p
                className={cn(
                  "profile-preview-main",
                  !preview?.username && "font-normal text-text-sub-600",
                )}
              >
                {profilePreviewLabel}
              </p>
              {preview?.isPrivate ? (
                <p className="profile-preview-sub">
                  Private account — posts may not be available to import.
                </p>
              ) : null}
            </div>
          </div>

          <div className="new-import-right-body flex min-h-0 flex-1 flex-col overflow-hidden">
            {preview?.postsPreview && preview.postsPreview.length > 0 ? (
              <PostPreviewList
                items={preview.postsPreview}
                selectedIndices={selectedIndices}
                onToggleIndex={onTogglePostIndex}
              />
            ) : (
              <div className="new-import-preview-empty flex h-full w-full" aria-hidden />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
