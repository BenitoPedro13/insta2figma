import { useCallback, useEffect, useMemo, useState } from "react";
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

function parseDigits(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function CompactNumericInput({
  id,
  value,
  min,
  max,
  disabled,
  ariaLabel,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  const safeValue = clamp(value, min, max);
  const [text, setText] = useState(String(safeValue));

  useEffect(() => {
    setText(String(safeValue));
  }, [safeValue]);

  const commit = (raw: string) => {
    const parsed = parseDigits(raw);
    const next = parsed == null ? min : clamp(parsed, min, max);
    setText(String(next));
    onChange(next);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      disabled={disabled}
      value={text}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={safeValue}
      className={cn(
        "post-count-input m-0 shrink-0 tabular-nums",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "");
        setText(next);
        const parsed = parseDigits(next);
        if (parsed != null) onChange(clamp(parsed, min, max));
      }}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (
          e.key === "Backspace" ||
          e.key === "Delete" ||
          e.key === "Tab" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "Home" ||
          e.key === "End"
        ) {
          return;
        }
        if (e.ctrlKey || e.metaKey) return;
        if (!/^\d$/.test(e.key)) e.preventDefault();
      }}
    />
  );
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

  const onRangeEndInput = useCallback(
    (end: number) => {
      const nextEnd = clamp(end, rangeStart, sliderMax);
      onRangeChange(rangeStart, nextEnd - rangeStart + 1);
    },
    [onRangeChange, rangeStart, sliderMax],
  );

  const onRangeStartInput = useCallback(
    (start: number) => {
      const nextStart = clamp(start, 1, sliderMax);
      const nextEnd = clamp(rangeEnd, nextStart, sliderMax);
      onRangeChange(nextStart, nextEnd - nextStart + 1);
    },
    [onRangeChange, rangeEnd, sliderMax],
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
        <p
          id="post-count-heading"
          className="m-0 text-label-sm font-semibold text-text-strong-950"
        >
          How many posts?
        </p>
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
        <div className="post-count-slider-row flex items-center gap-2">
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
                "post-count-slider-track min-w-0 flex-1",
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

          {rangeMode ? (
            <div className="post-count-range-inputs flex shrink-0 items-center gap-1">
              <CompactNumericInput
                id="post-range-start"
                value={rangeStart}
                min={1}
                max={sliderMax}
                disabled={sliderDisabled}
                ariaLabel="Range start"
                onChange={onRangeStartInput}
              />
              <span className="text-paragraph-xs text-text-soft-400" aria-hidden>
                –
              </span>
              <CompactNumericInput
                id="post-range-end"
                value={rangeEnd}
                min={rangeStart}
                max={sliderMax}
                disabled={sliderDisabled}
                ariaLabel="Range end"
                onChange={onRangeEndInput}
              />
            </div>
          ) : (
            <CompactNumericInput
              id="post-count-input"
              value={postCount}
              min={0}
              max={sliderMax}
              disabled={sliderDisabled}
              ariaLabel="Number of posts"
              onChange={onPostCountChange}
            />
          )}
        </div>
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
