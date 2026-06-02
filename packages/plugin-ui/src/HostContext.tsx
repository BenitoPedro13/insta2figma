import { createContext, useContext } from 'react';
import type { PluginHost } from './host';

const HostContext = createContext<PluginHost | null>(null);
export const HostProvider = HostContext.Provider;

export function useHost(): PluginHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('useHost: missing HostProvider');
  return host;
}
