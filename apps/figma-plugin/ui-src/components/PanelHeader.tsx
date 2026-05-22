import { RiMenu4Line } from '@remixicon/react';
import { AccountBadge } from './AccountBadge';
import logoInstagramFill from '../assets/logo-instagram-fill.png';

type PanelHeaderProps = {
  planTier: 'free' | 'pro';
  sessionError?: string;
};

/** Left panel header — Figma node 84:2761 (466×100). */
export function PanelHeader({ planTier, sessionError }: PanelHeaderProps) {
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
        <button
          type="button"
          className="flex size-[24px] shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-text-sub-600 transition hover:bg-bg-weak-50 hover:text-text-strong-950"
          aria-label="Menu"
        >
          <RiMenu4Line size={20} aria-hidden />
        </button>
      </div>
      {sessionError ? (
        <p className="mt-2 truncate text-paragraph-xs text-error-base">{sessionError}</p>
      ) : null}
    </header>
  );
}
