import { cn } from '../utils/cn';

type ProgressBarProps = {
  /** 0–100; omit for indeterminate */
  value?: number;
  className?: string;
};

export function ProgressBar({ value, className }: ProgressBarProps) {
  const indeterminate = value == null;
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div
      className={cn(
        'progress-bar',
        indeterminate && 'progress-bar--indeterminate',
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div
        className="progress-bar-fill"
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
