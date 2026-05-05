const STORAGE_KEY = 'insta2figma:history:v1';

export type HistoryEntry = {
  username: string;
  favorite: boolean;
  lastUsedIso: string;
};

function parse(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const u = row as Record<string, unknown>;
    const username = typeof u.username === 'string' ? u.username.trim().toLowerCase() : '';
    if (!username) continue;
    out.push({
      username,
      favorite: Boolean(u.favorite),
      lastUsedIso:
        typeof u.lastUsedIso === 'string' && u.lastUsedIso ? u.lastUsedIso : new Date(0).toISOString(),
    });
  }
  return out;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota */
  }
}

/** Mais recentes primeiro. */
export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort(
    (a, b) => new Date(b.lastUsedIso).getTime() - new Date(a.lastUsedIso).getTime(),
  );
}

export function upsertAfterSuccessfulImport(entries: HistoryEntry[], usernameNorm: string): HistoryEntry[] {
  const key = usernameNorm.trim().toLowerCase();
  if (!key) return entries;
  const now = new Date().toISOString();
  const idx = entries.findIndex((e) => e.username === key);
  if (idx === -1) {
    return sortHistory([...entries, { username: key, favorite: false, lastUsedIso: now }]);
  }
  const next = entries.slice();
  next[idx] = { ...next[idx], lastUsedIso: now };
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
