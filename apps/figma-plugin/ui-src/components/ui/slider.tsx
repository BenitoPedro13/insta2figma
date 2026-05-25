// AlignUI Slider v0.0.0

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '@/utils/cn';
import * as Tooltip from './tooltip';

const SLIDER_ROOT_NAME = 'SliderRoot';
const SLIDER_THUMB_NAME = 'SliderThumb';

export type SliderAccent = 'free' | 'pro';

type SliderRootProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
  accent?: SliderAccent;
};

const SliderRoot = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderRootProps
>(({ className, accent = 'free', children, ...rest }, forwardedRef) => {
  const rangeClass =
    accent === 'pro' ? 'bg-feature-base' : 'bg-static-black';

  return (
    <SliderPrimitive.Root
      ref={forwardedRef}
      className={cn(
        'relative flex h-10 w-full touch-none select-none items-center pt-6',
        className,
      )}
      data-accent={accent}
      {...rest}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg-soft-200">
        <SliderPrimitive.Range
          className={cn('absolute h-full rounded-full', rangeClass)}
        />
      </SliderPrimitive.Track>
      {children}
    </SliderPrimitive.Root>
  );
});
SliderRoot.displayName = SLIDER_ROOT_NAME;

type SliderThumbProps = React.ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb> & {
  accent?: SliderAccent;
  /** Shown in the tooltip above the thumb (AlignUI with-tooltip pattern). */
  tooltipLabel?: string;
  /** Keep tooltip open while dragging. */
  tooltipOpen?: boolean;
};

const SliderThumb = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Thumb>,
  SliderThumbProps
>(
  (
    {
      className,
      accent = 'free',
      tooltipLabel,
      tooltipOpen,
      ...rest
    },
    forwardedRef,
  ) => {
    const dotClass =
      accent === 'pro' ? 'bg-feature-base' : 'bg-static-black';

    const handle = (
      <span
        className={cn(
          'relative flex size-5 shrink-0 items-center justify-center rounded-full bg-static-white shadow-[0_2px_8px_rgba(14,18,27,0.18)] ring-2 ring-static-white',
        )}
      >
        <span
          className={cn('block size-2 rounded-full', dotClass)}
          aria-hidden
        />
      </span>
    );

    if (tooltipLabel == null) {
      return (
        <SliderPrimitive.Thumb
          ref={forwardedRef}
          className={cn(
            'block cursor-pointer outline-none focus:outline-none',
            className,
          )}
          {...rest}
        >
          {handle}
        </SliderPrimitive.Thumb>
      );
    }

    return (
      <SliderPrimitive.Thumb
        ref={forwardedRef}
        className={cn(
          'block cursor-pointer outline-none focus:outline-none',
          className,
        )}
        {...rest}
      >
        <Tooltip.Root open={tooltipOpen ? true : undefined}>
          <Tooltip.Trigger asChild>
            <span className="inline-flex flex-col items-center">{handle}</span>
          </Tooltip.Trigger>
          <Tooltip.Content side="top">{tooltipLabel}</Tooltip.Content>
        </Tooltip.Root>
      </SliderPrimitive.Thumb>
    );
  },
);
SliderThumb.displayName = SLIDER_THUMB_NAME;

function SliderTooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
      {children}
    </Tooltip.Provider>
  );
}

export {
  SliderRoot as Root,
  SliderThumb as Thumb,
  SliderTooltipProvider as TooltipProvider,
};
