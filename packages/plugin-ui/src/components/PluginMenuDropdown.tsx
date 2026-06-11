import { useCallback } from 'react';
import {
  RiArrowRightUpLine,
  RiFeedbackLine,
  RiLogoutBoxRLine,
  RiMailLine,
  RiSettings3Line,
} from '@remixicon/react';
import * as FancyButton from './ui/fancy-button';
import { ThemeSegmentedControl } from './ThemeSegmentedControl';
import {
  MAINNET_URL,
  PLUGIN_VERSION,
  SUPPORT_EMAIL,
  TERMS_URL,
} from '../lib/pluginLinks';
import { cn } from '../utils/cn';
import { isPaidPlan, type PlanTier } from '../lib/planTier';

type PluginMenuDropdownProps = {
  planTier: PlanTier;
  onUpgrade: () => void;
  onManage: () => void;
  onSignOut: () => void;
  onOpenExternal: (url: string) => void;
  onFeedback: () => void;
  onClose: () => void;
  className?: string;
};

type MenuItemProps = {
  icon: typeof RiFeedbackLine;
  label: string;
  onClick: () => void;
  showExternal?: boolean;
};

function MenuDivider() {
  return <div className="plugin-menu-divider" role="separator" />;
}

function MenuItem({ icon: Icon, label, onClick, showExternal }: MenuItemProps) {
  return (
    <button
      type="button"
      className="plugin-menu-item flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-bg-white-0 p-2 text-left transition hover:bg-bg-weak-50"
      onClick={onClick}
    >
      <Icon className="size-5 shrink-0 text-text-sub-600" aria-hidden />
      <span className="flex-1 text-label-sm text-text-sub-600">{label}</span>
      {showExternal ? (
        <RiArrowRightUpLine className="size-4 shrink-0 text-text-sub-600" aria-hidden />
      ) : null}
    </button>
  );
}

export function PluginMenuDropdown({
  planTier,
  onUpgrade,
  onManage,
  onSignOut,
  onOpenExternal,
  onFeedback,
  onClose,
  className,
}: PluginMenuDropdownProps) {
  const openLink = useCallback(
    (url: string) => {
      onOpenExternal(url);
      onClose();
    },
    [onClose, onOpenExternal],
  );

  const handleUpgrade = useCallback(() => {
    onUpgrade();
    onClose();
  }, [onClose, onUpgrade]);

  const handleManage = useCallback(() => {
    onManage();
    onClose();
  }, [onClose, onManage]);

  return (
    <div
      className={cn('plugin-menu-dropdown flex flex-col gap-1 p-1.5', className)}
      role="menu"
      aria-label="Plugin menu"
    >
      {!isPaidPlan(planTier) ? (
        <FancyButton.Root
          type="button"
          variant="neutral"
          size="small"
          className="pro-upgrade-max-btn w-full"
          onClick={handleUpgrade}
        >
          Upgrade plan
        </FancyButton.Root>
      ) : (
        <MenuItem
          icon={RiSettings3Line}
          label="My Subscription"
          showExternal
          onClick={handleManage}
        />
      )}

      <MenuDivider />

      <MenuItem
        icon={RiFeedbackLine}
        label="Send feedback"
        onClick={() => { onFeedback(); onClose(); }}
      />

      <MenuDivider />

      <MenuItem
        icon={RiLogoutBoxRLine}
        label="Sign out"
        onClick={() => { onSignOut(); onClose(); }}
      />

      <MenuDivider />

      <ThemeSegmentedControl />

      <FancyButton.Root
        type="button"
        variant="primary"
        size="small"
        className="plugin-menu-email-support w-full"
        onClick={() => openLink(SUPPORT_EMAIL)}
      >
        <FancyButton.Icon as={RiMailLine} />
        Email support
      </FancyButton.Root>

      <div className="plugin-menu-footer px-2 py-2">
        <p className="m-0 text-paragraph-xs text-text-soft-400">
          v.{PLUGIN_VERSION} ·{' '}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline-offset-2 hover:underline"
            onClick={() => openLink(TERMS_URL)}
          >
            Terms &amp; Conditions
          </button>{' '}
          ·{' '}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline-offset-2 hover:underline"
            onClick={() => openLink(MAINNET_URL)}
          >
            Made by Mainnet™ in 🇧🇷
          </button>
        </p>
      </div>
    </div>
  );
}
