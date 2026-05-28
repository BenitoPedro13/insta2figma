import type { CSSProperties } from 'react';
import { cn } from '../utils/cn';
import { ChromeRuler } from './ChromeRuler';

type ChromeSidebarProps = {
  topHeight?: string;
  bottomHeight?: string;
  footerVertex?: 'br' | 'tl';
  className?: string;
};

export function ChromeSidebar({
  topHeight = 'var(--plugin-header-height)',
  bottomHeight = 'var(--plugin-footer-height)',
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
      <ChromeRuler />
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
