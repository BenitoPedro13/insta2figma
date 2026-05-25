import { RiCheckLine, RiCloseLine } from '@remixicon/react';
import * as Button from './ui/button';

const PRO_BENEFITS = [
  'Infinite pagination',
  '1000 images per month',
  'Special support in less than 24h',
] as const;

type ProUpgradeOverlayProps = {
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
};

export function ProUpgradeOverlay({
  open,
  onClose,
  onUpgrade,
}: ProUpgradeOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="pro-upgrade-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upgrade-title"
    >
      <button
        type="button"
        className="pro-upgrade-overlay-backdrop absolute inset-0 border-0 bg-static-black/40 p-0"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="pro-upgrade-panel relative w-full max-w-[320px] rounded-2xl border border-stroke-soft-200 bg-bg-white-0 p-5 shadow-regular-md">
        <button
          type="button"
          className="absolute right-3 top-3 flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-text-sub-600 transition hover:bg-bg-weak-50"
          aria-label="Close"
          onClick={onClose}
        >
          <RiCloseLine className="size-5" aria-hidden />
        </button>

        <p className="pro-upgrade-badge m-0 mb-2 inline-block rounded-full bg-feature-lighter px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-feature-base">
          Pro
        </p>
        <h2
          id="pro-upgrade-title"
          className="m-0 pr-8 text-title-h6 font-semibold text-text-strong-950"
        >
          Unlock the full profile preview
        </h2>
        <p className="mt-2 mb-4 text-paragraph-sm text-text-sub-600">
          Free plan preview stops at page 3. Upgrade to browse the entire feed.
        </p>

        <ul className="pro-upgrade-benefits m-0 flex list-none flex-col gap-2.5 p-0">
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-paragraph-sm text-text-strong-950">
              <RiCheckLine className="mt-0.5 size-4 shrink-0 text-success-base" aria-hidden />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-col gap-2">
          <Button.Root
            type="button"
            variant="primary"
            mode="filled"
            size="medium"
            className="w-full"
            onClick={onUpgrade}
          >
            Upgrade to Pro
          </Button.Root>
          <Button.Root
            type="button"
            variant="neutral"
            mode="ghost"
            size="medium"
            className="w-full"
            onClick={onClose}
          >
            Not now
          </Button.Root>
        </div>
      </div>
    </div>
  );
}
