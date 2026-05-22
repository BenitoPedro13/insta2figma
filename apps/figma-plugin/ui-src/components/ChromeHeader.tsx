export function ChromeHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="chrome-header flex shrink-0 items-center justify-between border-b border-stroke-soft-200 bg-bg-white-0 px-3 py-2.5">
      <div className="chrome-brand flex min-w-0 items-center gap-2">
        <div className="chrome-logo grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]">
          <span className="chrome-logo-inner h-3.5 w-3.5 rounded-full border-2 border-static-white" />
        </div>
        <span className="chrome-title truncate text-label-sm font-semibold text-text-strong-950">
          {title}
        </span>
      </div>
      <button
        type="button"
        className="chrome-close cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-lg leading-none text-text-sub-600 transition hover:bg-bg-weak-50 hover:text-text-strong-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-base"
        onClick={onClose}
        aria-label="Fechar plugin"
      >
        ×
      </button>
    </header>
  );
}
