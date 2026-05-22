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
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label-sm text-text-strong-950">
        {label}
      </label>
      <Input.Counter
        id={id}
        value={value}
        min={min}
        max={max}
        onChange={onChange}
        disabled={disabled}
      />
      {hint ? <p className="text-paragraph-xs text-text-sub-600">{hint}</p> : null}
    </div>
  );
}
