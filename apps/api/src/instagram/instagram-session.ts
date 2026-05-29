export interface SessionEntry {
  account: string;
  cookie: string;
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

export class SessionPool {
  private readonly sessions: SessionEntry[];
  private readonly blacklisted = new Set<string>();
  private index = 0;

  constructor(sessions: SessionEntry[]) {
    this.sessions = sessions;
  }

  static load(): SessionPool {
    return new SessionPool(loadSessionPool());
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
    console.error(
      `[instagram-scraper] Sessão inválida: conta "${account}" — verificar/renovar IG_SESSION_POOL`,
    );
    this.blacklisted.add(account);
  }

  get size(): number {
    return this.sessions.length;
  }

  get activeCount(): number {
    return this.sessions.filter((s) => !this.blacklisted.has(s.account)).length;
  }
}
