import { Activity, AudioLines, Check, Headphones, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { IconButton } from './components/common/IconButton';
import { EmptyState } from './components/common/StateFeedback';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { PageHeading } from './components/layout/PageHeading';
import { PlayerBar, type PlaybackBindings } from './components/player/PlayerBar';
import type { TrackActions } from './components/queue/TrackList';
import { Login } from './features/auth/Login';
import { PlayerView } from './features/dashboard/PlayerView';
import { LibraryView } from './features/library/LibraryView';
import { LibraryDialog } from './features/library/LibraryDialog';
import { FavoritesView } from './features/favorites/FavoritesView';
import { DiagnosticsView } from './features/diagnostics/DiagnosticsView';
import { useSonoraApp } from './hooks/use-sonora-app';
import { trackMetadata } from './lib/api';

export default function App() {
  const app = useSonoraApp();
  const createPlaylist = () => app.setModal({ type: 'playlist' });
  const playback: PlaybackBindings = {
    state: app.state,
    busy: app.busy,
    controlsDisabled: app.controlsDisabled,
    volumeDraft: app.volumeDraft,
    setVolumeDraft: app.setVolumeDraft,
    action: app.action,
    isFavorite: app.isFavorite,
    toggleFavorite: app.toggleFavorite,
    onSaveTrack: (track) => app.setModal({ type: 'save', track }),
  };
  const trackActions: TrackActions = {
    busy: !!app.busy,
    playbackReady: !!app.state,
    isFavorite: app.isFavorite,
    onPlay: (track) => app.action({ action: 'play', query: track.url, track: trackMetadata(track) }),
    onToggleFavorite: app.toggleFavorite,
    onSave: playback.onSaveTrack,
    onMove: (from, to, owner) =>
      owner
        ? app.reorderPlaylist(owner, from, to)
        : app.action({ action: 'move', from: from + 1, to: to + 1 }),
    onRemove: (track, index, owner) =>
      owner ? app.removePlaylistTrack(owner, track) : app.action({ action: 'remove', index: index + 1 }),
  };

  if (!app.session) return <Login loading={app.authLoading} error={app.authError} retry={app.retryAuth} />;

  return (
    <div className="app-shell">
      <Sidebar
        mobileNav={app.mobileNav}
        view={app.view}
        playing={app.playing}
        guildId={app.guildId}
        playlists={app.playlists}
        selectedPlaylist={app.selectedPlaylist}
        loggingOut={app.loggingOut}
        onCloseNavigation={() => app.setMobileNav(false)}
        onCreatePlaylist={createPlaylist}
        onLogout={app.logout}
        onNavigate={(view) => {
          app.setView(view);
          app.setSelectedPlaylist('');
          app.setMobileNav(false);
        }}
        onOpenPlaylist={(id) => {
          app.setSelectedPlaylist(id);
          app.setView('library');
          app.setMobileNav(false);
        }}
      />
      <div className="main-shell">
        <Header
          session={app.session}
          view={app.view}
          guildId={app.guildId}
          connection={app.connection}
          onOpenNavigation={() => app.setMobileNav(true)}
        />
        <main className="main-content" id="main-content">
          <PageHeading
            view={app.view}
            playlist={app.playlist}
            guilds={app.guilds}
            guildId={app.guildId}
            guildsLoading={app.guildsLoading}
            busy={app.busy}
            state={app.state}
            onGuildChange={(id) => {
              app.setGuildId(id);
              app.setError('');
            }}
          />
          {app.error && (
            <div className="alert alert-error" role="alert">
              <Activity size={18} />
              <span>{app.error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  app.setError('');
                  void app.refresh();
                  app.reloadLibrary();
                }}
              >
                Reintentar
              </Button>
              <IconButton label="Cerrar error" onClick={() => app.setError('')}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {!app.guildId ? (
            <EmptyState
              icon={<Headphones size={30} />}
              title={app.guildsLoading ? 'Buscando tu comunidad…' : 'Tu espacio está casi listo'}
              text={
                app.guildsLoading
                  ? 'Consultando los servidores disponibles.'
                  : 'No hay servidores disponibles para tu cuenta. Comprueba que el bot esté presente y tengas acceso.'
              }
            />
          ) : (
            <>
              {app.view === 'player' && (
                <PlayerView
                  playback={playback}
                  connection={app.connection}
                  query={app.query}
                  onQueryChange={app.setQuery}
                  onAddToQueue={app.addToQueue}
                  onDiagnostics={() => app.setView('diagnostics')}
                  trackActions={trackActions}
                />
              )}
              {app.view === 'library' && (
                <LibraryView
                  trackActions={trackActions}
                  library={{
                    playlist: app.playlist,
                    playlists: app.playlists,
                    libraryLoading: app.libraryLoading,
                    busy: app.busy,
                    playbackReady: !!app.state,
                    onSelectPlaylist: app.setSelectedPlaylist,
                    onCreatePlaylist: createPlaylist,
                    onRenamePlaylist: (playlist) => app.setModal({ type: 'playlist', playlist }),
                    onDeletePlaylist: (playlist) => app.setModal({ type: 'delete', playlist }),
                    onAddTrack: (playlist) => app.setModal({ type: 'add', playlist }),
                    onLoadPlaylist: app.loadPlaylist,
                  }}
                />
              )}
              {app.view === 'favorites' && (
                <FavoritesView
                  favorites={app.favorites}
                  libraryLoading={app.libraryLoading}
                  trackActions={trackActions}
                />
              )}
              {app.view === 'diagnostics' && (
                <DiagnosticsView
                  state={app.state}
                  connection={app.connection}
                  refresh={() => void app.refresh()}
                />
              )}
            </>
          )}
          <footer className="content-footer">
            <span>
              <AudioLines size={13} /> HECHO PARA ESCUCHAR JUNTOS.
            </span>
            <span>
              SONORA <span className="tiny-dot" /> TU ESPACIO MUSICAL
            </span>
          </footer>
        </main>
      </div>
      <PlayerBar playback={playback} onShowQueue={() => app.setView('player')} />
      {app.notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {app.notice}
        </div>
      )}
      <LibraryDialog
        dialog={{
          modal: app.modal,
          busy: app.busy,
          error: app.error,
          playlists: app.playlists,
          name: app.name,
          targetPlaylist: app.targetPlaylist,
          trackUrl: app.trackUrl,
          trackArtist: app.trackArtist,
          resolvedTrack: app.resolvedTrack,
          resolvingTrack: app.resolvingTrack,
          onClose: () => app.setModal(null),
          onCreatePlaylist: createPlaylist,
          onNameChange: app.setName,
          onTargetPlaylistChange: app.setTargetPlaylist,
          onTrackUrlChange: app.setTrackUrl,
          onTrackTitleChange: app.onTrackTitleChange,
          onTrackArtistChange: app.onTrackArtistChange,
          onSubmit: app.submitModal,
        }}
      />
    </div>
  );
}
