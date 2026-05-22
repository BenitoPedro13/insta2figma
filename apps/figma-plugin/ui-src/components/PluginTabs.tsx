import { cn } from '../utils/cn';

export type ShellTab = 'new-import' | 'history' | 'favorites';

type PluginTabsProps = {
  active: ShellTab;
  onChange: (tab: ShellTab) => void;
  className?: string;
};

const TABS: { id: ShellTab; label: string }[] = [
  { id: 'new-import', label: 'New Import' },
  { id: 'history', label: 'History' },
  { id: 'favorites', label: 'Favorites' },
];

export function PluginTabs({ active, onChange, className }: PluginTabsProps) {
  return (
    <div
      className={cn(
        'plugin-tabs flex shrink-0 items-center gap-1 border-b border-stroke-soft-200 bg-bg-white-0 px-4 py-2',
        className,
      )}
      role="tablist"
      aria-label="Plugin sections"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={cn(
            'plugin-tab cursor-pointer border-0 bg-transparent px-0 py-1 text-label-sm font-medium transition',
            active === tab.id
              ? 'is-active font-semibold text-text-strong-950'
              : 'text-text-soft-400 hover:text-text-sub-600',
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
