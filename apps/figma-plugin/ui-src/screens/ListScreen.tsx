import { HistoryAvatar } from '../components/HistoryAvatar';
import type { HistoryEntry } from '../lib/historyStorage';

export type ListTab = 'history' | 'favorites';

type ListScreenProps = {
  tab: ListTab;
  onTabChange: (t: ListTab) => void;
  search: string;
  onSearchChange: (q: string) => void;
  entries: HistoryEntry[];
  selectedUsername: string | null;
  onOpenImportForProfile: (username: string) => void;
  onToggleFavorite: (username: string) => void;
  onStartImport: () => void;
  onAddNew: () => void;
  listStatus: string;
};

function matchesSearch(entry: HistoryEntry, q: string): boolean {
  if (!q.trim()) return true;
  const n = q.trim().toLowerCase().replace(/^@/, '');
  return entry.username.includes(n);
}

export function ListScreen({
  tab,
  onTabChange,
  search,
  onSearchChange,
  entries,
  selectedUsername,
  onOpenImportForProfile,
  onToggleFavorite,
  onStartImport,
  onAddNew,
  listStatus,
}: ListScreenProps) {
  const filtered = entries
    .filter((e) => (tab === 'favorites' ? e.favorite : true))
    .filter((e) => matchesSearch(e, search));

  const emptyCopy =
    tab === 'favorites'
      ? 'Ainda não tens favoritos. Marca uma estrela no histórico.'
      : 'Clica em Start Import para trazer um perfil Instagram para o histórico.';

  return (
    <div className="list-screen">
      <div className="list-tabs" role="tablist" aria-label="Secção">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`list-tab ${tab === 'history' ? 'is-active' : ''}`}
          onClick={() => onTabChange('history')}
        >
          History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'favorites'}
          className={`list-tab ${tab === 'favorites' ? 'is-active' : ''}`}
          onClick={() => onTabChange('favorites')}
        >
          Favorites
        </button>
        <button type="button" className="list-tab-add" onClick={onAddNew} aria-label="Nova importação">
          +
        </button>
      </div>
      <div className="list-rule" />
      <div className="list-search-wrap">
        <span className="list-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          className="list-search-input"
          type="search"
          placeholder="Search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Pesquisar conta"
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
                    aria-label={`Importar @{row.username}`}
                  >
                    <HistoryAvatar username={row.username} profilePicUrl={row.profilePicUrl} />
                    <span className="account-handle">@{row.username}</span>
                  </button>
                  <button
                    type="button"
                    className={`account-star ${row.favorite ? 'is-on' : ''}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      onToggleFavorite(row.username);
                    }}
                    aria-label={row.favorite ? 'Remover favorito' : 'Adicionar favorito'}
                    aria-pressed={row.favorite}
                  >
                    {row.favorite ? '★' : '☆'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="list-rule" />
      {listStatus ? <p className="list-foot-status">{listStatus}</p> : null}
      <div className="list-footer">
        <button type="button" className="list-cta primary" onClick={onStartImport}>
          Start Import
        </button>
      </div>
    </div>
  );
}
