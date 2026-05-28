import { useCallback, useEffect, useRef } from 'react';
import { RiExpandDiagonalLine } from '@remixicon/react';

const MIN_W = 830;
const MIN_H = 420;
const MAX_W = 1200;
const MAX_H = 900;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function PluginResizeHandle() {
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postResize = useCallback((width: number, height: number) => {
    parent.postMessage(
      { pluginMessage: { type: 'ui-resize', width, height, persist: false } },
      '*',
    );
  }, []);

  const postResizePersist = useCallback((width: number, height: number) => {
    parent.postMessage(
      { pluginMessage: { type: 'ui-resize', width, height, persist: true } },
      '*',
    );
  }, []);

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
    <div
      className="plugin-resize-handle"
      role="separator"
      aria-orientation="both"
      aria-label="Resize plugin window"
      onMouseDown={onMouseDown}
    >
      <RiExpandDiagonalLine className="plugin-resize-handle-icon" aria-hidden />
    </div>
  );
}
