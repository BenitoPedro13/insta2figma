const SCALE_MARKS = [0, 50, 150, 250, 350, 450, 550, 650];

export function PluginSidebar() {
  return (
    <aside className="plugin-sidebar" aria-hidden>
      <div className="plugin-sidebar-hatch plugin-sidebar-hatch--top" />
      <div className="plugin-sidebar-ruler">
        <div className="plugin-sidebar-track">
          {SCALE_MARKS.map((n) => (
            <span key={n} className="plugin-sidebar-mark">
              <span className="plugin-sidebar-mark-label">{n}</span>
              <span className="plugin-sidebar-mark-tick" aria-hidden />
            </span>
          ))}
        </div>
      </div>
      <div className="plugin-sidebar-hatch plugin-sidebar-hatch--bottom" />
    </aside>
  );
}
