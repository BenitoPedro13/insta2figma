import { RiDiscordLine, RiInstagramLine, RiTwitterXLine } from '@remixicon/react';

export function PluginFooter() {
  return (
    <footer className="plugin-footer flex shrink-0 items-center gap-2 border-t border-stroke-soft-200 bg-bg-white-0 px-3 py-2 text-paragraph-xs text-text-sub-600">
      <span className="plugin-footer-label shrink-0">Follow us on</span>
      <div className="plugin-footer-social flex items-center gap-1.5" aria-label="Redes sociais">
        <a
          href="https://instagram.com"
          target="_blank"
          rel="noopener noreferrer"
          className="plugin-footer-icon grid place-items-center text-text-sub-600 hover:text-text-strong-950"
          aria-label="Instagram"
        >
          <RiInstagramLine size={16} />
        </a>
        <a
          href="https://x.com"
          target="_blank"
          rel="noopener noreferrer"
          className="plugin-footer-icon grid place-items-center text-text-sub-600 hover:text-text-strong-950"
          aria-label="X"
        >
          <RiTwitterXLine size={16} />
        </a>
        <a
          href="https://discord.com"
          target="_blank"
          rel="noopener noreferrer"
          className="plugin-footer-icon grid place-items-center text-text-sub-600 hover:text-text-strong-950"
          aria-label="Discord"
        >
          <RiDiscordLine size={16} />
        </a>
      </div>
      <span className="plugin-footer-powered ml-auto shrink-0">
        Powered by{' '}
        <a
          href="https://mainnet.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="plugin-footer-brand font-semibold text-feature-base hover:underline"
        >
          Mainnet
        </a>
      </span>
    </footer>
  );
}
