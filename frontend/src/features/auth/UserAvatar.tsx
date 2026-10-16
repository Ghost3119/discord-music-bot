import type { Session } from '../../lib/api';

export interface UserAvatarProps {
  session: Session;
}

export function UserAvatar({ session }: UserAvatarProps) {
  const avatar = session.user.avatar;
  const url =
    avatar &&
    (/^https:\/\//.test(avatar)
      ? avatar
      : `https://cdn.discordapp.com/avatars/${session.user.id}/${avatar}.png?size=64`);
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
