import {
  RiArrowRightUpLine,
  RiCheckLine,
  RiCloseLine,
  RiCustomerService2Line,
  RiImageLine,
  RiInformationFill,
  RiLayoutGridLine,
  RiMoneyDollarCircleLine,
  RiRocketLine,
  RiVipCrownLine,
} from '@remixicon/react';
import pppFounderPhoto from '../assets/ppp-founder.png';
import { SUPPORT_URL } from '../lib/pluginLinks';
import { cn } from '../utils/cn';

type ProUpgradeOverlayProps = {
  open: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  onUpgradeMax?: () => void;
  onOpenExternal?: (url: string) => void;
};

type FeatureRow = {
  id: string;
  label: string;
  icon: typeof RiImageLine;
  pro: string;
  max: string;
};

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: 'images',
    label: 'Images / month',
    icon: RiImageLine,
    pro: '10,000',
    max: '100,000',
  },
  {
    id: 'pagination',
    label: 'Pagination',
    icon: RiLayoutGridLine,
    pro: 'Up to 12',
    max: 'Infinite',
  },
  {
    id: 'support',
    label: 'Support',
    icon: RiCustomerService2Line,
    pro: 'Email (48h)',
    max: 'Private Discord + email (4h)',
  },
];

function PlanBuyButton({
  label,
  featured,
  onClick,
}: {
  label: string;
  featured?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'pro-upgrade-buy-btn flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-0 px-3 py-2.5 text-label-sm font-medium transition',
        featured
          ? 'bg-orange-500 text-static-white hover:bg-orange-600'
          : 'bg-bg-weak-50 text-text-strong-950 hover:bg-bg-soft-200',
      )}
      onClick={onClick}
    >
      {label}
      <RiArrowRightUpLine className="size-4 shrink-0" aria-hidden />
    </button>
  );
}

function FeatureValue({ value, featured }: { value: string; featured?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <RiCheckLine
        className={cn('mt-0.5 size-4 shrink-0', featured ? 'text-orange-400' : 'text-orange-500')}
        aria-hidden
      />
      <span
        className={cn(
          'text-paragraph-sm leading-snug',
          featured ? 'text-text-white-0' : 'text-text-strong-950',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ProUpgradeOverlay({
  open,
  onClose,
  onUpgrade,
  onUpgradeMax,
  onOpenExternal,
}: ProUpgradeOverlayProps) {
  if (!open) return null;

  const handleUpgradePro = () => {
    onClose();
    onUpgrade();
  };

  const handleUpgradeMax = () => {
    onClose();
    (onUpgradeMax ?? onUpgrade)();
  };

  const openSupport = () => {
    if (onOpenExternal) {
      onOpenExternal(SUPPORT_URL);
      return;
    }
    parent.postMessage({ pluginMessage: { type: 'open-external', url: SUPPORT_URL } }, '*');
  };

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

      <div className="pro-upgrade-overlay-panel relative flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[20px] border border-stroke-soft-200 bg-bg-white-0 shadow-regular-md">
        <button
          type="button"
          className="absolute right-3 top-3 z-20 flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-bg-white-0/80 text-text-sub-600 transition hover:bg-bg-weak-50"
          aria-label="Close"
          onClick={onClose}
        >
          <RiCloseLine className="size-5" aria-hidden />
        </button>

        <div className="overflow-y-auto p-5 pt-6">
          <div className="pro-upgrade-table grid grid-cols-[minmax(140px,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] overflow-hidden rounded-2xl border border-stroke-soft-200">
            {/* Labels column */}
            <div className="pro-upgrade-labels flex flex-col border-r border-stroke-soft-200 bg-bg-white-0">
              <div className="pro-upgrade-labels-head border-b border-stroke-soft-200 px-4 py-5">
                <p
                  id="pro-upgrade-title"
                  className="m-0 text-label-md font-semibold text-orange-500"
                >
                  Get the full package!
                </p>
                <p className="mt-2 mb-0 text-paragraph-xs leading-relaxed text-text-sub-600">
                  You reached your free limit. Pick a plan to keep importing.
                </p>
              </div>

              <div className="pro-upgrade-labels-price flex min-h-[88px] items-center border-b border-stroke-soft-200 px-4 py-3">
                <div className="flex items-center gap-2">
                  <RiMoneyDollarCircleLine className="size-5 shrink-0 text-orange-500" aria-hidden />
                  <span className="text-label-sm font-medium text-text-strong-950">Price</span>
                  <RiInformationFill
                    className="size-4 shrink-0 text-text-disabled-300"
                    aria-hidden
                  />
                </div>
              </div>

              {FEATURE_ROWS.map((row) => {
                const Icon = row.icon;
                return (
                  <div
                    key={row.id}
                    className="pro-upgrade-label-row flex min-h-[72px] flex-1 items-center border-b border-stroke-soft-200 px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-5 shrink-0 text-orange-500" aria-hidden />
                      <span className="text-label-sm font-medium text-text-strong-950">
                        {row.label}
                      </span>
                      <RiInformationFill
                        className="size-4 shrink-0 text-text-disabled-300"
                        aria-hidden
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pro column */}
            <div className="pro-upgrade-plan flex flex-col border-r border-stroke-soft-200 bg-bg-white-0">
              <div className="pro-upgrade-plan-head border-b border-stroke-soft-200 px-4 py-5 text-center">
                <RiVipCrownLine className="mx-auto size-6 text-orange-500" aria-hidden />
                <p className="m-0 mt-2 text-label-md font-semibold text-text-strong-950">Pro</p>
                <p className="m-0 mt-1 text-paragraph-xs text-text-sub-600">
                  For creators importing regularly
                </p>
                <p className="pro-upgrade-price m-0 mt-4 text-[32px] font-semibold leading-none text-text-strong-950">
                  $3
                </p>
                <p className="m-0 mt-1 text-paragraph-xs text-text-soft-400">/ month</p>
                <div className="mt-4">
                  <PlanBuyButton label="Subscribe" onClick={handleUpgradePro} />
                </div>
              </div>

              <div className="flex min-h-[88px] items-center border-b border-stroke-soft-200 px-4 py-3">
                <FeatureValue value="$3 / month" />
              </div>

              {FEATURE_ROWS.map((row) => (
                <div
                  key={row.id}
                  className="flex min-h-[72px] flex-1 items-center border-b border-stroke-soft-200 px-4 py-3 last:border-b-0"
                >
                  <FeatureValue value={row.pro} />
                </div>
              ))}
            </div>

            {/* Max column */}
            <div className="pro-upgrade-plan pro-upgrade-plan--featured relative flex flex-col bg-static-black">
              <span className="pro-upgrade-popular-badge absolute right-3 top-3 rounded-md bg-orange-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-static-white">
                Most Popular
              </span>

              <div className="pro-upgrade-plan-head border-b border-white/10 px-4 py-5 text-center">
                <RiRocketLine className="mx-auto size-6 text-orange-400" aria-hidden />
                <p className="m-0 mt-2 text-label-md font-semibold text-text-white-0">Max</p>
                <p className="m-0 mt-1 text-paragraph-xs text-text-soft-400">
                  For teams and power users
                </p>
                <p className="pro-upgrade-price m-0 mt-4 text-[32px] font-semibold leading-none text-text-white-0">
                  $30
                </p>
                <p className="m-0 mt-1 text-paragraph-xs text-text-soft-400">/ month</p>
                <div className="mt-4">
                  <PlanBuyButton label="Subscribe" featured onClick={handleUpgradeMax} />
                </div>
              </div>

              <div className="flex min-h-[88px] items-center border-b border-white/10 px-4 py-3">
                <FeatureValue value="$30 / month" featured />
              </div>

              {FEATURE_ROWS.map((row) => (
                <div
                  key={row.id}
                  className="flex min-h-[72px] flex-1 items-center border-b border-white/10 px-4 py-3 last:border-b-0"
                >
                  <FeatureValue value={row.max} featured />
                </div>
              ))}
            </div>
          </div>

          <div className="pro-upgrade-ppp mt-4 flex items-start gap-3 rounded-2xl bg-bg-weak-50 p-3">
            <img
              src={pppFounderPhoto}
              alt=""
              className="pro-upgrade-ppp-photo size-12 shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0">
              <p className="m-0 text-label-sm font-semibold text-text-strong-950">
                We value PPP and offer discounts.
              </p>
              <p className="m-0 mt-1 text-paragraph-xs leading-relaxed text-text-sub-600">
                Verify your eligibility with a student ID, license, or similar proof by contacting
                us via{' '}
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-paragraph-xs font-medium text-orange-500 hover:underline"
                  onClick={openSupport}
                >
                  Support
                </button>
                .
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-label-sm text-text-sub-600 hover:text-text-strong-950"
              onClick={onClose}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
