import { useEffect, useState } from 'react';
import { RiCheckLine } from '@remixicon/react';
import { cn } from '../utils/cn';

type ImportStatusLineProps = {
  text: string;
  /** Show terminal cursor + pulsing text while import is in progress. */
  active?: boolean;
  /** Success state after import completes ("All done"). */
  complete?: boolean;
};

export function ImportStatusLine({
  text,
  active = false,
  complete = false,
}: ImportStatusLineProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!complete) {
      setRevealed(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setRevealed(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [complete, text]);

  if (complete) {
    return (
      <p className="import-status-line m-0" role="status" aria-live="polite">
        <span
          className={cn(
            'import-status-complete inline-flex min-w-0 items-center gap-1.5 text-paragraph-xs font-medium text-success-base',
            revealed && 'import-status-complete--visible',
          )}
        >
          <RiCheckLine className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{text}</span>
        </span>
      </p>
    );
  }

  return (
    <p
      className="import-status-line m-0 text-paragraph-xs text-text-sub-600"
      role="status"
      aria-live="polite"
    >
      {active ? <span className="import-status-cursor" aria-hidden /> : null}
      <span
        className={cn(
          'import-status-text min-w-0',
          active && 'import-status-text--pulse',
        )}
      >
        {text}
      </span>
    </p>
  );
}
