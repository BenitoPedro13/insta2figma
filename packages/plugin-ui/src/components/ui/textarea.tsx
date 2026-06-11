// AlignUI Textarea v0.0.0

import * as React from 'react';

import { cn } from '@/utils/cn';
import { tv, type VariantProps } from '@/utils/tv';

const TEXTAREA_ROOT_NAME = 'TextareaRoot';
const TEXTAREA_CHAR_COUNTER_NAME = 'TextareaCharCounter';

export const textareaVariants = tv({
  slots: {
    root: [
      'group relative flex w-full flex-col overflow-hidden rounded-10 bg-bg-white-0 text-text-strong-950 shadow-regular-xs',
      'transition duration-200 ease-out',
      'before:absolute before:inset-0 before:ring-1 before:ring-inset before:ring-stroke-soft-200',
      'before:pointer-events-none before:rounded-[inherit]',
      'before:transition before:duration-200 before:ease-out',
      'hover:shadow-none hover:[&:not(:has(textarea:focus))]:bg-bg-weak-50',
      'has-[textarea:focus]:shadow-button-important-focus has-[textarea:focus]:before:ring-stroke-strong-950',
      'has-[textarea:disabled]:pointer-events-none has-[textarea:disabled]:bg-bg-weak-50 has-[textarea:disabled]:shadow-none has-[textarea:disabled]:before:ring-transparent',
    ],
    textarea: [
      'w-full resize-none bg-transparent px-3 pt-2.5 text-paragraph-sm text-text-strong-950 outline-none',
      'transition duration-200 ease-out',
      'placeholder:select-none placeholder:text-text-soft-400 placeholder:transition placeholder:duration-200 placeholder:ease-out',
      'group-hover:placeholder:text-text-sub-600',
      'focus:outline-none group-has-[textarea:focus]:placeholder:text-text-sub-600',
      'disabled:text-text-disabled-300 disabled:placeholder:text-text-disabled-300',
    ],
    counter: [
      'select-none px-3 pb-2 text-right text-subheading-2xs text-text-soft-400',
      'transition duration-200 ease-out',
      'group-has-[textarea:focus]:text-text-sub-600',
    ],
  },
  variants: {
    hasError: {
      true: {
        root: [
          'before:ring-error-base',
          'has-[textarea:focus]:shadow-button-error-focus has-[textarea:focus]:before:ring-error-base',
        ],
      },
    },
  },
});

type TextareaSharedProps = VariantProps<typeof textareaVariants>;

type TextareaRootProps = React.HTMLAttributes<HTMLDivElement> & TextareaSharedProps;

function TextareaRoot({ className, hasError, ...rest }: TextareaRootProps) {
  const { root } = textareaVariants({ hasError });
  return <div className={root({ class: className })} {...rest} />;
}
TextareaRoot.displayName = TEXTAREA_ROOT_NAME;

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...rest }, forwardedRef) => {
  const { textarea } = textareaVariants();
  return (
    <textarea
      ref={forwardedRef}
      className={textarea({ class: className })}
      {...rest}
    />
  );
});
Textarea.displayName = 'TextareaEl';

type TextareaCharCounterProps = React.HTMLAttributes<HTMLDivElement> & {
  current: number;
  max: number;
};

function TextareaCharCounter({ current, max, className, ...rest }: TextareaCharCounterProps) {
  const { counter } = textareaVariants();
  return (
    <div className={cn(counter(), className)} {...rest}>
      {current}/{max}
    </div>
  );
}
TextareaCharCounter.displayName = TEXTAREA_CHAR_COUNTER_NAME;

export { TextareaRoot as Root, Textarea, TextareaCharCounter as CharCounter };
