import { useCallback, useEffect, useRef } from 'react';
import * as Tooltip from './ui/tooltip';
import { cn } from '../utils/cn';
import { useHost } from '../HostContext';

const MIN_W = 830;
const MIN_H = 420;
const MAX_W = 1200;
const MAX_H = 900;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function ResizeGripIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('plugin-resize-handle-icon', className)}
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <line
        x1="4.5"
        y1="12"
        x2="12"
        y2="4.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <line
        x1="7.5"
        y1="12"
        x2="12"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PluginResizeHandle() {
  const host = useHost();
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postResize = useCallback((width: number, height: number) => {
    host.send({ type: 'ui-resize', width, height, persist: false });
  }, [host]);

  const postResizePersist = useCallback((width: number, height: number) => {
    host.send({ type: 'ui-resize', width, height, persist: true });
  }, [host]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current.active) return;
      const w = clamp(
        drag.current.startW + (e.clientX - drag.current.startX),
        MIN_W,
        MAX_W,
      );
      const h = clamp(
        drag.current.startH + (e.clientY - drag.current.startY),
        MIN_H,
        MAX_H,
      );
      postResize(w, h);
    };

    const onUp = () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      const w = clamp(window.innerWidth, MIN_W, MAX_W);
      const h = clamp(window.innerHeight, MIN_H, MAX_H);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      postResizePersist(w, h);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [postResize, postResizePersist]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: window.innerWidth,
      startH: window.innerHeight,
    };
  };

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            className="plugin-resize-handle"
            role="separator"
            aria-orientation="both"
            aria-label="Drag to redimension"
            onMouseDown={onMouseDown}
          >
            <ResizeGripIcon />
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side="top" align="end">
          Drag to redimension
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
