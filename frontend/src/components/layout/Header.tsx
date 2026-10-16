import { Menu } from 'lucide-react';
import { IconButton } from '../common/IconButton';
import { UserAvatar } from '../../features/auth/UserAvatar';
import { navigation } from './Sidebar';
import { cn } from '../../lib/utils';
import type { Session } from '../../lib/api';
import type { View } from '../../types/app';

export interface HeaderProps {
  session: Session;
  view: View;
  guildId: string;
  connection: string;
  onOpenNavigation: () => void;
}

export function Header({ session, view, guildId, connection, onOpenNavigation }: HeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <IconButton label="Abrir navegación" className="mobile-menu" onClick={onOpenNavigation}>
          <Menu size={22} />
        </IconButton>
        <span className="breadcrumb">
          Tu espacio <span>/</span> <strong>{navigation.find((item) => item.id === view)?.name}</strong>
        </span>
      </div>
      <div className="topbar-right">
        <span
          className={cn('connection-pill', connection === 'live' && guildId ? 'connected' : 'connecting')}
        >
          <span />
          {!guildId
            ? 'Sin servidor'
            : connection === 'live'
              ? 'En tiempo real'
              : connection === 'reconnecting'
                ? 'Reconectando'
                : 'Conectando'}
        </span>
        <div className="user-info">
          <UserAvatar session={session} />
          <span>{session.user.username}</span>
        </div>
      </div>
    </header>
  );
}
