import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../src/components/layout/Sidebar';
import { Artwork } from '../src/components/artwork';
import { UserAvatar } from '../src/features/auth/UserAvatar';
import { track } from './regression-fixtures';

describe('untrusted profile and permission projections', () => {
  it('hides diagnostics and disables library creation without an explicit grant', () => {
    const html = renderToStaticMarkup(<Sidebar mobileNav={false} view="player" playing={false} guildId="guild" playlists={[]} selectedPlaylist="" loggingOut={false} onCloseNavigation={vi.fn()} onNavigate={vi.fn()} onOpenPlaylist={vi.fn()} onCreatePlaylist={vi.fn()} onLogout={vi.fn()} />);
    expect(html).not.toContain('Diagnóstico');
    expect(html).toMatch(/aria-label="Crear playlist" disabled/);
  });
  it('never renders an untrusted artwork origin', () => {
    expect(renderToStaticMarkup(<Artwork track={track('AAAAAAAAAAA', { thumbnail: 'https://attacker.test/cover.jpg' })} />)).not.toContain('<img');
    expect(renderToStaticMarkup(<Artwork track={track('AAAAAAAAAAA', { thumbnail: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg' })} />)).toContain('<img');
  });
  it('only uses a Discord avatar for the authenticated user', () => {
    const session = { user: { id: '111111111111111111', username: 'Fixture', avatar: 'https://attacker.test/avatar.png' }, csrfToken: 'fixture' };
    expect(renderToStaticMarkup(<UserAvatar session={session} />)).not.toContain('<img');
    session.user.avatar = 'https://cdn.discordapp.com/avatars/222222222222222222/hash.png';
    expect(renderToStaticMarkup(<UserAvatar session={session} />)).not.toContain('<img');
    session.user.avatar = 'https://cdn.discordapp.com/avatars/111111111111111111/hash.png?size=128';
    expect(renderToStaticMarkup(<UserAvatar session={session} />)).toContain('<img');
  });
});
