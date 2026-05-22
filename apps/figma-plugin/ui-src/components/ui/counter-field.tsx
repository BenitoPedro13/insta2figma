import * as Input from './input';

type CounterFieldProps = {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function CounterField({
  id,
  label,
  hint,
  value,
  min = 1,
  max = 99,
  onChange,
  disabled,
}: CounterFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-label-sm text-text-strong-950">
        {label}
      </label>
      <Input.Root size="medium" className={disabled ? 'opacity-60' : undefined}>
        <Input.Wrapper>
          <Input.Input
            id={id}
            type="number"
            min={min}
            max={max}
            step={1}
            disabled={disabled}
            value={Number.isFinite(value) ? value : ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(n)) {
                onChange(min);
                return;
              }
              onChange(Math.min(max, Math.max(min, n)));
            }}
          />
        </Input.Wrapper>
      </Input.Root>
      {hint ? <p className="text-paragraph-xs text-text-sub-600">{hint}</p> : null}
    </div>
  );
}
