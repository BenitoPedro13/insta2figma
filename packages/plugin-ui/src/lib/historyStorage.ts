export const HISTORY_STORAGE_KEY = 'insta2figma:history:v1';

/**
 * Histórico local. `profilePicUrl`: URL da CDN ou `data:image/…;base64,…` (preferida,
 * vinda do fetch no main thread — o `<img>` na UI do plugin bloqueia fbcdn com frequência).
 */
export type HistoryEntry = {
  username: string;
  favorite: boolean;
  lastUsedIso: string;
  profilePicUrl?: string;
};

/** Interpreta dados vindos de `clientStorage` (main) ou migração. */
export function parseHistoryPayload(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const u = row as Record<string, unknown>;
    const username = typeof u.username === 'string' ? u.username.trim().toLowerCase() : '';
    if (!username) continue;
    const picRaw = u.profilePicUrl;
    const profilePicUrl =
      typeof picRaw === 'string' && picRaw.trim().length > 0 ? picRaw.trim() : undefined;
    out.push({
      username,
      favorite: Boolean(u.favorite),
      lastUsedIso:
        typeof u.lastUsedIso === 'string' && u.lastUsedIso
          ? u.lastUsedIso
          : new Date(0).toISOString(),
      ...(profilePicUrl !== undefined ? { profilePicUrl } : {}),
    });
  }
  return out;
}

/**
 * Fallback: `window.localStorage` no iframe nem sempre sobrevive ao fechar o plugin.
 * Mantido só para migrar dados antigos uma vez para `figma.clientStorage`.
 */
export function loadLegacyIframeHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return parseHistoryPayload(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function clearLegacyIframeHistory(): void {
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Mais recentes primeiro. */
export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort(
    (a, b) => new Date(b.lastUsedIso).getTime() - new Date(a.lastUsedIso).getTime(),
  );
}

export function upsertAfterSuccessfulImport(
  entries: HistoryEntry[],
  usernameNorm: string,
  opts?: { profilePicUrl?: string | null },
): HistoryEntry[] {
  const key = usernameNorm.trim().toLowerCase();
  if (!key) return entries;
  const now = new Date().toISOString();
  const raw = opts?.profilePicUrl;
  const pic =
    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
  const idx = entries.findIndex((e) => e.username === key);
  if (idx === -1) {
    return sortHistory([
      ...entries,
      {
        username: key,
        favorite: false,
        lastUsedIso: now,
        ...(pic !== undefined ? { profilePicUrl: pic } : {}),
      },
    ]);
  }
  const next = entries.slice();
  const prev = next[idx];
  const profilePicUrl = pic ?? prev.profilePicUrl;
  next[idx] = {
    ...prev,
    lastUsedIso: now,
    ...(profilePicUrl !== undefined && profilePicUrl !== ''
      ? { profilePicUrl }
      : {}),
  };
  return sortHistory(next);
}

export function toggleFavorite(entries: HistoryEntry[], usernameNorm: string): HistoryEntry[] {
  const key = usernameNorm.trim().toLowerCase();
  const idx = entries.findIndex((e) => e.username === key);
  if (idx === -1) return entries;
  const next = entries.slice();
  next[idx] = { ...next[idx], favorite: !next[idx].favorite };
  return next;
}

export function removeFromHistory(
  entries: HistoryEntry[],
  usernameNorm: string,
): HistoryEntry[] {
  const key = usernameNorm.trim().toLowerCase();
  if (!key) return entries;
  return entries.filter((e) => e.username !== key);
}
