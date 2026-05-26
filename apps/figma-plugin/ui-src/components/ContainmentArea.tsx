import type { CSSProperties } from 'react';
import { cn } from '../utils/cn';

type ContainmentAreaProps = {
  vertex?: 'header' | 'footer';
  className?: string;
  style?: CSSProperties;
};

/** Área texturizada (tile/hachura) alinhada ao chrome do plugin. */
export function ContainmentArea({
  vertex,
  className,
  style,
}: ContainmentAreaProps) {
  return (
    <div
      className={cn(
        'plugin-containment-area plugin-sidebar-hatch shrink-0 border-r border-stroke-soft-200',
        className,
      )}
      style={{
        width: 'var(--plugin-sidebar-width)',
        ...style,
      }}
      aria-hidden
    >
      {vertex === 'header' ? (
        <span
          className="plugin-layout-vertex plugin-layout-vertex--header-tabs"
          aria-hidden
        />
      ) : null}
      {vertex === 'footer' ? (
        <span
          className="plugin-layout-vertex plugin-layout-vertex--footer-tl"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
