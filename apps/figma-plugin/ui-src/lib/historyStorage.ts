export const HISTORY_STORAGE_KEY = 'insta2figma:history:v1';

/** Histórico local. Foto de perfil Instagram na lista — backlog documentado em `docs/PLUGIN_UI_DESIGN_SPEC.md` §11. */
export type HistoryEntry = {
  username: string;
  favorite: boolean;
  lastUsedIso: string;
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
    out.push({
      username,
      favorite: Boolean(u.favorite),
      lastUsedIso:
        typeof u.lastUsedIso === 'string' && u.lastUsedIso
          ? u.lastUsedIso
          : new Date(0).toISOString(),
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
): HistoryEntry[] {
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
