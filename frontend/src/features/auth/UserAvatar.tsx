import type { Session } from '../../lib/api';

export interface UserAvatarProps {
  session: Session;
}

export function UserAvatar({ session }: UserAvatarProps) {
  const avatar = session.user.avatar;
  let url: string | null = null;
  if (avatar && /^\d{17,20}$/.test(session.user.id)) {
    const candidate = /^[a-zA-Z0-9_]+$/.test(avatar) ? `https://cdn.discordapp.com/avatars/${session.user.id}/${avatar}.png?size=64` : avatar;
    try {
      const parsed = new URL(candidate);
      if (parsed.origin === 'https://cdn.discordapp.com' && !parsed.username && !parsed.password && new RegExp(`^/avatars/${session.user.id}/[a-zA-Z0-9_]+\\.png$`).test(parsed.pathname)) url = parsed.href;
    } catch { /* Untrusted profile data uses the initial fallback. */ }
  }
  return (
    <span className="user-avatar">
      {url ? (
        <img alt="" src={url} referrerPolicy="no-referrer" />
      ) : (
        session.user.username.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
