import { useCallback, useEffect, useRef, useState } from 'react';
import { RiMenu4Line } from '@remixicon/react';
import { AccountBadge } from './AccountBadge';
import { PluginMenuDropdown } from './PluginMenuDropdown';
import logoInstagramFill from '../assets/logo-instagram-fill.png';

type PanelHeaderProps = {
  planTier: 'free' | 'pro';
  sessionError?: string;
  onUpgrade: () => void;
  onManage: () => void;
  onOpenExternal: (url: string) => void;
};

/** Left panel header — Figma node 84:2761 (466×100). */
export function PanelHeader({
  planTier,
  sessionError,
  onUpgrade,
  onManage,
  onOpenExternal,
}: PanelHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMenu, menuOpen]);

  return (
    <header className="panel-header flex h-[100px] shrink-0 flex-col justify-center border-b border-stroke-soft-200 bg-bg-white-0 px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={logoInstagramFill}
            alt=""
            width={31}
            height={31}
            className="size-[31px] shrink-0 rounded-md object-cover"
          />
          <span className="text-title-h3 tracking-[-1.5px] text-text-strong-950">
            Insta2Figma
          </span>
          <AccountBadge planTier={planTier} />
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            className="flex size-[24px] cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-sub-600 transition hover:bg-bg-weak-50 hover:text-text-strong-950"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <RiMenu4Line size={24} aria-hidden />
          </button>
          {menuOpen ? (
            <div className="plugin-menu-dropdown-wrap absolute right-0 top-[calc(100%+6px)] z-50">
              <PluginMenuDropdown
                planTier={planTier}
                onUpgrade={onUpgrade}
                onManage={onManage}
                onOpenExternal={onOpenExternal}
                onClose={closeMenu}
              />
            </div>
          ) : null}
        </div>
      </div>
      {sessionError ? (
        <p className="mt-2 truncate text-paragraph-xs text-error-base">{sessionError}</p>
      ) : null}
    </header>
  );
}
