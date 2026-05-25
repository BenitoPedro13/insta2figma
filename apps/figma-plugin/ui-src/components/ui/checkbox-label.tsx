import * as Checkbox from './checkbox';
import { cn } from '@/utils/cn';

type CheckboxLabelProps = {
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  tone?: 'primary' | 'neutral';
};

export function CheckboxLabel({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
  className,
  tone = 'primary',
}: CheckboxLabelProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <Checkbox.Root
        checked={checked}
        disabled={disabled}
        tone={tone}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-paragraph-sm text-text-strong-950">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-paragraph-xs text-text-sub-600">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}
