import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { cn } from '../utils/cn';

export const RULER_STEP_PX = 50;
export const RULER_ORIGIN_OFFSET_PX = 8;

type ChromeRulerProps = {
  stepPx?: number;
  className?: string;
  style?: CSSProperties;
};

export function ChromeRuler({
  stepPx = RULER_STEP_PX,
  className,
  style,
}: ChromeRulerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackHeight, setTrackHeight] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const updateHeight = () => {
      setTrackHeight(Math.floor(track.getBoundingClientRect().height));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  const marks = useMemo(() => {
    if (trackHeight <= 0 || stepPx <= 0) return [0];
    const usableHeight = Math.max(0, trackHeight - RULER_ORIGIN_OFFSET_PX);
    const count = Math.floor(usableHeight / stepPx) + 1;
    return Array.from({ length: count }, (_, index) => index * stepPx);
  }, [trackHeight, stepPx]);

  return (
    <div
      className={cn('plugin-sidebar-ruler flex min-h-0 flex-1 flex-col', className)}
      style={style}
      aria-hidden
    >
      <div ref={trackRef} className="plugin-sidebar-track">
        {marks.map((value) => (
          <span
            key={value}
            className={cn(
              'plugin-sidebar-mark',
              value === 0 && 'plugin-sidebar-mark--origin',
            )}
            style={{ top: `${RULER_ORIGIN_OFFSET_PX + value}px` }}
          >
            <span className="plugin-sidebar-mark-label">{value}</span>
            <span className="plugin-sidebar-mark-tick" aria-hidden />
          </span>
        ))}
      </div>
    </div>
  );
}
