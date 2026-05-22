const SCALE_MARKS = [0, 50, 150, 250, 350, 450, 550, 650];

export function PluginSidebar() {
  return (
    <aside className="plugin-sidebar" aria-hidden>
      <div className="plugin-sidebar-track">
        {SCALE_MARKS.map((n) => (
          <span key={n} className="plugin-sidebar-mark">
            {n}
          </span>
        ))}
      </div>
    </aside>
  );
}
