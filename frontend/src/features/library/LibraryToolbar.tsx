import { ArrowUpDown, LayoutGrid, List, Search, X } from 'lucide-react';
import type { LibraryLayoutMode, LibrarySortOrder } from './library-Catalog';

export interface LibraryToolbarProps {
  totalPlaylists: number;
  visiblePlaylists: number;
  searchQuery: string;
  sortOrder: LibrarySortOrder;
  layoutMode: LibraryLayoutMode;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onSortChange: (sort: LibrarySortOrder) => void;
  onLayoutChange: (layout: LibraryLayoutMode) => void;
}

export function LibraryToolbar({
  totalPlaylists,
  visiblePlaylists,
  searchQuery,
  sortOrder,
  layoutMode,
  onSearchChange,
  onClearSearch,
  onSortChange,
  onLayoutChange,
}: LibraryToolbarProps) {
  const searchInputId = 'library-search-input';
  const sortSelectId = 'library-sort-select';
  const hasFilter = Boolean(searchQuery.trim());

  return (
    <div className="library-toolbar" role="region" aria-label="Búsqueda y organización de biblioteca">
      <div className="library-search-box">
        <Search size={15} className="library-search-icon" aria-hidden="true" />
        <label htmlFor={searchInputId} className="sr-only">
          Buscar playlists o canciones en tu biblioteca
        </label>
        <input
          id={searchInputId}
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nombre de playlist, canción o artista…"
          maxLength={120}
        />
        {hasFilter && (
          <button
            type="button"
            className="library-search-clear"
            aria-label="Limpiar búsqueda"
            onClick={onClearSearch}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="library-toolbar-controls">
        <span className="library-toolbar-summary" aria-live="polite">
          {hasFilter
            ? `${visiblePlaylists} de ${totalPlaylists}`
            : `${totalPlaylists} ${totalPlaylists === 1 ? 'colección' : 'colecciones'}`}
        </span>

        <div className="library-sort-control">
          <ArrowUpDown size={13} aria-hidden="true" />
          <label htmlFor={sortSelectId} className="sr-only">
            Ordenar colecciones
          </label>
          <select
            id={sortSelectId}
            aria-label="Ordenar colecciones"
            value={sortOrder}
            onChange={(event) => onSortChange(event.target.value as LibrarySortOrder)}
          >
            <option value="recent">Orden de creación</option>
            <option value="name-asc">Nombre (A–Z)</option>
            <option value="name-desc">Nombre (Z–A)</option>
            <option value="tracks-desc">Más canciones</option>
            <option value="tracks-asc">Menos canciones</option>
          </select>
        </div>

        <div className="library-view-toggle" role="group" aria-label="Vista de biblioteca">
          <button
            type="button"
            className={`library-view-btn ${layoutMode === 'grid' ? 'is-active' : ''}`}
            aria-label="Vista de cuadrícula"
            aria-pressed={layoutMode === 'grid'}
            onClick={() => onLayoutChange('grid')}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={`library-view-btn ${layoutMode === 'list' ? 'is-active' : ''}`}
            aria-label="Vista de lista"
            aria-pressed={layoutMode === 'list'}
            onClick={() => onLayoutChange('list')}
          >
            <List size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
