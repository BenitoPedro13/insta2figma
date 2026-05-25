import { cn } from '../utils/cn';

type ImportStatusLineProps = {
  text: string;
  /** Show terminal cursor + pulsing text while import is in progress. */
  active?: boolean;
};

export function ImportStatusLine({ text, active = false }: ImportStatusLineProps) {
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
