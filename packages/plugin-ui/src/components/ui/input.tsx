// AlignUI Input v0.0.0

import * as React from 'react';
import { RiAddLine, RiSubtractLine } from '@remixicon/react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/utils/cn';

import type { PolymorphicComponentProps } from '@/utils/polymorphic';
import { recursiveCloneChildren } from '@/utils/recursive-clone-children';
import { tv, type VariantProps } from '@/utils/tv';

const INPUT_ROOT_NAME = 'InputRoot';
const INPUT_WRAPPER_NAME = 'InputWrapper';
const INPUT_EL_NAME = 'InputEl';
const INPUT_ICON_NAME = 'InputIcon';
const INPUT_AFFIX_NAME = 'InputAffixButton';
const INPUT_INLINE_AFFIX_NAME = 'InputInlineAffixButton';

export const inputVariants = tv({
  slots: {
    root: [
      'group relative flex w-full overflow-hidden bg-bg-white-0 text-text-strong-950 shadow-regular-xs',
      'transition duration-200 ease-out',
      'divide-x divide-stroke-soft-200',
      'before:absolute before:inset-0 before:ring-1 before:ring-inset before:ring-stroke-soft-200',
      'before:pointer-events-none before:rounded-[inherit]',
      'before:transition before:duration-200 before:ease-out',
      'hover:shadow-none',
      'has-[input:focus]:shadow-button-important-focus has-[input:focus]:before:ring-stroke-strong-950',
      'has-[input:disabled]:shadow-none has-[input:disabled]:before:ring-transparent',
    ],
    wrapper: [
      'group/input-wrapper flex w-full cursor-text items-center bg-bg-white-0',
      'transition duration-200 ease-out',
      'hover:[&:not(&:has(input:focus))]:bg-bg-weak-50',
      'has-[input:disabled]:pointer-events-none has-[input:disabled]:bg-bg-weak-50',
    ],
    input: [
      'w-full bg-transparent bg-none text-paragraph-sm text-text-strong-950 outline-none',
      'transition duration-200 ease-out',
      'placeholder:select-none placeholder:text-text-soft-400 placeholder:transition placeholder:duration-200 placeholder:ease-out',
      'group-hover/input-wrapper:placeholder:text-text-sub-600',
      'focus:outline-none',
      'group-has-[input:focus]:placeholder:text-text-sub-600',
      'disabled:text-text-disabled-300 disabled:placeholder:text-text-disabled-300',
    ],
    icon: [
      'flex size-5 shrink-0 select-none items-center justify-center',
      'transition duration-200 ease-out',
      'group-has-[:placeholder-shown]:text-text-soft-400',
      'text-text-sub-600',
      'group-has-[:placeholder-shown]:group-hover/input-wrapper:text-text-sub-600',
      'group-has-[:placeholder-shown]:group-has-[input:focus]/input-wrapper:text-text-sub-600',
      'group-has-[input:disabled]/input-wrapper:text-text-disabled-300',
    ],
    affix: [
      'shrink-0 bg-bg-white-0 text-paragraph-sm text-text-sub-600',
      'flex items-center justify-center truncate',
      'transition duration-200 ease-out',
      'group-has-[:placeholder-shown]:text-text-soft-400',
      'group-has-[:placeholder-shown]:group-has-[input:focus]:text-text-sub-600',
    ],
    inlineAffix: [
      'text-paragraph-sm text-text-sub-600',
      'group-has-[:placeholder-shown]:text-text-soft-400',
      'group-has-[:placeholder-shown]:group-has-[input:focus]:text-text-sub-600',
    ],
  },
  variants: {
    size: {
      medium: {
        root: 'rounded-10',
        wrapper: 'gap-2 px-3',
        input: 'h-10',
      },
      small: {
        root: 'rounded-lg',
        wrapper: 'gap-2 px-2.5',
        input: 'h-9',
      },
      xsmall: {
        root: 'rounded-lg',
        wrapper: 'gap-1.5 px-2',
        input: 'h-8',
      },
    },
    hasError: {
      true: {
        root: [
          'before:ring-error-base',
          'hover:before:ring-error-base hover:[&:not(&:has(input:focus)):has(>:only-child)]:before:ring-error-base',
          'has-[input:focus]:shadow-button-error-focus has-[input:focus]:before:ring-error-base',
        ],
      },
      false: {
        root: [
          'hover:[&:not(:has(input:focus)):has(>:only-child)]:before:ring-transparent',
        ],
      },
    },
  },
  compoundVariants: [
    {
      size: 'medium',
      class: { affix: 'px-3' },
    },
    {
      size: ['small', 'xsmall'],
      class: { affix: 'px-2.5' },
    },
  ],
  defaultVariants: {
    size: 'medium',
  },
});

type InputSharedProps = VariantProps<typeof inputVariants>;

function InputRoot({
  className,
  children,
  size,
  hasError,
  asChild,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> &
  InputSharedProps & {
    asChild?: boolean;
  }) {
  const uniqueId = React.useId();
  const Component = asChild ? Slot : 'div';

  const { root } = inputVariants({ size, hasError });

  const sharedProps: InputSharedProps = { size, hasError };

  const extendedChildren = recursiveCloneChildren(
    children as React.ReactElement[],
    sharedProps,
    [
      INPUT_WRAPPER_NAME,
      INPUT_EL_NAME,
      INPUT_ICON_NAME,
      INPUT_AFFIX_NAME,
      INPUT_INLINE_AFFIX_NAME,
    ],
    uniqueId,
    asChild,
  );

  return (
    <Component className={root({ class: className })} {...rest}>
      {extendedChildren}
    </Component>
  );
}
InputRoot.displayName = INPUT_ROOT_NAME;

function InputWrapper({
  className,
  children,
  size,
  hasError,
  asChild,
  ...rest
}: React.HTMLAttributes<HTMLLabelElement> &
  InputSharedProps & {
    asChild?: boolean;
  }) {
  const Component = asChild ? Slot : 'label';

  const { wrapper } = inputVariants({ size, hasError });

  return (
    <Component className={wrapper({ class: className })} {...rest}>
      {children}
    </Component>
  );
}
InputWrapper.displayName = INPUT_WRAPPER_NAME;

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> &
    InputSharedProps & {
      asChild?: boolean;
    }
>(({ className, type = 'text', size, hasError, asChild, ...rest }, forwardedRef) => {
  const Component = asChild ? Slot : 'input';

  const { input } = inputVariants({ size, hasError });

  return (
    <Component
      type={type}
      className={input({ class: className })}
      ref={forwardedRef}
      {...rest}
    />
  );
});
Input.displayName = INPUT_EL_NAME;

function InputIcon<T extends React.ElementType = 'div'>({
  size,
  hasError,
  as,
  className,
  ...rest
}: PolymorphicComponentProps<T, InputSharedProps>) {
  const Component = as || 'div';
  const { icon } = inputVariants({ size, hasError });

  return <Component className={icon({ class: className })} {...rest} />;
}
InputIcon.displayName = INPUT_ICON_NAME;

function InputAffix({
  className,
  children,
  size,
  hasError,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & InputSharedProps) {
  const { affix } = inputVariants({ size, hasError });

  return (
    <div className={affix({ class: className })} {...rest}>
      {children}
    </div>
  );
}
InputAffix.displayName = INPUT_AFFIX_NAME;

function InputInlineAffix({
  className,
  children,
  size,
  hasError,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & InputSharedProps) {
  const { inlineAffix } = inputVariants({ size, hasError });

  return (
    <span className={inlineAffix({ class: className })} {...rest}>
      {children}
    </span>
  );
}
InputInlineAffix.displayName = INPUT_INLINE_AFFIX_NAME;

const INPUT_COUNTER_NAME = 'InputCounter';

type InputCounterProps = {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

function clampCounterValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDigits(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function InputCounter({
  id,
  value,
  min = 1,
  max = 99,
  onChange,
  disabled,
  className,
}: InputCounterProps) {
  const safeValue = clampCounterValue(
    Number.isFinite(value) ? value : min,
    min,
    max,
  );
  const [text, setText] = React.useState(String(safeValue));

  React.useEffect(() => {
    setText(String(safeValue));
  }, [safeValue]);

  const atMin = safeValue <= min;
  const atMax = safeValue >= max;

  const commitText = (raw: string) => {
    const parsed = parseDigits(raw);
    const next =
      parsed == null ? min : clampCounterValue(parsed, min, max);
    setText(String(next));
    onChange(next);
  };

  const step = (delta: number) => {
    if (disabled) return;
    onChange(clampCounterValue(safeValue + delta, min, max));
  };

  return (
    <InputRoot size="medium" className={cn(disabled && 'opacity-60', className)}>
      <InputAffix className="p-0">
        <button
          type="button"
          className={cn(
            'flex size-10 items-center justify-center border-0 bg-transparent text-text-sub-600 transition',
            'hover:bg-bg-weak-50 hover:text-text-strong-950 disabled:cursor-not-allowed disabled:opacity-40',
          )}
          disabled={disabled || atMin}
          aria-label="Decrease value"
          onClick={() => step(-1)}
        >
          <RiSubtractLine className="size-4" aria-hidden />
        </button>
      </InputAffix>
      <InputWrapper className="min-w-0 flex-1 justify-center px-0">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={disabled}
          value={text}
          className="text-center tabular-nums"
          aria-live="polite"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={safeValue}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '');
            setText(next);
            const parsed = parseDigits(next);
            if (parsed != null) {
              onChange(clampCounterValue(parsed, min, max));
            }
          }}
          onBlur={() => commitText(text)}
          onKeyDown={(e) => {
            if (
              e.key === 'Backspace' ||
              e.key === 'Delete' ||
              e.key === 'Tab' ||
              e.key === 'ArrowLeft' ||
              e.key === 'ArrowRight' ||
              e.key === 'Home' ||
              e.key === 'End' ||
              e.key === 'Enter'
            ) {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
              return;
            }
            if (e.ctrlKey || e.metaKey) return;
            if (!/^\d$/.test(e.key)) e.preventDefault();
          }}
        />
      </InputWrapper>
      <InputAffix className="p-0">
        <button
          type="button"
          className={cn(
            'flex size-10 items-center justify-center border-0 bg-transparent text-text-sub-600 transition',
            'hover:bg-bg-weak-50 hover:text-text-strong-950 disabled:cursor-not-allowed disabled:opacity-40',
          )}
          disabled={disabled || atMax}
          aria-label="Increase value"
          onClick={() => step(1)}
        >
          <RiAddLine className="size-4" aria-hidden />
        </button>
      </InputAffix>
    </InputRoot>
  );
}
InputCounter.displayName = INPUT_COUNTER_NAME;

export {
  InputRoot as Root,
  InputWrapper as Wrapper,
  Input,
  InputIcon as Icon,
  InputAffix as Affix,
  InputInlineAffix as InlineAffix,
  InputCounter as Counter,
};
