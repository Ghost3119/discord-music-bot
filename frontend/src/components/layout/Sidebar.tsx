import {
  Activity,
  AudioLines,
  Heart,
  Library,
  ListMusic,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { Brand } from '../common/Brand';
import { IconButton } from '../common/IconButton';
import { cn } from '../../lib/utils';
import type { Playlist } from '../../lib/api';
import type { View } from '../../types/app';

export const navigation = [
  { id: 'player', name: 'Ahora suena', icon: AudioLines },
  { id: 'library', name: 'Mi biblioteca', icon: Library },
  { id: 'favorites', name: 'Favoritos', icon: Heart },
  { id: 'diagnostics', name: 'Diagnóstico', icon: Activity },
] as const;

export interface SidebarProps {
  mobileNav: boolean;
  view: View;
  playing: boolean;
  guildId: string;
  playlists: Playlist[];
  selectedPlaylist: string;
  loggingOut: boolean;
  onCloseNavigation: () => void;
  onNavigate: (view: View) => void;
  onOpenPlaylist: (id: string) => void;
  onCreatePlaylist: () => void;
  onLogout: () => void | Promise<void>;
}

export function Sidebar({
  mobileNav,
  view,
  playing,
  guildId,
  playlists,
  selectedPlaylist,
  loggingOut,
  onCloseNavigation,
  onNavigate,
  onOpenPlaylist,
  onCreatePlaylist,
  onLogout,
}: SidebarProps) {
  return (
    <>
      {mobileNav && (
        <button className="nav-backdrop" aria-label="Cerrar navegación" onClick={onCloseNavigation} />
      )}
      <aside className={cn('sidebar', mobileNav && 'sidebar-open')}>
        <Brand />
        <span className="sidebar-label">TU ESPACIO</span>
        <nav aria-label="Navegación principal">
          {navigation.map(({ id, name: itemName, icon: Icon }) => (
            <button
              key={id}
              className={cn('nav-item', view === id && 'nav-active')}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={19} />
              <span>{itemName}</span>
              {id === 'player' && playing && (
                <span className="nav-playing">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-library-heading">
          <span className="sidebar-label">TUS PLAYLISTS</span>
          <IconButton label="Crear playlist" onClick={onCreatePlaylist} disabled={!guildId}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="sidebar-playlists">
          {playlists.slice(0, 8).map((item, index) => (
            <button
              key={item.id}
              className={cn(
                'playlist-link',
                selectedPlaylist === item.id && view === 'library' && 'playlist-link-active',
              )}
              onClick={() => onOpenPlaylist(item.id)}
            >
              <span className={`playlist-mini playlist-color-${index % 4}`}>
                <ListMusic size={15} />
              </span>
              <span>{item.name}</span>
            </button>
          ))}
          {!playlists.length && (
            <p className="sidebar-empty">
              Tu próxima colección
              <br />
              empieza con una canción.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Tu música, en privado</strong>
              <span>Solo tu comunidad.</span>
            </div>
          </div>
          <button className="logout" disabled={loggingOut} onClick={() => void onLogout()}>
            {loggingOut ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}
            {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      </aside>
    </>
  );
}
