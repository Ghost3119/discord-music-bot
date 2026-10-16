import { Heart } from 'lucide-react';
import { EmptyState, Loading } from '../../components/common/StateFeedback';
import { TrackList, type TrackActions } from '../../components/queue/TrackList';
import type { Track } from '../../lib/api';

export interface FavoritesViewProps {
  favorites: Track[];
  libraryLoading: boolean;
  trackActions: TrackActions;
}

export function FavoritesView({ favorites, libraryLoading, trackActions }: FavoritesViewProps) {
  return (
    <section className="favorites-view">
      <div className="favorites-banner">
        <div className="favorite-art">
          <Heart size={43} fill="currentColor" strokeWidth={1} />
        </div>
        <div>
          <span className="eyebrow">EN REPEAT, EN TU CORAZÓN</span>
          <h2>Tus favoritas</h2>
          <p>{favorites.length} canciones que se quedan contigo.</p>
        </div>
      </div>
      {libraryLoading ? (
        <Loading text="Buscando tus favoritas…" />
      ) : favorites.length ? (
        <div className="track-list">
          <TrackList tracks={favorites} context="favorites" actions={trackActions} />
        </div>
      ) : (
        <EmptyState
          icon={<Heart size={30} />}
          title="Aquí viven tus próximas favoritas"
          text="Toca el corazón junto a una canción para guardarla en este espacio."
        />
      )}
    </section>
  );
}
