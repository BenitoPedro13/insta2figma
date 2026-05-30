export const REDIS_SESSION_KEY = 'ig:session-pool';

export interface SessionEntry {
  account: string;
  cookie: string;
  /** Proxy dedicado a esta sessão (sobrepõe o pool geral). Formato: http://user:pass@host:port */
  proxy?: string;
}

function loadSessionPool(): SessionEntry[] {
  const poolRaw = process.env.IG_SESSION_POOL?.trim();
  if (poolRaw) {
    try {
      const parsed = JSON.parse(poolRaw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as SessionEntry[];
      }
    } catch {
      console.error('[instagram-scraper] IG_SESSION_POOL inválido — ignorado');
    }
  }
  const single = process.env.IG_SESSION_COOKIE?.trim();
  if (single) {
    return [{ account: 'default', cookie: single }];
  }
  console.warn(
    '[instagram-scraper] Nenhuma sessão configurada — operando sem autenticação (rate limits baixos)',
  );
  return [];
}

function fireWebhook(text: string): void {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return;
  // Suporta Discord (content), Slack (text) e webhooks genéricos (message)
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, text, message: text }),
  }).catch(() => {});
}

export class SessionPool {
  private sessions: SessionEntry[];
  private readonly blacklisted = new Set<string>();
  private index = 0;
  private fingerprint: string;

  constructor(sessions: SessionEntry[]) {
    this.sessions = sessions;
    this.fingerprint = this.calcFingerprint(sessions);
  }

  static load(): SessionPool {
    return new SessionPool(loadSessionPool());
  }

  private calcFingerprint(sessions: SessionEntry[]): string {
    return sessions.map((s) => `${s.account}:${s.cookie}`).join('|');
  }

  /**
   * Recarrega as sessões sem reiniciar o processo. Só actualiza se as sessões
   * mudaram (comparação por account+cookie). Contas renovadas saem da blacklist.
   */
  reload(newSessions: SessionEntry[]): void {
    const newFp = this.calcFingerprint(newSessions);
    if (newFp === this.fingerprint) return;

    const newAccounts = new Set(newSessions.map((s) => s.account));
    for (const account of [...this.blacklisted]) {
      if (newAccounts.has(account)) this.blacklisted.delete(account);
    }
    this.sessions = newSessions;
    this.fingerprint = newFp;
    this.index = 0;
    console.info(`[instagram-scraper] Pool recarregado: ${newSessions.length} sessão(ões)`);
  }

  /** Retorna info das sessões sem expor cookies. */
  getStatus(): Array<{ account: string; proxy?: string; active: boolean }> {
    return this.sessions.map((s) => ({
      account: s.account,
      ...(s.proxy ? { proxy: s.proxy } : {}),
      active: !this.blacklisted.has(s.account),
    }));
  }

  next(): SessionEntry | null {
    const active = this.sessions.filter((s) => !this.blacklisted.has(s.account));
    if (active.length === 0) {
      if (this.sessions.length > 0) {
        console.error(
          '[instagram-scraper] TODAS as sessões estão inválidas — scraping sem autenticação',
        );
      }
      return null;
    }
    const session = active[this.index % active.length];
    this.index = (this.index + 1) % active.length;
    return session;
  }

  markInvalid(account: string): void {
    this.blacklisted.add(account);
    const remaining = this.activeCount;
    const total = this.size;

    console.error(
      `[instagram-scraper] Sessão inválida: conta "${account}" — ${remaining}/${total} activas`,
    );

    const lines = [
      `⚠️ Instagram session invalid: \`${account}\``,
      `Active sessions: ${remaining}/${total}`,
      remaining === 0 ? `🚨 ALL sessions invalid — scraping without authentication!` : '',
      `Renew: \`POST /admin/sessions\` or update \`IG_SESSION_POOL\` in Railway.`,
    ].filter(Boolean);

    fireWebhook(lines.join('\n'));
  }

  get size(): number {
    return this.sessions.length;
  }

  get activeCount(): number {
    return this.sessions.filter((s) => !this.blacklisted.has(s.account)).length;
  }
}

/** Singleton partilhado dentro do processo — API e Worker usam este. */
export const globalSessionPool = SessionPool.load();
