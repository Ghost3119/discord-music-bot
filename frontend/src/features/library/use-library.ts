import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, trackMetadata, type Playlist, type Session, type Track } from '../../lib/api';
import type { Modal, View } from '../../types/app';

interface LibraryOptions {
  guildId: string;
  session: Session | null;
  reportError: (problem: unknown) => void;
  run: (key: string, task: () => Promise<void>) => Promise<void>;
  mutate: (path: string, method: string, data?: unknown) => Promise<void>;
  setNotice: (notice: string) => void;
  setView: (view: View) => void;
  refresh: () => Promise<void> | undefined;
}

/** Keeps collection data, its editor and abortable metadata lookup in one feature. */
export function useLibrary({
  guildId,
  session,
  reportError,
  run,
  mutate,
  setNotice,
  setView,
  refresh,
}: LibraryOptions) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState('');
  const [targetPlaylist, setTargetPlaylist] = useState('');
  const [trackUrl, setTrackUrl] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [resolvedTrack, setResolvedTrack] = useState<Omit<Track, 'id'> | null>(null);
  const [resolvingTrack, setResolvingTrack] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [artistTouched, setArtistTouched] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);

  useEffect(() => {
    setPlaylists([]);
    setFavorites([]);
    setSelectedPlaylist('');
    setModal(null);
    setLibraryLoading(false);
  }, [guildId, session]);

  useEffect(() => {
    if (!guildId || !session) return;
    const abort = new AbortController();
    setLibraryLoading(true);
    Promise.all([
      api<{ playlists: Playlist[] }>(`/api/guilds/${guildId}/playlists`, { signal: abort.signal }),
      api<{ favorites: Track[] }>(`/api/guilds/${guildId}/favorites`, { signal: abort.signal }),
    ])
      .then(([library, saved]) => {
        if (!abort.signal.aborted) {
          setPlaylists(library.playlists);
          setFavorites(saved.favorites);
        }
      })
      .catch((problem) => {
        if (!abort.signal.aborted) reportError(problem);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLibraryLoading(false);
      });
    return () => abort.abort();
  }, [libraryRevision, guildId, session, reportError]);

  useEffect(() => {
    if (modal?.type === 'playlist') setName(modal.playlist?.name || '');
    if (modal?.type === 'save') setTargetPlaylist(playlists[0]?.id || '');
    if (modal?.type === 'add') {
      setName('');
      setTrackUrl('');
      setTrackArtist('');
      setResolvedTrack(null);
      setResolvingTrack(false);
      setTitleTouched(false);
      setArtistTouched(false);
    }
  }, [modal, playlists]);

  useEffect(() => {
    if (modal?.type !== 'add' || !guildId || !session) return;
    const raw = trackUrl.trim();
    if (!/^https:\/\/\S+\.\S+/i.test(raw)) {
      setResolvedTrack(null);
      setResolvingTrack(false);
      return;
    }
    const abort = new AbortController();
    setResolvingTrack(true);
    const timer = window.setTimeout(() => {
      api<{ track: Omit<Track, 'id'> }>(
        `/api/guilds/${guildId}/tracks/resolve?url=${encodeURIComponent(raw)}`,
        { signal: abort.signal },
      )
        .then(({ track }) => {
          if (abort.signal.aborted) return;
          setResolvedTrack(track);
          setName((prev) => (!titleTouched || !prev.trim() ? track.title : prev));
          setTrackArtist((prev) =>
            !artistTouched || !prev.trim()
              ? track.artist === 'Artista desconocido'
                ? ''
                : track.artist
              : prev,
          );
        })
        .catch(() => {
          if (!abort.signal.aborted) setResolvedTrack(null);
        })
        .finally(() => {
          if (!abort.signal.aborted) setResolvingTrack(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [modal?.type, trackUrl, guildId, session, titleTouched, artistTouched]);

  const reloadLibrary = useCallback(() => setLibraryRevision((value) => value + 1), []);
  const clearLibrary = useCallback(() => {
    setPlaylists([]);
    setFavorites([]);
  }, []);

  function onTrackTitleChange(value: string) {
    setTitleTouched(true);
    setName(value);
  }

  function onTrackArtistChange(value: string) {
    setArtistTouched(true);
    setTrackArtist(value);
  }

  function isFavorite(track: Track) {
    return favorites.some((item) => item.url === track.url);
  }

  function toggleFavorite(track: Track) {
    const saved = favorites.find((item) => item.url === track.url);
    return run('favorite', async () => {
      await mutate(
        `/api/guilds/${guildId}/favorites${saved ? `/${saved.id}` : ''}`,
        saved ? 'DELETE' : 'POST',
        saved ? undefined : trackMetadata(track),
      );
      reloadLibrary();
      setNotice(saved ? 'Canción retirada de favoritos.' : 'Guardada en tus favoritos.');
    });
  }

  function reorderPlaylist(playlist: Playlist, from: number, to: number) {
    const ids = playlist.tracks.map((track) => track.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    return run('reorder', async () => {
      await mutate(`/api/guilds/${guildId}/playlists/${playlist.id}/tracks/order`, 'PUT', { trackIds: ids });
      reloadLibrary();
    });
  }

  function removePlaylistTrack(playlist: Playlist, track: Track) {
    return run('remove-track', async () => {
      await mutate(`/api/guilds/${guildId}/playlists/${playlist.id}/tracks/${track.id}`, 'DELETE');
      reloadLibrary();
    });
  }

  function loadPlaylist(playlist: Playlist) {
    return run('load', async () => {
      await mutate(`/api/guilds/${guildId}/playlists/${playlist.id}/load`, 'POST');
      setNotice(
        `«${playlist.name}» (${playlist.tracks.length} ${playlist.tracks.length === 1 ? 'canción' : 'canciones'}) enviada a la cola.`,
      );
      setView('player');
      await refresh();
    });
  }

  async function submitModal(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    await run('save', async () => {
      const base = `/api/guilds/${guildId}/playlists`;
      if (modal.type === 'playlist') {
        await mutate(
          `${base}${modal.playlist ? `/${modal.playlist.id}` : ''}`,
          modal.playlist ? 'PATCH' : 'POST',
          { name: name.trim() },
        );
      }
      if (modal.type === 'delete') {
        await mutate(`${base}/${modal.playlist.id}`, 'DELETE');
        if (selectedPlaylist === modal.playlist.id) setSelectedPlaylist('');
      }
      if (modal.type === 'save')
        await mutate(`${base}/${targetPlaylist}/tracks`, 'POST', trackMetadata(modal.track));
      if (modal.type === 'add') {
        await mutate(`${base}/${modal.playlist.id}/tracks`, 'POST', {
          url: trackUrl.trim(),
          title: name.trim() || resolvedTrack?.title || '',
          artist: trackArtist.trim() || resolvedTrack?.artist || 'Artista desconocido',
          duration: resolvedTrack?.duration || 0,
          thumbnail: resolvedTrack?.thumbnail || null,
          source: resolvedTrack?.source || 'youtube',
        });
      }
      reloadLibrary();
      setModal(null);
      setNotice('Biblioteca actualizada.');
    });
  }

  return {
    playlists,
    favorites,
    libraryLoading,
    selectedPlaylist,
    setSelectedPlaylist,
    playlist: playlists.find((item) => item.id === selectedPlaylist),
    modal,
    setModal,
    name,
    setName,
    targetPlaylist,
    setTargetPlaylist,
    trackUrl,
    setTrackUrl,
    trackArtist,
    setTrackArtist,
    resolvedTrack,
    resolvingTrack,
    setTitleTouched,
    setArtistTouched,
    onTrackTitleChange,
    onTrackArtistChange,
    isFavorite,
    toggleFavorite,
    reorderPlaylist,
    removePlaylistTrack,
    loadPlaylist,
    submitModal,
    reloadLibrary,
    clearLibrary,
  };
}
