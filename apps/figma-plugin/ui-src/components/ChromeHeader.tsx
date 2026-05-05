export function ChromeHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="chrome-header">
      <div className="chrome-brand">
        <div className="chrome-logo" aria-hidden>
          <span className="chrome-logo-inner" />
        </div>
        <span className="chrome-title">{title}</span>
      </div>
      <button type="button" className="chrome-close" onClick={onClose} aria-label="Fechar plugin">
        ×
      </button>
    </header>
  );
}
