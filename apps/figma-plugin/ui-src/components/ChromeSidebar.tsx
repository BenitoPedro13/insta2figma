import type { CSSProperties } from 'react';
import { cn } from '../utils/cn';
import { ChromeRuler, PLUGIN_SCALE_MARKS } from './ChromeRuler';

type ChromeSidebarProps = {
  topHeight?: string;
  bottomHeight?: string;
  scaleMarks?: number[];
  footerVertex?: 'br' | 'tl';
  className?: string;
};

export function ChromeSidebar({
  topHeight = 'var(--plugin-header-height)',
  bottomHeight = 'var(--plugin-footer-height)',
  scaleMarks = PLUGIN_SCALE_MARKS,
  footerVertex = 'br',
  className,
}: ChromeSidebarProps) {
  return (
    <aside
      className={cn('plugin-sidebar', className)}
      style={
        {
          '--chrome-sidebar-top-height': topHeight,
          '--chrome-sidebar-bottom-height': bottomHeight,
        } as CSSProperties
      }
      aria-hidden
    >
      <div className="plugin-sidebar-hatch plugin-sidebar-hatch--top">
        <span
          className="plugin-layout-vertex plugin-layout-vertex--header-tabs"
          aria-hidden
        />
      </div>
      <ChromeRuler marks={scaleMarks} />
      <div className="plugin-sidebar-hatch plugin-sidebar-hatch--bottom">
        <span
          className={cn(
            'plugin-layout-vertex',
            footerVertex === 'tl'
              ? 'plugin-layout-vertex--footer-tl'
              : 'plugin-layout-vertex--footer',
          )}
          aria-hidden
        />
      </div>
    </aside>
  );
}
