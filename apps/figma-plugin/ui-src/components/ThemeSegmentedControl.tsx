import { RiComputerLine, RiMoonLine, RiSunLine } from '@remixicon/react';
import { cn } from '../utils/cn';
import { useThemePreference, type ThemePreference } from '../lib/themePreference';

const OPTIONS: { id: ThemePreference; label: string; icon: typeof RiSunLine }[] = [
  { id: 'light', label: 'Light', icon: RiSunLine },
  { id: 'dark', label: 'Dark', icon: RiMoonLine },
  { id: 'system', label: 'System', icon: RiComputerLine },
];

export function ThemeSegmentedControl() {
  const { preference, setPreference } = useThemePreference();

  return (
    <div
      className="theme-segmented-control flex gap-1 rounded-10 bg-bg-weak-50 p-1"
      role="group"
      aria-label="Theme"
    >
      {OPTIONS.map(({ id, label, icon: Icon }) => {
        const active = preference === id;
        return (
          <button
            key={id}
            type="button"
            className={cn(
              'theme-segmented-control-item flex flex-1 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-1 transition',
              active && 'theme-segmented-control-item--active bg-bg-white-0 shadow-toggle-switch',
            )}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setPreference(id)}
          >
            <Icon className="size-5 text-text-sub-600" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
