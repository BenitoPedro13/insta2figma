import { RiCloseLine, RiSearchLine, RiStarFill, RiStarLine } from '@remixicon/react';
import { HistoryAvatar } from '../components/HistoryAvatar';
import type { HistoryEntry } from '../lib/historyStorage';

export type ListTab = 'history' | 'favorites';

type ListScreenProps = {
  tab: ListTab;
  search: string;
  onSearchChange: (q: string) => void;
  entries: HistoryEntry[];
  selectedUsername: string | null;
  onOpenImportForProfile: (username: string) => void;
  onToggleFavorite: (username: string) => void;
  onRemoveFromHistory: (username: string) => void;
  listStatus: string;
};

function matchesSearch(entry: HistoryEntry, q: string): boolean {
  if (!q.trim()) return true;
  const n = q.trim().toLowerCase().replace(/^@/, '');
  return entry.username.includes(n);
}

export function ListScreen({
  tab,
  search,
  onSearchChange,
  entries,
  selectedUsername,
  onOpenImportForProfile,
  onToggleFavorite,
  onRemoveFromHistory,
  listStatus,
}: ListScreenProps) {
  const filtered = entries
    .filter((e) => (tab === 'favorites' ? e.favorite : true))
    .filter((e) => matchesSearch(e, search));

  const emptyCopy =
    tab === 'favorites'
      ? 'No favorites yet. Star an account from History.'
      : 'Import a profile from New Import to show up here.';

  return (
    <div className="list-screen list-screen--embedded flex min-h-0 flex-1 flex-col">
      <div className="list-search-wrap">
        <span className="list-search-icon" aria-hidden>
          <RiSearchLine size={18} />
        </span>
        <input
          className="list-search-input"
          type="search"
          placeholder="Search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search accounts"
        />
      </div>
      <div className="list-rule" />
      <div className="list-scroll">
        {filtered.length === 0 ? (
          <div className="list-empty">
            <p className="list-empty-text">{emptyCopy}</p>
          </div>
        ) : (
          <ul className="account-list">
            {filtered.map((row) => {
              const sel = selectedUsername === row.username;
              return (
                <li key={row.username} className="account-item">
                  <button
                    type="button"
                    className={`account-row ${sel ? 'is-selected' : ''}`}
                    onClick={() => onOpenImportForProfile(row.username)}
                    aria-label={`Open @${row.username}`}
                  >
                    <HistoryAvatar username={row.username} profilePicUrl={row.profilePicUrl} />
                    <span className="account-handle">@{row.username}</span>
                  </button>
                  <div className="account-item-actions">
                    <button
                      type="button"
                      className={`account-star ${row.favorite ? 'is-on' : ''}`}
                      onClick={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onToggleFavorite(row.username);
                      }}
                      aria-label={row.favorite ? 'Remove favorite' : 'Add favorite'}
                      aria-pressed={row.favorite}
                    >
                      {row.favorite ? (
                        <RiStarFill size={18} aria-hidden />
                      ) : (
                        <RiStarLine size={18} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className="account-remove"
                      onClick={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onRemoveFromHistory(row.username);
                      }}
                      aria-label={`Remove @${row.username} from history`}
                    >
                      <RiCloseLine size={18} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="list-rule" />
      {listStatus ? <p className="list-foot-status">{listStatus}</p> : null}
    </div>
  );
}
