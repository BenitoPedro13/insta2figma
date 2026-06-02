export type HostMessage = Record<string, unknown> & { type: string };

export interface PluginHost {
  send(msg: HostMessage): void;
  subscribe(handler: (msg: HostMessage) => void): () => void;
}
