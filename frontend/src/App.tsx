import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, ChevronDown, CircleHelp, Disc3, ExternalLink, Headphones, Heart, Library, ListMusic, LoaderCircle, LogOut, Menu, Music2, Pause, Pencil, Play, Plus, Radio, RefreshCw, Repeat, Search, ShieldCheck, Shuffle, SkipForward, Square, Trash2, Volume2, Wifi, X } from 'lucide-react';
import { Artwork } from './components/artwork';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { api, ApiError, trackMetadata, type GuildSummary, type MusicAction, type PlaybackSnapshot, type Playlist, type Session, type Track } from './lib/api';
import { cn, duration } from './lib/utils';
import { usePlayback } from './hooks/use-playback';
import { healthRows } from './lib/health';
import { AbandonedOperation, createOperationScope } from './lib/operation-scope';

type View = 'player' | 'library' | 'favorites' | 'diagnostics';
type Modal = { type: 'playlist'; playlist?: Playlist } | { type: 'delete'; playlist: Playlist } | { type: 'save'; track: Track } | { type: 'add'; playlist: Playlist } | null;
const labels = { idle: 'En espera', playing: 'Reproduciendo', paused: 'En pausa', recovering: 'Recuperando audio', blocked: 'Reproducción bloqueada' };
const navigation = [{ id: 'player', name: 'Ahora suena', icon: AudioLines }, { id: 'library', name: 'Mi biblioteca', icon: Library }, { id: 'favorites', name: 'Favoritos', icon: Heart }, { id: 'diagnostics', name: 'Diagnóstico', icon: Activity }] as const;

function IconButton({ label, children, active, className, ...props }: { label: string; children: ReactNode; active?: boolean } & React.ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="icon" title={label} aria-label={label} className={cn(active && 'is-active', className)} {...props}>{children}</Button>;
}

function UserAvatar({ session }: { session: Session }) {
  const avatar = session.user.avatar;
  const url = avatar && (/^https:\/\//.test(avatar) ? avatar : `https://cdn.discordapp.com/avatars/${session.user.id}/${avatar}.png?size=64`);
  return <span className="user-avatar">{url ? <img alt="" src={url} referrerPolicy="no-referrer" /> : session.user.username.slice(0, 1).toUpperCase()}</span>;
}

function Login({ error, retry, loading }: { error: string; retry: () => void; loading: boolean }) {
  return <div className="login-page">
    <div className="login-brand"><Brand /><span className="private-badge"><ShieldCheck size={13} /> ESPACIO PRIVADO</span></div>
    <main className="login-main">
      <div className="login-copy"><span className="eyebrow">BUENA MÚSICA. BUENA COMPAÑÍA.</span><h1>El mejor lugar<br />para <em>darle play.</em></h1><p>Tu servidor tiene su propio ritmo. Controla la música, reúne tus favoritas y comparte el momento.</p>
        {loading ? <Button disabled><LoaderCircle className="spin" size={18} /> Conectando con tu espacio</Button> : <Button asChild className="discord-login"><a href="/auth/discord"><DiscordIcon /> Continuar con Discord <ArrowRight size={18} /></a></Button>}
        <small><ShieldCheck size={13} /> Solo para miembros autorizados de tu servidor.</small>
        {error && <div className="login-error" role="alert"><p>{error}</p><Button variant="secondary" size="sm" onClick={retry}><RefreshCw size={14} /> Reintentar conexión</Button></div>}
      </div>
      <div className="login-visual" aria-hidden="true"><div className="record-glow" /><div className="record"><div className="record-label"><AudioLines size={48} strokeWidth={1.3} /><span>SONORA</span></div></div><span className="floating-note"><Music2 size={20} /> HECHO PARA ESCUCHAR JUNTOS</span><div className="visual-bars">{Array.from({ length: 28 }, (_, i) => <span key={i} style={{ height: `${16 + Math.sin(i * 1.7) ** 2 * 42}px`, animationDelay: `${i * 0.09}s` }} />)}</div></div>
    </main><footer className="login-footer"><span>MENOS RUIDO, MÁS MÚSICA.</span><span>Discord Music Dashboard <span className="tiny-dot" /> SONORA</span></footer>
  </div>;
}

function DiscordIcon() { return <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.7 5.3a18 18 0 0 0-4.4-1.4l-.6 1.2a16.2 16.2 0 0 0-5.4 0l-.6-1.2a18 18 0 0 0-4.4 1.4C1.5 9.4.7 13.4 1.1 17.3a18 18 0 0 0 5.4 2.8l1.1-1.8-1.7-.8.4-.3a12.8 12.8 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.4-2.8c.5-4.5-.8-8.5-3.2-12ZM8.5 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" /></svg>; }
function Brand() { return <div className="brand"><span className="brand-mark"><AudioLines size={23} strokeWidth={2.3} /></span>SONORA<span className="brand-dot">®</span></div>; }

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [guildId, setGuildId] = useState('');
  const [guildsLoading, setGuildsLoading] = useState(false);
  const [view, setView] = useState<View>('player');
  const [mobileNav, setMobileNav] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [query, setQuery] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState('');
  const [targetPlaylist, setTargetPlaylist] = useState('');
  const [trackUrl, setTrackUrl] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [libraryRevision, setLibraryRevision] = useState(0);
  const selectedGuildRef = useRef(guildId);
  const operationScope = useRef(createOperationScope());
  const runningOperation = useRef(0);
  selectedGuildRef.current = guildId;
  const reportError = useCallback((problem: unknown) => {
    if (problem instanceof ApiError && problem.status === 401) {
      operationScope.current.invalidate();
      runningOperation.current++; setBusy('');
      setSession(null); setGuildId(''); setGuilds([]); setAuthError('Tu sesión terminó. Inicia sesión de nuevo para continuar.');
    } else setError(problem instanceof Error ? problem.message : 'Ocurrió un error. Vuelve a intentarlo.');
  }, []);
  const { state, connection, refresh } = usePlayback(session ? guildId : '', reportError);

  useEffect(() => {
    const abort = new AbortController();
    setAuthLoading(true); setAuthError('');
    api<Session>('/api/session', { signal: abort.signal }).then((value) => setSession(value)).catch((problem) => {
      if (abort.signal.aborted) return;
      if (!(problem instanceof ApiError && problem.status === 401)) setAuthError(problem instanceof Error ? problem.message : 'No se pudo conectar al servidor.');
    }).finally(() => { if (!abort.signal.aborted) setAuthLoading(false); });
    return () => abort.abort();
  }, [authAttempt]);

  useEffect(() => {
    if (!session) return;
    const abort = new AbortController();
    setGuildsLoading(true);
    api<{ guilds: GuildSummary[] }>('/api/guilds', { signal: abort.signal }).then(({ guilds: next }) => {
      if (abort.signal.aborted) return;
      setGuilds(next); setGuildId(next[0]?.id || '');
    }).catch((problem) => { if (!abort.signal.aborted) reportError(problem); }).finally(() => { if (!abort.signal.aborted) setGuildsLoading(false); });
    return () => abort.abort();
  }, [session, reportError]);

  useEffect(() => {
    setPlaylists([]); setFavorites([]); setSelectedPlaylist(''); setModal(null);
    setLibraryLoading(false);
  }, [guildId, session]);

  useEffect(() => {
    if (!guildId || !session) return;
    const abort = new AbortController();
    setLibraryLoading(true);
    Promise.all([
      api<{ playlists: Playlist[] }>(`/api/guilds/${guildId}/playlists`, { signal: abort.signal }),
      api<{ favorites: Track[] }>(`/api/guilds/${guildId}/favorites`, { signal: abort.signal }),
    ]).then(([library, saved]) => { if (!abort.signal.aborted) { setPlaylists(library.playlists); setFavorites(saved.favorites); } }).catch((problem) => { if (!abort.signal.aborted) reportError(problem); }).finally(() => { if (!abort.signal.aborted) setLibraryLoading(false); });
    return () => abort.abort();
  }, [libraryRevision, guildId, session, reportError]);

  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { if (modal?.type === 'playlist') setName(modal.playlist?.name || ''); if (modal?.type === 'save') setTargetPlaylist(playlists[0]?.id || ''); if (modal?.type === 'add') { setName(''); setTrackUrl(''); setTrackArtist(''); } }, [modal, playlists]);

  async function run(key: string, task: () => Promise<void>) {
    if (busy || loggingOut) return;
    const operation = ++runningOperation.current;
    setBusy(key); setError('');
    try { await task(); } catch (problem) { if (!(problem instanceof AbandonedOperation)) reportError(problem); } finally { if (operation === runningOperation.current) setBusy(''); }
  }
  async function mutate(path: string, method: string, data?: unknown) {
    if (!session) return;
    await operationScope.current.run(() => api(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, session.csrfToken));
  }
  async function logout() {
    if (!session || loggingOut) return;
    const previousGuild = guildId;
    setLoggingOut(true); setError(''); setNotice('');
    operationScope.current.invalidate();
    runningOperation.current++; setBusy('');
    // Close SSE immediately; logout can cancel a long-running backend operation.
    setGuildId('');
    try {
      await api('/auth/logout', { method: 'POST' }, session.csrfToken);
      setSession(null); setGuilds([]); setPlaylists([]); setFavorites([]); setBusy(''); setAuthError('');
    } catch (problem) { setGuildId(previousGuild); reportError(problem); }
    finally { setLoggingOut(false); }
  }
  function action(command: MusicAction) {
    const originGuild = guildId;
    return run(command.action, async () => {
      await mutate(`/api/guilds/${originGuild}/actions`, 'POST', command);
      if (originGuild === selectedGuildRef.current) await refresh();
    });
  }
  async function addToQueue(event: FormEvent) {
    event.preventDefault(); if (!query.trim()) return;
    const text = query.trim();
    await run('play', async () => { await mutate(`/api/guilds/${guildId}/actions`, 'POST', { action: 'play', query: text }); setQuery(''); setNotice('Canción enviada a la cola.'); await refresh(); });
  }
  function isFavorite(track: Track) { return favorites.some((item) => item.url === track.url); }
  function toggleFavorite(track: Track) {
    const saved = favorites.find((item) => item.url === track.url);
    return run('favorite', async () => { await mutate(`/api/guilds/${guildId}/favorites${saved ? `/${saved.id}` : ''}`, saved ? 'DELETE' : 'POST', saved ? undefined : trackMetadata(track)); setLibraryRevision((value) => value + 1); setNotice(saved ? 'Canción retirada de favoritos.' : 'Guardada en tus favoritos.'); });
  }
  function reorderPlaylist(playlist: Playlist, from: number, to: number) {
    const ids = playlist.tracks.map((track) => track.id); ids.splice(to, 0, ids.splice(from, 1)[0]);
    return run('reorder', async () => { await mutate(`/api/guilds/${guildId}/playlists/${playlist.id}/tracks/order`, 'PUT', { trackIds: ids }); setLibraryRevision((value) => value + 1); });
  }
  function loadPlaylist(playlist: Playlist) {
    return run('load', async () => { await mutate(`/api/guilds/${guildId}/playlists/${playlist.id}/load`, 'POST'); setNotice(`«${playlist.name}» enviada a la cola.`); setView('player'); await refresh(); });
  }
  async function submitModal(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    await run('save', async () => {
      const base = `/api/guilds/${guildId}/playlists`;
      if (modal.type === 'playlist') await mutate(`${base}${modal.playlist ? `/${modal.playlist.id}` : ''}`, modal.playlist ? 'PATCH' : 'POST', { name: name.trim() });
      if (modal.type === 'delete') { await mutate(`${base}/${modal.playlist.id}`, 'DELETE'); if (selectedPlaylist === modal.playlist.id) setSelectedPlaylist(''); }
      if (modal.type === 'save') await mutate(`${base}/${targetPlaylist}/tracks`, 'POST', trackMetadata(modal.track));
      if (modal.type === 'add') await mutate(`${base}/${modal.playlist.id}/tracks`, 'POST', { url: trackUrl.trim(), title: name.trim(), artist: trackArtist.trim() || 'Artista desconocido', duration: 0, thumbnail: null, source: 'youtube' });
      setLibraryRevision((value) => value + 1); setModal(null); setNotice('Biblioteca actualizada.');
    });
  }
  const guild = guilds.find((item) => item.id === guildId);
  const playlist = playlists.find((item) => item.id === selectedPlaylist);
  const current = state?.current;
  const controlsDisabled = !!busy || loggingOut || !state;
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  useEffect(() => { setVolumeDraft(null); }, [state?.volume, guildId]);
  const playing = state?.status === 'playing';
  const progress = current?.duration ? Math.min(100, Math.max(0, (state!.currentTime / current.duration) * 100)) : 0;
  const queueDuration = state?.queue.reduce((sum, track) => sum + track.duration, 0) || 0;

  if (!session) return <Login loading={authLoading} error={authError} retry={() => setAuthAttempt((value) => value + 1)} />;

  const trackRows = (tracks: Track[], context: 'queue' | 'favorites' | 'playlist', owner?: Playlist) => tracks.map((track, index) => <div className="track-row" key={`${track.id}-${index}`}>
    <span className="track-index">{String(index + 1).padStart(2, '0')}</span><Artwork track={track} className="track-art" decorative /><div className="track-title"><strong>{track.title}</strong><span>{track.artist || 'Artista desconocido'}</span></div>
    <span className="track-source">{track.source}</span><span className="track-duration">{duration(track.duration)}</span>
    <div className="track-actions">
      {context !== 'queue' && <IconButton label={`Reproducir ${track.title}`} disabled={!!busy || !state} onClick={() => action({ action: 'play', query: track.url })}><Play size={15} /></IconButton>}
      <IconButton label={`${isFavorite(track) ? 'Quitar de' : 'Guardar en'} favoritos: ${track.title}`} active={isFavorite(track)} aria-pressed={isFavorite(track)} disabled={!!busy} onClick={() => toggleFavorite(track)}><Heart size={16} fill={isFavorite(track) ? 'currentColor' : 'none'} /></IconButton>
      {context === 'queue' && <IconButton label={`Guardar ${track.title} en playlist`} disabled={!!busy} onClick={() => setModal({ type: 'save', track })}><Plus size={17} /></IconButton>}
      {context !== 'favorites' && <><IconButton label={`Subir ${track.title}`} disabled={!!busy || index === 0} onClick={() => owner ? reorderPlaylist(owner, index, index - 1) : action({ action: 'move', from: index + 1, to: index })}><ArrowUp size={15} /></IconButton><IconButton label={`Bajar ${track.title}`} disabled={!!busy || index === tracks.length - 1} onClick={() => owner ? reorderPlaylist(owner, index, index + 1) : action({ action: 'move', from: index + 1, to: index + 2 })}><ArrowDown size={15} /></IconButton><IconButton label={`Retirar ${track.title}`} disabled={!!busy} onClick={() => owner ? run('remove-track', async () => { await mutate(`/api/guilds/${guildId}/playlists/${owner.id}/tracks/${track.id}`, 'DELETE'); setLibraryRevision((value) => value + 1); }) : action({ action: 'remove', index: index + 1 })}><X size={16} /></IconButton></>}
    </div>
  </div>);

  return <div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)} />}
    <aside className={cn('sidebar', mobileNav && 'sidebar-open')}>
      <Brand /><span className="sidebar-label">TU ESPACIO</span>
      <nav aria-label="Navegación principal">{navigation.map(({ id, name: itemName, icon: Icon }) => <button key={id} className={cn('nav-item', view === id && 'nav-active')} aria-current={view === id ? 'page' : undefined} onClick={() => { setView(id); setSelectedPlaylist(''); setMobileNav(false); }}><Icon size={19} /><span>{itemName}</span>{id === 'player' && playing && <span className="nav-playing"><i /><i /><i /></span>}</button>)}</nav>
      <div className="sidebar-divider" /><div className="sidebar-library-heading"><span className="sidebar-label">TUS PLAYLISTS</span><IconButton label="Crear playlist" onClick={() => setModal({ type: 'playlist' })} disabled={!guildId}><Plus size={17} /></IconButton></div>
      <div className="sidebar-playlists">{playlists.slice(0, 8).map((item, index) => <button key={item.id} className={cn('playlist-link', selectedPlaylist === item.id && view === 'library' && 'playlist-link-active')} onClick={() => { setSelectedPlaylist(item.id); setView('library'); setMobileNav(false); }}><span className={`playlist-mini playlist-color-${index % 4}`}><ListMusic size={15} /></span><span>{item.name}</span></button>)}{!playlists.length && <p className="sidebar-empty">Tu próxima colección<br />empieza con una canción.</p>}</div>
      <div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={17} /><div><strong>Tu música, en privado</strong><span>Solo tu comunidad.</span></div></div><button className="logout" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}{loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</button></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><IconButton label="Abrir navegación" className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={22} /></IconButton><span className="breadcrumb">Tu espacio <span>/</span> <strong>{navigation.find((item) => item.id === view)?.name}</strong></span></div><div className="topbar-right"><span className={cn('connection-pill', connection === 'live' && guildId ? 'connected' : 'connecting')}><span />{!guildId ? 'Sin servidor' : connection === 'live' ? 'En tiempo real' : connection === 'reconnecting' ? 'Reconectando' : 'Conectando'}</span><div className="user-info"><UserAvatar session={session} /><span>{session.user.username}</span></div></div></header>

      <main className="main-content" id="main-content">
        <div className="page-heading"><div><span className="eyebrow">TU SERVIDOR. TU SOUNDTRACK.</span><h1>{view === 'player' ? 'Dale ritmo al momento.' : view === 'library' ? playlist?.name || 'Hecha a tu ritmo.' : view === 'favorites' ? 'Siempre vuelves a estas.' : 'Todo bajo control.'}</h1></div><div className="guild-picker"><span className="guild-avatar">{guild?.icon ? <img alt="" src={guild.icon} referrerPolicy="no-referrer" /> : <Headphones size={18} />}</span><div><label htmlFor="guild-select">ESCUCHANDO EN</label><select id="guild-select" value={guildId} disabled={guildsLoading || !guilds.length || !!busy} onChange={(event) => { setGuildId(event.target.value); setError(''); }}><option value="" disabled>{guildsLoading ? 'Buscando servidores…' : 'Selecciona un servidor'}</option>{guilds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><ChevronDown size={15} aria-hidden="true" /></div></div>

        {error && <div className="alert alert-error" role="alert"><Activity size={18} /><span>{error}</span><Button variant="ghost" size="sm" onClick={() => { setError(''); void refresh(); setLibraryRevision((value) => value + 1); }}>Reintentar</Button><IconButton label="Cerrar error" onClick={() => setError('')}><X size={16} /></IconButton></div>}
        {!guildId ? <EmptyState icon={<Headphones size={30} />} title={guildsLoading ? 'Buscando tu comunidad…' : 'Tu espacio está casi listo'} text={guildsLoading ? 'Consultando los servidores disponibles.' : 'No hay servidores disponibles para tu cuenta. Comprueba que el bot esté presente y tengas acceso.'} /> : <>
          {view === 'player' && <>
            <form className="search-bar" onSubmit={addToQueue}><Search size={20} /><label className="sr-only" htmlFor="music-search">Buscar canción o pegar enlace</label><input id="music-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="¿Qué escuchamos? Busca una canción o pega un enlace…" maxLength={500} autoComplete="off" /><span className="search-hint">YouTube · Spotify · SoundCloud</span><Button type="submit" aria-label="Agregar a la cola" disabled={!query.trim() || controlsDisabled} size="sm">{busy === 'play' ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}<span>Agregar</span></Button></form>
            <div className="listening-layout"><section className={cn('now-card', !current && 'now-card-idle')} aria-label="Canción actual"><div className="now-card-top"><span className="now-label"><span className={cn('tiny-dot', playing && 'pulse')} /> AHORA SUENA</span><span className="now-number">01 / {String((state?.queue.length || 0) + (current ? 1 : 0)).padStart(2, '0')}</span></div><div className="now-card-body"><div className="hero-art-wrap"><Artwork track={current} className="hero-art" /><span className="hero-art-tag"><AudioLines size={12} /> SONORA SESSION</span></div><div className="now-copy"><span className="track-origin">{current?.source || 'TU ESPACIO MUSICAL'}</span><h2>{current?.title || (state ? 'Un buen momento empieza con una canción.' : 'Afinando tu espacio…')}</h2><p>{current?.artist || 'Agrega algo que te guste y deja que suene.'}</p><div className="hero-status"><span className={cn('status-indicator', playing && 'status-playing')} />{state ? labels[state.status] : 'Sincronizando reproductor'}</div><div className="hero-controls"><Button className="hero-play" onClick={() => action({ action: playing ? 'pause' : 'resume' })} disabled={controlsDisabled || !current}>{busy === 'pause' || busy === 'resume' ? <LoaderCircle size={18} className="spin" /> : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}{state?.status === 'paused' ? 'Continuar' : playing ? 'Pausar' : 'Reproducir'}</Button><IconButton label="Siguiente canción" disabled={controlsDisabled || !current || state?.status === 'blocked'} onClick={() => action({ action: 'skip' })}><SkipForward size={22} /></IconButton><IconButton label="Guardar canción actual en favoritos" active={!!current && isFavorite(current)} aria-pressed={!!current && isFavorite(current)} disabled={!current || !!busy} onClick={() => current && toggleFavorite(current)}><Heart size={21} fill={current && isFavorite(current) ? 'currentColor' : 'none'} /></IconButton>{current && <IconButton label="Guardar canción actual en playlist" disabled={!!busy} onClick={() => setModal({ type: 'save', track: current })}><Plus size={21} /></IconButton>}</div></div></div><div className="now-card-footer"><div><Headphones size={14} /><span>{state?.voice?.name || 'Sin conexión de voz'}</span></div><span>{state?.voice ? `${state.voice.members} en el canal` : 'Conéctate desde Discord'}</span></div></section>
              <aside className="session-card"><span className="eyebrow">MEJOR EN COMPAÑÍA</span><div className="session-disc"><Disc3 size={52} strokeWidth={1.1} /><span className="session-spark">✦</span></div><h3>La música nos<br />encuentra aquí.</h3><p>Una cola compartida.<br />Mil formas de sentirla.</p><div className="session-status"><span className="tiny-dot" /><span>{state?.voice ? 'Sesión de escucha activa' : 'Listo para tu próxima sesión'}</span></div></aside></div>
            <div className="mobile-playback-tools">
              <IconButton label="Detener reproducción" disabled={controlsDisabled || !current} onClick={() => action({ action: 'stop' })}><Square size={16} /></IconButton>
              <IconButton label={`Repetición: ${state?.repeat === 1 ? 'canción' : state?.repeat === 2 ? 'cola' : 'desactivada'}. Cambiar modo`} active={!!state?.repeat} disabled={controlsDisabled} onClick={() => action({ action: 'repeat', mode: ((state?.repeat || 0) + 1) % 3 })}><Repeat size={17} />{state?.repeat === 1 && <span className="repeat-one">1</span>}</IconButton>
              {current && <IconButton label="Guardar canción actual en playlist" disabled={!!busy} onClick={() => setModal({ type: 'save', track: current })}><Plus size={18} /></IconButton>}
              <label htmlFor="mobile-volume"><Volume2 size={15} /><span className="sr-only">Volumen</span></label>
              <input id="mobile-volume" type="range" min="0" max="100" value={volumeDraft ?? state?.volume ?? 50} disabled={controlsDisabled} onChange={(event) => setVolumeDraft(Number(event.target.value))} onPointerUp={(event) => void action({ action: 'volume', volume: Number(event.currentTarget.value) }).finally(() => setVolumeDraft(null))} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void action({ action: 'volume', volume: Number(event.currentTarget.value) }).finally(() => setVolumeDraft(null)); }} />
              <span>{volumeDraft ?? state?.volume ?? 50}%</span>
            </div>
            <div className="queue-layout"><section className="queue-section"><div className="section-heading"><div><h2>A continuación <span className="count-badge">{state?.queue.length || 0}</span></h2><p>{state?.queue.length ? `${state.queue.length} canciones · ${duration(queueDuration)} de buena música` : 'El siguiente descubrimiento puede ser tuyo.'}</p></div><Button variant="secondary" size="sm" disabled={controlsDisabled || (state?.queue.length || 0) < 2} onClick={() => action({ action: 'shuffle' })}><Shuffle size={14} /> Mezclar</Button></div>{!state ? <div className="queue-loading" role="status"><LoaderCircle className="spin" size={19} /> Sincronizando la cola…</div> : state.queue.length ? <div className="track-list"><div className="track-list-heading"><span>#</span><span>CANCIÓN</span><span>FUENTE</span><span><CircleHelp size={12} /> DURACIÓN</span></div>{trackRows(state.queue, 'queue')}</div> : <div className="queue-empty"><ListMusic size={28} strokeWidth={1.4} /><h3>Hay espacio para una más.</h3><p>Busca tu próxima canción o carga una playlist de tu biblioteca.</p><Button variant="secondary" size="sm" onClick={() => document.getElementById('music-search')?.focus()}><Plus size={14} /> Agregar música</Button></div>}</section>
              <aside className="connection-card"><div className="connection-card-title"><Radio size={17} /><h3>Tu sesión</h3><span className={cn('status-indicator', connection === 'live' && 'status-playing')} /></div><dl><div><dt>Canal de voz</dt><dd>{state?.voice?.name || 'Desconectado'}</dd></div><div><dt>Reproductor</dt><dd>{state ? labels[state.status] : 'Sincronizando'}</dd></div><div><dt>Actualizaciones</dt><dd>{connection === 'live' ? 'En tiempo real' : 'Reconectando…'}</dd></div></dl><button className="text-link" onClick={() => setView('diagnostics')}>Ver diagnóstico <ArrowRight size={14} /></button></aside></div>
          </>}

          {view === 'library' && <section className="library-view"><div className="section-heading"><div>{playlist ? <Button variant="ghost" size="sm" onClick={() => setSelectedPlaylist('')}><ArrowLeft size={15} /> Todas las playlists</Button> : <p>Las canciones que merecen quedarse.</p>}</div><div className="heading-actions">{playlist ? <><IconButton label="Renombrar playlist" disabled={!!busy} onClick={() => setModal({ type: 'playlist', playlist })}><Pencil size={17} /></IconButton><IconButton label="Eliminar playlist" disabled={!!busy} onClick={() => setModal({ type: 'delete', playlist })}><Trash2 size={17} /></IconButton><Button variant="secondary" size="sm" disabled={!!busy} onClick={() => setModal({ type: 'add', playlist })}><Plus size={16} /> Agregar canción</Button><Button size="sm" disabled={!!busy || !playlist.tracks.length || !state} onClick={() => loadPlaylist(playlist)}><Play size={15} fill="currentColor" /> Escuchar</Button></> : <Button size="sm" onClick={() => setModal({ type: 'playlist' })} disabled={!!busy}><Plus size={16} /> Nueva playlist</Button>}</div></div>
            {libraryLoading ? <Loading text="Abriendo tu biblioteca…" /> : playlist ? <><div className="playlist-detail"><div className="playlist-detail-art"><ListMusic size={52} strokeWidth={1.2} /></div><div><span className="eyebrow">TU COLECCIÓN</span><h2>{playlist.name}</h2><p>{playlist.tracks.length} canciones · {duration(playlist.tracks.reduce((sum, track) => sum + track.duration, 0))}</p></div></div>{playlist.tracks.length ? <div className="track-list">{trackRows(playlist.tracks, 'playlist', playlist)}</div> : <EmptyState icon={<Music2 size={30} />} title="Una playlist llena de posibilidades" text="Agrega un enlace o guarda canciones desde el reproductor y la cola." />}</> : playlists.length ? <div className="playlist-grid">{playlists.map((item, index) => <button key={item.id} className="playlist-card" onClick={() => setSelectedPlaylist(item.id)}><div className={`playlist-cover playlist-color-${index % 4}`}><ListMusic size={62} strokeWidth={1.1} /><span>{String(index + 1).padStart(2, '0')}</span><div className="playlist-cover-play"><Play size={19} fill="currentColor" /></div></div><h3>{item.name}</h3><p>{item.tracks.length} canciones <span>•</span> Tu colección</p></button>)}<button className="playlist-new" onClick={() => setModal({ type: 'playlist' })}><span><Plus size={27} /></span><strong>Crea tu próxima playlist</strong><p>Para cada versión de ti.</p></button></div> : <EmptyState icon={<Library size={30} />} title="Tu próximo soundtrack empieza aquí" text="Crea una playlist y guarda las canciones que quieras volver a escuchar." action={<Button onClick={() => setModal({ type: 'playlist' })}><Plus size={16} /> Crear mi primera playlist</Button>} />}
          </section>}

          {view === 'favorites' && <section className="favorites-view"><div className="favorites-banner"><div className="favorite-art"><Heart size={43} fill="currentColor" strokeWidth={1} /></div><div><span className="eyebrow">EN REPEAT, EN TU CORAZÓN</span><h2>Tus favoritas</h2><p>{favorites.length} canciones que se quedan contigo.</p></div></div>{libraryLoading ? <Loading text="Buscando tus favoritas…" /> : favorites.length ? <div className="track-list">{trackRows(favorites, 'favorites')}</div> : <EmptyState icon={<Heart size={30} />} title="Aquí viven tus próximas favoritas" text="Toca el corazón junto a una canción para guardarla en este espacio." />}</section>}

          {view === 'diagnostics' && <Diagnostics state={state} connection={connection} refresh={() => void refresh()} />}
        </>}
        <footer className="content-footer"><span><AudioLines size={13} /> HECHO PARA ESCUCHAR JUNTOS.</span><span>SONORA <span className="tiny-dot" /> TU ESPACIO MUSICAL</span></footer>
      </main>
    </div>

    <footer className="persistent-player" aria-label="Controles de reproducción"><div className="player-track"><Artwork track={current} className="player-art" decorative /><div><strong>{current?.title || 'Tu próxima canción te espera'}</strong><span>{current?.artist || 'Dale play a tu servidor'}</span></div><IconButton label="Guardar en favoritos" active={!!current && isFavorite(current)} aria-pressed={!!current && isFavorite(current)} disabled={!current || !!busy} onClick={() => current && toggleFavorite(current)}><Heart size={17} fill={current && isFavorite(current) ? 'currentColor' : 'none'} /></IconButton></div><div className="player-center"><div className="player-buttons"><IconButton label="Mezclar cola" disabled={controlsDisabled || (state?.queue.length || 0) < 2} onClick={() => action({ action: 'shuffle' })}><Shuffle size={17} /></IconButton><IconButton label="Detener reproducción" disabled={controlsDisabled || !current} onClick={() => action({ action: 'stop' })}><Square size={16} /></IconButton><Button className="player-main-button" size="icon" aria-label={playing ? 'Pausar reproducción' : 'Continuar reproducción'} disabled={controlsDisabled || !current} onClick={() => action({ action: playing ? 'pause' : 'resume' })}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</Button><IconButton label="Siguiente canción" disabled={controlsDisabled || !current || state?.status === 'blocked'} onClick={() => action({ action: 'skip' })}><SkipForward size={19} fill="currentColor" /></IconButton><IconButton label={`Repetición: ${state?.repeat === 1 ? 'canción' : state?.repeat === 2 ? 'cola' : 'desactivada'}. Cambiar modo`} active={!!state?.repeat} disabled={controlsDisabled} onClick={() => action({ action: 'repeat', mode: ((state?.repeat || 0) + 1) % 3 })}><Repeat size={17} />{state?.repeat === 1 && <span className="repeat-one">1</span>}</IconButton></div><div className="player-progress"><span>{duration(state?.currentTime || 0)}</span><div className="progress-track" role="progressbar" aria-label="Progreso de la canción" aria-valuemin={0} aria-valuemax={current?.duration || 0} aria-valuenow={Math.floor(state?.currentTime || 0)}><div style={{ width: `${progress}%` }} /></div><span>{duration(current?.duration || 0)}</span></div></div><div className="player-volume"><IconButton label="Ver cola musical" onClick={() => setView('player')}><ListMusic size={18} /></IconButton><span className="volume-divider" /><Volume2 size={18} /><label className="sr-only" htmlFor="volume">Volumen</label><input id="volume" type="range" min="0" max="100" step="1" value={volumeDraft ?? state?.volume ?? 50} disabled={controlsDisabled} onChange={(event) => setVolumeDraft(Number(event.target.value))} onPointerUp={(event) => { const value = Number(event.currentTarget.value); void action({ action: 'volume', volume: value }).finally(() => setVolumeDraft(null)); }} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void action({ action: 'volume', volume: Number(event.currentTarget.value) }).finally(() => setVolumeDraft(null)); }} style={{ '--volume': `${volumeDraft ?? state?.volume ?? 50}%` } as React.CSSProperties} /><span className="volume-value">{volumeDraft ?? state?.volume ?? 50}%</span></div></footer>

    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    <Dialog open={!!modal} onOpenChange={(open) => { if (!open && !busy) setModal(null); }} title={modal?.type === 'delete' ? 'Eliminar playlist' : modal?.type === 'save' ? 'Guardar en una playlist' : modal?.type === 'add' ? 'Agregar a tu colección' : modal?.playlist ? 'Dale un nuevo nombre' : 'Una playlist, un mood.'} description={modal?.type === 'delete' ? `Se eliminará «${modal.playlist.name}» y su colección de canciones.` : modal?.type === 'save' ? `Guarda «${modal.track.title}» para volver a escucharla.` : modal?.type === 'add' ? 'Pega el enlace original de YouTube, Spotify, SoundCloud o Apple Music.' : 'Ponle un nombre que te haga querer darle play.'}>
      <form className="modal-form" onSubmit={submitModal}>{modal?.type === 'playlist' && <label>Nombre de la playlist<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Por ejemplo, Después de medianoche" required autoFocus /></label>}{modal?.type === 'save' && (playlists.length ? <label>Playlist<select value={targetPlaylist} onChange={(event) => setTargetPlaylist(event.target.value)} required>{playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <div className="no-playlist"><p>Primero necesitas crear una playlist.</p><Button variant="secondary" type="button" onClick={() => setModal({ type: 'playlist' })}><Plus size={16} /> Crear playlist</Button></div>)}{modal?.type === 'add' && <><label>Enlace de la canción<input type="url" value={trackUrl} onChange={(event) => setTrackUrl(event.target.value)} required maxLength={2000} placeholder="https://www.youtube.com/watch?v=…" autoFocus /></label><label>Título<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={300} placeholder="Nombre de la canción" /></label><label>Artista <span className="muted">(opcional)</span><input value={trackArtist} onChange={(event) => setTrackArtist(event.target.value)} maxLength={300} placeholder="Nombre del artista" /></label><p className="form-help">También puedes guardar canciones con sus metadatos directamente desde el reproductor.</p></>}{error && <p className="modal-error" role="alert">{error}</p>}<div className="modal-actions"><Button variant="secondary" type="button" disabled={!!busy} onClick={() => setModal(null)}>Cancelar</Button><Button variant={modal?.type === 'delete' ? 'destructive' : 'default'} type="submit" disabled={!!busy || (modal?.type === 'save' && !targetPlaylist) || ((modal?.type === 'playlist' || modal?.type === 'add') && !name.trim())}>{busy === 'save' && <LoaderCircle className="spin" size={16} />}{modal?.type === 'delete' ? 'Eliminar playlist' : 'Guardar'}</Button></div></form>
    </Dialog>
  </div>;
}

function Loading({ text }: { text: string }) { return <div className="loading-block" role="status"><LoaderCircle size={22} className="spin" />{text}</div>; }
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{text}</p>{action}</div>; }

function Diagnostics({ state, connection, refresh }: { state: PlaybackSnapshot | null; connection: string; refresh: () => void }) {
  const healthEntries = healthRows(state?.health || {});
  const rawPreload = state?.health.preload;
  const preloadEntries = rawPreload && typeof rawPreload === 'object' && !Array.isArray(rawPreload) ? healthRows(rawPreload as Record<string, unknown>) : [];
  return <section className="diagnostics-view"><div className="section-heading"><p>Una mirada a lo que mantiene la música sonando.</p><Button variant="secondary" size="sm" onClick={refresh}><RefreshCw size={14} /> Actualizar estado</Button></div><div className="diagnostics-grid"><div className="diagnostic-card"><span className="diagnostic-icon"><Wifi size={23} /></span><span className="eyebrow">CONEXIÓN EN VIVO</span><h3>{connection === 'live' ? 'Sincronizada' : connection === 'reconnecting' ? 'Reconectando' : 'Conectando'}</h3><p>{connection === 'live' ? 'La cola y el reproductor están actualizados.' : 'La conexión se restablece automáticamente.'}</p></div><div className="diagnostic-card"><span className="diagnostic-icon"><Headphones size={23} /></span><span className="eyebrow">CANAL DE VOZ</span><h3>{state?.voice?.name || 'Desconectado'}</h3><p>{state?.voice ? `${state.voice.members} miembros en el canal.` : 'Únete a un canal de Discord para iniciar una sesión.'}</p></div><div className="diagnostic-card"><span className="diagnostic-icon"><ShieldCheck size={23} /></span><span className="eyebrow">ESTADO DEL MOTOR</span><h3>{state ? labels[state.status] : 'Sincronizando'}</h3><p>{state?.status === 'recovering' ? 'El bot está intentando recuperar el audio.' : state?.status === 'blocked' ? 'Revisa los incidentes para conocer el bloqueo.' : 'Las protecciones del reproductor siguen activas.'}</p></div></div><div className="diagnostic-details"><h2>Salud del reproductor</h2>{healthEntries.length ? <dl className="health-list">{healthEntries.map(({ key, label, value }) => <div key={key}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className="muted">{state ? 'El motor no reportó métricas adicionales en esta sesión.' : 'Esperando el estado del motor…'}</p>}</div>{preloadEntries.length > 0 && <div className="diagnostic-details"><h2>Precarga de audio</h2><dl className="health-list">{preloadEntries.map(({ key, label, value }) => <div key={key}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>}<div className="incident-section"><div className="section-heading"><h2>Últimos incidentes <span className="count-badge">{state?.incidents.length || 0}</span></h2><Activity size={18} className="muted" /></div>{state?.incidents.length ? <div className="incident-list">{state.incidents.map((incident, index) => <article key={`${incident.at}-${index}`}><span className="incident-dot" /><div><strong>{incident.code}</strong><p>{incident.message}</p></div><time dateTime={incident.at}>{new Date(incident.at).toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></article>)}</div> : <div className="all-good"><ShieldCheck size={27} /><div><h3>Todo en armonía.</h3><p>No hay incidentes registrados en el estado actual.</p></div></div>}</div><p className="diagnostic-note"><ExternalLink size={13} /> Para usar los controles debes estar en el canal de voz autorizado del servidor.</p></section>;
}
