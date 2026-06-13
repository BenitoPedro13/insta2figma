import { cn } from '../utils/cn';
import type { ElementType, ReactNode } from 'react';

type ImportSubmitButtonProps = {
  importing: boolean;
  progress: number;
  disabled?: boolean;
  icon: ElementType;
  children: ReactNode;
  className?: string;
};

export function ImportSubmitButton({
  importing,
  progress,
  disabled = false,
  icon: Icon,
  children,
  className,
}: ImportSubmitButtonProps) {
  const pct = Math.min(100, Math.max(0, progress));
  const fillCoversLabel = importing && pct >= 48;

  return (
    <button
      type="submit"
      disabled={disabled}
      className={cn(
        'import-submit-btn group relative inline-flex h-10 w-full cursor-pointer items-center justify-center gap-3 overflow-hidden rounded-10 px-3.5 text-label-sm outline-none transition duration-200 ease-out',
        'focus:outline-none disabled:pointer-events-none disabled:cursor-not-allowed',
        importing
          ? cn(
              'import-submit-btn--loading bg-bg-soft-200',
              fillCoversLabel ? 'text-text-white-0' : 'text-text-strong-950',
            )
          : 'bg-bg-strong-950 text-text-white-0 shadow-fancy-buttons-neutral disabled:bg-bg-weak-50 disabled:text-text-disabled-300 disabled:shadow-none',
        className,
      )}
      aria-busy={importing}
    >
      {importing ? (
        <span
          className="import-submit-btn-fill pointer-events-none absolute inset-y-0 left-0 bg-bg-strong-950 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      ) : null}
      <span className="relative z-10 inline-flex items-center justify-center gap-3">
        <Icon className="size-5 shrink-0" aria-hidden />
        {children}
      </span>
    </button>
  );
}
