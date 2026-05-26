import type { CSSProperties } from 'react';
import { cn } from '../utils/cn';

export const PLUGIN_SCALE_MARKS = [0, 50, 150, 250, 350, 450, 550, 650];
export const OVERLAY_SCALE_MARKS = [0, 50, 150, 200, 250, 300, 350, 400];

type ChromeRulerProps = {
  marks?: number[];
  className?: string;
  style?: CSSProperties;
};

export function ChromeRuler({
  marks = PLUGIN_SCALE_MARKS,
  className,
  style,
}: ChromeRulerProps) {
  return (
    <div
      className={cn('plugin-sidebar-ruler flex min-h-0 flex-1 flex-col', className)}
      style={style}
      aria-hidden
    >
      <div className="plugin-sidebar-track">
        {marks.map((n) => (
          <span key={n} className="plugin-sidebar-mark">
            <span className="plugin-sidebar-mark-label">{n}</span>
            <span className="plugin-sidebar-mark-tick" aria-hidden />
          </span>
        ))}
      </div>
    </div>
  );
}
