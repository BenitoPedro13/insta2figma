import { useCallback, useEffect, type FormEvent } from "react";
import {
  RiCheckLine,
  RiImageLine,
  RiInformationFill,
  RiInstagramFill,
  RiLayoutGridLine,
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
import { PostPreviewSkeletonGrid } from "../components/PostPreviewSkeletonGrid";
import { ProfilePreviewMorseSkeleton } from "../components/ProfilePreviewMorseSkeleton";
import { Skeleton } from "../components/Skeleton";
import * as FancyButton from "../components/ui/fancy-button";
import * as Input from "../components/ui/input";
import * as Button from "../components/ui/button";
import { CheckboxLabel } from "../components/ui/checkbox-label";
import { ImportStatusLine } from "../components/ImportStatusLine";
import { PostPreviewPagination } from "../components/PostPreviewPagination";
import { ProUpgradeOverlay } from "../components/ProUpgradeOverlay";
import { cn } from "../utils/cn";
import { PREVIEW_PAGE_SIZE, maxAccessiblePreviewPage, type PostSelectionMode, type PostTimelineOrder } from "@insta2figma/shared-contracts";
import { planTierLabel, type PlanTier } from "../lib/planTier";

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
  maxImagesLimit: number;
  selectedIndices: number[];
  selectionMode: PostSelectionMode;
  startIndex: number;
  postCount: number;
  timelineOrder: PostTimelineOrder;
  expandCarouselImages: boolean;
  quotaExceeded: boolean;
  imagesRemaining: number | null;
  planTier: PlanTier;
  sessionError?: string;
  status: string;
  importing: boolean;
  preview: {
    username: string;
    mediaCount: number;
    imageCount?: number;
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
  previewPageLoading: boolean;
  previewThumbsLoading: boolean;
  previewError: string;
  previewErrorKind?: 'not-found' | 'service-error';
  previewPage: number;
  previewTotalPages: number;
  onPreviewPageChange: (page: number) => void;
  onPreviewBlockedAdvance: () => void;
  showProOverlay: boolean;
  onCloseProOverlay: () => void;
  onUsernameChange: (v: string) => void;
  onUsernameBlur?: () => void;
  onMaxPostsChange: (v: number) => void;
  onSelectionModeChange: (v: PostSelectionMode) => void;
  onStartIndexChange: (v: number) => void;
  onPostCountChange: (v: number) => void;
  onRangeChange: (start: number, length: number) => void;
  onTogglePostIndex: (index: number) => void;
  onTimelineOrderChange: (v: PostTimelineOrder) => void;
  onExpandCarouselChange: (v: boolean) => void;
  onImport: () => void;
  onShowUpgradeOverlay: () => void;
  onBillingCheckout: (cycle?: 'monthly' | 'yearly') => void;
  onBillingCheckoutMax: (cycle?: 'monthly' | 'yearly') => void;
  onManage: () => void;
  onSignOut: () => void;
  onOpenExternal: (url: string) => void;
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
  maxImagesLimit,
  selectedIndices,
  selectionMode,
  startIndex,
  postCount,
  timelineOrder,
  expandCarouselImages,
  quotaExceeded,
  imagesRemaining,
  planTier,
  sessionError,
  status,
  importing,
  preview,
  previewLoading,
  previewPageLoading,
  previewThumbsLoading,
  previewError,
  previewErrorKind = 'not-found',
  previewPage,
  previewTotalPages,
  onPreviewPageChange,
  onPreviewBlockedAdvance,
  showProOverlay,
  onCloseProOverlay,
  onUsernameChange,
  onUsernameBlur,
  onMaxPostsChange,
  onSelectionModeChange,
  onStartIndexChange,
  onPostCountChange,
  onRangeChange,
  onTogglePostIndex,
  onTimelineOrderChange,
  onExpandCarouselChange,
  onImport,
  onShowUpgradeOverlay,
  onBillingCheckout,
  onBillingCheckoutMax,
  onManage,
  onSignOut,
  onOpenExternal,
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
    if (previewLoading && !preview?.username) return "searching" as const;
    if (preview?.username) return "found" as const;
    if (previewError) return previewErrorKind === 'service-error' ? "service-error" as const : "not-found" as const;
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

  const estimatedImportImages =
    typeof preview?.estimatedImportImages === "number" &&
    Number.isFinite(preview.estimatedImportImages) &&
    preview.estimatedImportImages > 0
      ? preview.estimatedImportImages
      : selectedIndices.length;
  const exceedsImageQuota =
    imagesRemaining != null && estimatedImportImages > imagesRemaining;
  const exceedsPerImportLimit = estimatedImportImages > maxImagesLimit;
  const canImport =
    !quotaExceeded &&
    !exceedsImageQuota &&
    !exceedsPerImportLimit &&
    selectedIndices.length >= 1;

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
    if (preview?.username) return `@${preview.username}`;
    return "Enter an Instagram to appear here";
  })();

  const showProfileHeaderSkeleton = previewLoading && !preview?.username;
  const showProfileStatsSkeleton =
    Boolean(trimmedUsername) && previewLoading && !preview?.username;
  const showAvatarSkeleton =
    showProfileHeaderSkeleton ||
    Boolean(preview?.username && !preview.profilePicUrlHd);
  const showPreviewSkeletonGrid =
    (previewLoading && !(preview?.postsPreview && preview.postsPreview.length > 0)) ||
    previewPageLoading;
  const maxAccessiblePreviewPageValue = maxAccessiblePreviewPage(
    planTier,
    previewTotalPages,
  );

  const formatProfileStat = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toLocaleString("en-US")
      : "0";

  return (
    <div className="new-import-screen flex min-h-0 flex-1 flex-col">
      <div className="new-import-layout flex min-h-0 flex-1 flex-row">
        <div className="new-import-left flex w-[466px] shrink-0 flex-col border-r border-stroke-soft-200 bg-bg-white-0">
          <PanelHeader
            planTier={planTier}
            sessionError={sessionError}
            onUpgrade={onShowUpgradeOverlay}
            onManage={onManage}
            onSignOut={onSignOut}
            onOpenExternal={onOpenExternal}
          />
          <PluginTabs active={activeTab} onChange={onTabChange} />
          {isImportTab ? (
            <form
              className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4"
              onSubmit={onSubmit}
            >
              <div className="new-import-field flex flex-col gap-4">
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
                      onBlur={() => onUsernameBlur?.()}
                      placeholder="@profile or instagram.com/…"
                      autoComplete="off"
                      className="text-paragraph-md"
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
                        usernameLookupStatus === "service-error" && "text-error-base",
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
                            className="new-import-status-icon shrink-0"
                            size={16}
                            aria-hidden
                          />
                          <span className="min-w-0 break-words">
                            {previewError.trim()
                              ? previewError.trim().split("\n")[0]
                              : "Username not found"}
                          </span>
                        </>
                      ) : null}
                      {usernameLookupStatus === "service-error" ? (
                        <>
                          <RiInformationFill
                            className="new-import-status-icon shrink-0"
                            size={16}
                            aria-hidden
                          />
                          <span className="min-w-0 break-words">
                            {previewError.trim().split("\n")[0]}
                          </span>
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
                <div className="new-import-status-slot" aria-live="polite">
                  <p className="new-import-status new-import-status--visible m-0 text-paragraph-xs text-text-sub-600">
                    {/* <RiInformationFill
                      size={16}
                      className="new-import-status-icon text-text-soft-400"
                      aria-hidden
                    /> */}
                    {profileFound &&
                    preview?.mediaCount != null &&
                    Number.isFinite(preview.mediaCount) ? (
                      <>
                        This Instagram has{" "}
                        <span className="font-semibold">{preview.mediaCount}</span>{" "}
                        {preview.mediaCount === 1 ? "post" : "posts"}
                      </>
                    ) : (
                      "Posts will be imported chronologically"
                    )}
                  </p>
                </div>
              </div>

              <div className="new-import-checks">
                <CheckboxLabel
                  label="Import carousel images"
                  checked={expandCarouselImages}
                  tone="neutral"
                  onCheckedChange={onExpandCarouselChange}
                />
                <CheckboxLabel
                  label="Ignore Reels"
                  hint="Coming soon"
                  checked={false}
                  tone="neutral"
                  disabled
                />
              </div>

              {quotaExceeded || exceedsImageQuota || exceedsPerImportLimit ? (
                <p className="import-quota-warn">
                  {exceedsPerImportLimit && !quotaExceeded && !exceedsImageQuota
                    ? `Each import can use at most ${maxImagesLimit} images. Reduce your selection or turn off carousel expansion.`
                    : exceedsImageQuota && !quotaExceeded
                      ? `This import needs ${estimatedImportImages} images but you only have ${imagesRemaining} left in your quota period.`
                      : `Image quota used up on the ${planTierLabel(planTier)} plan.`}
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
                  {quotaExceeded || exceedsImageQuota || exceedsPerImportLimit
                    ? "Quota used up"
                    : !canImport
                      ? "Select images to import"
                      : ctaLabel}
                </FancyButton.Root>
                {quotaExceeded && planTier === "free" ? (
                  <Button.Root
                    type="button"
                    variant="primary"
                    mode="stroke"
                    size="medium"
                    className="w-full"
                    onClick={onShowUpgradeOverlay}
                  >
                    Upgrade
                  </Button.Root>
                ) : null}
              </div>
              {status ? (
                <ImportStatusLine
                  text={status}
                  active={importing}
                  complete={!importing && status.startsWith('All done')}
                />
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
            <div className="profile-preview-identity flex min-w-0 flex-1 items-center gap-3">
              <span className="profile-preview-avatar" aria-hidden>
                {showAvatarSkeleton ? (
                  <Skeleton className="profile-preview-avatar-skeleton" />
                ) : preview?.profilePicUrlHd ? (
                  <img
                    src={preview.profilePicUrlHd}
                    alt=""
                    className="profile-preview-avatar-img"
                  />
                ) : null}
              </span>
              <div className="profile-preview-meta min-w-0">
                {showProfileHeaderSkeleton ? (
                  <Skeleton className="profile-preview-name-skeleton" />
                ) : (
                  <p
                    className={cn(
                      "profile-preview-main text-paragraph-lg",
                      !preview?.username && "font-normal text-text-sub-600",
                    )}
                  >
                    {profilePreviewLabel}
                  </p>
                )}
                {preview?.isPrivate ? (
                  <p className="profile-preview-sub">
                    Private account — posts may not be available to import.
                  </p>
                ) : null}
              </div>
            </div>

            {trimmedUsername ? (
              <div className="profile-preview-stats flex shrink-0 items-center gap-2">
                <div className="profile-preview-stat flex items-center gap-1">
                  <RiLayoutGridLine
                    className="size-4 shrink-0 text-text-sub-600"
                    aria-hidden
                  />
                  {showProfileStatsSkeleton ? (
                    <ProfilePreviewMorseSkeleton compact />
                  ) : (
                    <span className="text-label-sm font-medium tabular-nums text-text-strong-950">
                      {formatProfileStat(preview?.mediaCount)}
                    </span>
                  )}
                </div>
                <div className="profile-preview-stat flex items-center gap-1">
                  <RiImageLine
                    className="size-4 shrink-0 text-text-sub-600"
                    aria-hidden
                  />
                  {showProfileStatsSkeleton ? (
                    <ProfilePreviewMorseSkeleton compact />
                  ) : (
                    <span className="text-label-sm font-medium tabular-nums text-text-strong-950">
                      {formatProfileStat(preview?.imageCount ?? preview?.mediaCount)}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="new-import-right-body flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              {showPreviewSkeletonGrid ? (
                <PostPreviewSkeletonGrid count={PREVIEW_PAGE_SIZE} />
              ) : preview?.postsPreview && preview.postsPreview.length > 0 ? (
                <PostPreviewList
                  items={preview.postsPreview}
                  selectedIndices={selectedIndices}
                  onToggleIndex={onTogglePostIndex}
                  thumbsLoading={previewThumbsLoading}
                />
              ) : (
                <div className="new-import-preview-empty flex h-full w-full" aria-hidden />
              )}
            </div>

            {previewTotalPages > 1 ? (
              <PostPreviewPagination
                currentPage={previewPage}
                totalPages={previewTotalPages}
                maxAccessiblePage={maxAccessiblePreviewPageValue}
                onPageChange={onPreviewPageChange}
                onBlockedAdvance={onPreviewBlockedAdvance}
              />
            ) : null}
          </div>
        </div>
      </div>

      <ProUpgradeOverlay
        open={showProOverlay}
        onClose={onCloseProOverlay}
        onUpgrade={onBillingCheckout}
        onUpgradeMax={onBillingCheckoutMax}
        onOpenExternal={onOpenExternal}
      />
    </div>
  );
}
