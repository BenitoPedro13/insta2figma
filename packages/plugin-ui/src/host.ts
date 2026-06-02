export type HostMessage = Record<string, unknown> & { type: string };

export interface PluginHost {
  send(msg: HostMessage): void;
  subscribe(handler: (msg: HostMessage) => void): () => void;
  /** Whether the host supports drag-to-resize. Default true. */
  readonly canResize?: boolean;
}
