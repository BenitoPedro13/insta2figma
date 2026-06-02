import type { PluginHost, HostMessage } from '@insta2figma/plugin-ui';

export class FigmaHost implements PluginHost {
  send(msg: HostMessage): void {
    parent.postMessage({ pluginMessage: msg }, '*');
  }

  subscribe(handler: (msg: HostMessage) => void): () => void {
    const listener = (ev: MessageEvent) => {
      const pm = ev.data?.pluginMessage;
      if (pm && typeof pm.type === 'string') handler(pm as HostMessage);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }
}
