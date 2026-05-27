import { useState, type ReactNode } from 'react';
import {
  RiCloseLine,
  RiCustomerService2Line,
  RiImageAddLine,
  RiInfinityLine,
  RiLayoutGridLine,
  RiVipCrownLine,
} from '@remixicon/react';
import pppFounderPhoto from '../assets/ppp-founder.png';
import { ChromeRuler } from './ChromeRuler';
import { ContainmentArea } from './ContainmentArea';
import * as FancyButton from './ui/fancy-button';
import * as SegmentedControl from './ui/segmented-control';
import { cn } from '../utils/cn';

type ProUpgradeOverlayProps = {
  open: boolean;
  onClose: () => void;
  onUpgrade: (cycle?: 'monthly' | 'yearly') => void;
  onUpgradeMax?: (cycle?: 'monthly' | 'yearly') => void;
  onOpenExternal?: (url: string) => void;
};

type FeatureRow = {
  id: string;
  label: string;
  icon: typeof RiImageAddLine;
  pro: string;
  max: string;
};

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: 'images',
    label: 'Images /month',
    icon: RiImageAddLine,
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
    label: 'Support Response',
    icon: RiCustomerService2Line,
    pro: '24h (Email and Discord)',
    max: '4h (Email and Discord)',
  },
];

const PPP_EMAIL = 'mailto:marcus@mainnet.design';

const PLAN_PRICING = {
  yearly: { pro: 3, max: 30 },
  monthly: { pro: 5, max: 50 },
} as const;

/** Desconto do yearly vs preço monthly equivalente: Pro (5→3) e Max (50→30) = 40%. */
const YEARLY_DISCOUNT_PERCENT = Math.round(
  ((PLAN_PRICING.monthly.pro - PLAN_PRICING.yearly.pro) /
    PLAN_PRICING.monthly.pro) *
    100,
);

function AnimatedPlanPrice({ amount }: { amount: number }) {
  return (
    <span
      key={amount}
      className="pro-upgrade-price-amount text-[36px] font-medium leading-none tracking-[-0.54px] text-text-strong-950"
    >
      ${amount}
    </span>
  );
}

function PlanTableCell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'pro-upgrade-cell flex min-h-[56px] items-center border-b border-r border-stroke-soft-200 p-4 last:border-r-0',
        className,
      )}
    >
      {children}
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
  const [billingPeriod, setBillingPeriod] = useState<'yearly' | 'monthly'>(
    'yearly',
  );
  const prices = PLAN_PRICING[billingPeriod];

  if (!open) return null;

  const handleUpgradePro = () => {
    onClose();
    onUpgrade(billingPeriod);
  };

  const handleUpgradeMax = () => {
    onClose();
    (onUpgradeMax ?? onUpgrade)(billingPeriod);
  };

  const openPppEmail = () => {
    if (onOpenExternal) {
      onOpenExternal(PPP_EMAIL);
      return;
    }
    parent.postMessage(
      { pluginMessage: { type: 'open-external', url: PPP_EMAIL } },
      '*',
    );
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

      <div className="pro-upgrade-overlay-panel relative w-full max-w-[872px] overflow-hidden border border-stroke-soft-200 bg-bg-white-0">
        <ContainmentArea vertex="header" className="pro-upgrade-grid-header-hatch" />

        <div className="pro-upgrade-close-bar flex items-center px-4">
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-lg border-0 bg-bg-weak-50 px-1.5 py-1 text-label-sm font-medium text-text-sub-600 transition hover:bg-bg-soft-200 hover:text-text-strong-950"
            onClick={onClose}
          >
            <RiCloseLine className="size-5 shrink-0" aria-hidden />
            Close
          </button>
        </div>

        <ChromeRuler className="pro-upgrade-grid-ruler" />

        <div className="pro-upgrade-plan-header-row grid grid-cols-3 border-b border-stroke-soft-200">
          <div className="pro-upgrade-plan-col pro-upgrade-plan-col--chooser items-center justify-center border-r border-stroke-soft-200 px-4 py-5">
            <p
              id="pro-upgrade-title"
              className="m-0 text-center text-label-lg font-medium tracking-[-0.27px] text-text-strong-950"
            >
              Choose your plan
            </p>
            <SegmentedControl.Root
              value={billingPeriod}
              onValueChange={(value) =>
                setBillingPeriod(value as 'yearly' | 'monthly')
              }
            >
              <SegmentedControl.List className="w-[168px]">
                <SegmentedControl.Trigger value="yearly">
                  Yearly
                </SegmentedControl.Trigger>
                <SegmentedControl.Trigger value="monthly">
                  Monthly
                </SegmentedControl.Trigger>
              </SegmentedControl.List>
            </SegmentedControl.Root>
            <div className="pro-upgrade-discount-slot" aria-live="polite">
              <span
                className={cn(
                  'pro-upgrade-discount-badge rounded-md bg-success-lighter px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-success-dark',
                  billingPeriod === 'yearly' && 'pro-upgrade-discount-badge--visible',
                )}
                aria-hidden={billingPeriod !== 'yearly'}
              >
                {YEARLY_DISCOUNT_PERCENT}% off
              </span>
            </div>
          </div>

          <div className="pro-upgrade-plan-col gap-1.5 border-r border-stroke-soft-200 px-4 py-5">
            <RiVipCrownLine
              className="size-6 shrink-0 text-feature-base"
              aria-hidden
            />
            <p className="m-0 text-title-h5 font-medium tracking-[-0.27px] text-text-strong-950">
              Pro
            </p>
            <div className="pro-upgrade-price-row flex items-end gap-1 overflow-hidden">
              <AnimatedPlanPrice amount={prices.pro} />
              <span className="pb-1 text-paragraph-xs text-text-sub-600">
                /month
              </span>
            </div>
            <FancyButton.Root
              type="button"
              variant="neutral"
              size="xsmall"
              className="pro-upgrade-plan-action"
              onClick={handleUpgradePro}
            >
              Get Started
            </FancyButton.Root>
          </div>

          <div className="pro-upgrade-plan-col gap-1.5 px-4 py-5">
            <RiInfinityLine
              className="size-6 shrink-0 text-orange-500"
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="m-0 text-title-h5 font-medium tracking-[-0.27px] text-orange-500">
                Max
              </p>
              <span className="rounded-md bg-warning-lighter px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning-dark">
                Most Popular
              </span>
            </div>
            <div className="pro-upgrade-price-row flex items-end gap-1 overflow-hidden">
              <AnimatedPlanPrice amount={prices.max} />
              <span className="pb-1 text-paragraph-xs text-text-sub-600">
                /month
              </span>
            </div>
            <FancyButton.Root
              type="button"
              variant="neutral"
              size="xsmall"
              className="pro-upgrade-plan-action pro-upgrade-max-btn"
              onClick={handleUpgradeMax}
            >
              Get Started
            </FancyButton.Root>
          </div>
        </div>

        <div className="pro-upgrade-table min-h-0 overflow-y-auto">
          {FEATURE_ROWS.map((row) => {
            const Icon = row.icon;
            return (
              <div key={row.id} className="grid grid-cols-3">
                <PlanTableCell className="gap-2">
                  <Icon
                    className="size-6 shrink-0 text-text-sub-600"
                    aria-hidden
                  />
                  <span className="text-label-sm font-medium text-text-strong-950">
                    {row.label}
                  </span>
                </PlanTableCell>
                <PlanTableCell className="justify-center">
                  <span className="text-paragraph-sm text-text-strong-950">
                    {row.pro}
                  </span>
                </PlanTableCell>
                <PlanTableCell className="justify-center border-r-0">
                  <span className="text-paragraph-sm text-text-strong-950">
                    {row.max}
                  </span>
                </PlanTableCell>
              </div>
            );
          })}
        </div>

        <ContainmentArea
          vertex="footer"
          className="pro-upgrade-grid-footer-hatch"
        />

        <div className="pro-upgrade-ppp-footer flex items-center gap-2 p-4">
          <img
            src={pppFounderPhoto}
            alt=""
            className="pro-upgrade-ppp-photo size-11 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <p className="m-0 text-label-sm font-medium text-text-strong-950">
              We support PPP{' '}
              <span className="font-normal text-text-strong-950">
                (Up to 60% OFF)
              </span>
            </p>
            <p className="m-0 mt-1 text-paragraph-xs leading-relaxed text-text-strong-950">
              If you are student or developing country resident, send me your
              license or ID to{' '}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-paragraph-xs text-text-strong-950 underline underline-offset-2 hover:text-feature-base"
                onClick={openPppEmail}
              >
                marcus@mainnet.design
              </button>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
