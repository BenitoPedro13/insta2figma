import { RiComputerLine, RiMoonLine, RiSunLine } from '@remixicon/react';
import * as SegmentedControl from './ui/segmented-control';
import { useThemePreference, type ThemePreference } from '../lib/themePreference';

const OPTIONS: { id: ThemePreference; label: string; icon: typeof RiSunLine }[] = [
  { id: 'light', label: 'Light', icon: RiSunLine },
  { id: 'dark', label: 'Dark', icon: RiMoonLine },
  { id: 'system', label: 'System', icon: RiComputerLine },
];

export function ThemeSegmentedControl() {
  const { preference, setPreference } = useThemePreference();

  return (
    <SegmentedControl.Root
      value={preference}
      onValueChange={(value) => setPreference(value as ThemePreference)}
      aria-label="Theme"
    >
      <SegmentedControl.List>
        {OPTIONS.map(({ id, label, icon: Icon }) => (
          <SegmentedControl.Trigger key={id} value={id} aria-label={label}>
            <Icon className="size-5" aria-hidden />
          </SegmentedControl.Trigger>
        ))}
      </SegmentedControl.List>
    </SegmentedControl.Root>
  );
}
