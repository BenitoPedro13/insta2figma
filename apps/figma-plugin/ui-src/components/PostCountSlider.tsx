import { useCallback, useMemo, useState } from "react";
import * as Slider from "./ui/slider";
import * as Switch from "./ui/switch";
import { cn } from "../utils/cn";

type PostCountSliderProps = {
  profilePostCount: number | null;
  planMaxPosts: number;
  planTier: "free" | "pro";
  /** Profile resolved successfully — range switch only when true. */
  profileFound: boolean;
  rangeMode: boolean;
  onRangeModeChange: (enabled: boolean) => void;
  postCount: number;
  onPostCountChange: (count: number) => void;
  rangeStart: number;
  rangeLength: number;
  onRangeChange: (start: number, length: number) => void;
  disabled?: boolean;
  className?: string;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function PostCountSlider({
  profilePostCount,
  planMaxPosts,
  planTier,
  profileFound,
  rangeMode,
  onRangeModeChange,
  postCount,
  onPostCountChange,
  rangeStart,
  rangeLength,
  onRangeChange,
  disabled = false,
  className,
}: PostCountSliderProps) {
  const [dragging, setDragging] = useState(false);
  const accent = planTier === "pro" ? "pro" : "free";

  const sliderMax = useMemo(() => {
    const fromProfile =
      profilePostCount != null && Number.isFinite(profilePostCount)
        ? Math.max(0, Math.floor(profilePostCount))
        : null;
    if (fromProfile != null && fromProfile > 0) return fromProfile;
    return Math.max(0, planMaxPosts);
  }, [profilePostCount, planMaxPosts]);

  const rangeEnd = rangeStart + Math.max(0, rangeLength) - 1;

  const countSliderValue = useMemo(
    () => [clamp(postCount, 0, sliderMax)],
    [postCount, sliderMax],
  );

  const rangeSliderValue = useMemo(() => {
    const start0 = clamp(rangeStart - 1, 0, sliderMax);
    const end0 = clamp(rangeEnd - 1, start0, sliderMax);
    return [start0, end0];
  }, [rangeStart, rangeEnd, sliderMax]);

  const onCountSliderChange = useCallback(
    (values: number[]) => {
      const next = clamp(values[0] ?? 0, 0, sliderMax);
      onPostCountChange(next);
    },
    [onPostCountChange, sliderMax],
  );

  const onRangeSliderChange = useCallback(
    (values: number[]) => {
      const a = clamp(values[0] ?? 0, 0, sliderMax);
      const b = clamp(values[1] ?? a, a, sliderMax);
      onRangeChange(a + 1, b - a + 1);
    },
    [onRangeChange, sliderMax],
  );

  const handleRangeModeToggle = useCallback(
    (checked: boolean) => {
      if (!profileFound) return;
      if (checked) {
        const count = Math.max(1, postCount);
        const end0 = Math.min(sliderMax, count - 1);
        onRangeChange(1, end0 + 1);
      } else {
        const length = Math.max(0, rangeLength);
        onPostCountChange(length);
      }
      onRangeModeChange(checked);
    },
    [
      profileFound,
      onRangeModeChange,
      onRangeChange,
      onPostCountChange,
      postCount,
      rangeLength,
      sliderMax,
    ],
  );

  const summary = rangeMode
    ? rangeLength < 1
      ? "Select a post range"
      : rangeStart === rangeEnd
        ? `Post #${rangeStart} · 1 post`
        : `Posts #${rangeStart}–#${rangeEnd} · ${rangeLength} posts`
    : postCount < 1
      ? "0 posts selected"
      : `${postCount} ${postCount === 1 ? "post" : "posts"} selected`;

  const overPlan =
    !rangeMode && postCount > planMaxPosts && postCount > 0;

  const countTooltip = String(postCount);
  const rangeStartTooltip = `#${rangeStart}`;
  const rangeEndTooltip = `#${rangeEnd}`;
  const tooltipOpen = dragging;

  const rangeSwitchDisabled =
    disabled || !profileFound || sliderMax < 1;

  const sliderDisabled = disabled || !profileFound;

  return (
    <div className={cn("post-count-slider flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-label-sm font-semibold text-text-strong-950">
            {summary}
          </p>
          
        </div>
        <label
          className={cn(
            "flex shrink-0 items-center gap-2",
            rangeSwitchDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          )}
        >
          <span className="text-paragraph-xs text-text-sub-600">Range</span>
          <Switch.Root
            checked={rangeMode}
            disabled={rangeSwitchDisabled}
            onCheckedChange={handleRangeModeToggle}
            aria-label="Range mode"
          />
        </label>
      </div>

      {sliderMax > 0 ? (
        <Slider.TooltipProvider>
          <Slider.Root
            min={0}
            max={sliderMax}
            step={1}
            accent={accent}
            disabled={sliderDisabled}
            value={rangeMode ? rangeSliderValue : countSliderValue}
            onValueChange={
              rangeMode ? onRangeSliderChange : onCountSliderChange
            }
            onPointerDown={() => {
              if (!sliderDisabled) setDragging(true);
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            className={cn(
              "post-count-slider-track",
              sliderDisabled && "pointer-events-none opacity-50",
            )}
          >
            {rangeMode ? (
              <>
                <Slider.Thumb
                  accent={accent}
                  tooltipLabel={rangeStartTooltip}
                  tooltipOpen={tooltipOpen}
                  aria-label="Range start"
                />
                <Slider.Thumb
                  accent={accent}
                  tooltipLabel={rangeEndTooltip}
                  tooltipOpen={tooltipOpen}
                  aria-label="Range end"
                />
              </>
            ) : (
              <Slider.Thumb
                accent={accent}
                tooltipLabel={countTooltip}
                tooltipOpen={tooltipOpen}
                aria-label="Post count"
              />
            )}
          </Slider.Root>
        </Slider.TooltipProvider>
      ) : (
        <p className="m-0 text-paragraph-xs text-text-soft-400">
          No posts available on this profile.
        </p>
      )}

      {overPlan ? (
        <p className="m-0 text-paragraph-xs text-warning-base">
          Your plan allows up to {planMaxPosts} posts per import. The server
          will cap the job to that limit.
        </p>
      ) : null}
    </div>
  );
}
