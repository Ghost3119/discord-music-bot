import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../src/features/auth/use-session';
import { useLibrary } from '../src/features/library/use-library';
import { usePlayback } from '../src/hooks/use-playback';
import { useSonoraApp } from '../src/hooks/use-sonora-app';
import { api, ApiError } from '../src/lib/api';
import { session, snapshot } from './regression-fixtures';

// These tests isolate command policy. They do not simulate React mounting/effects;
// the stream lifecycle has its own tests and the real UI is checked in the preview.
vi.mock('react', () => ({
  useState: <T>(initial: T) => [initial, vi.fn()],
  useRef: <T>(initial: T) => ({ current: initial }),
  useCallback: <T>(callback: T) => callback,
  useEffect: vi.fn(),
}));
vi.mock('../src/features/auth/use-session', () => ({ useSession: vi.fn() }));
vi.mock('../src/features/library/use-library', () => ({ useLibrary: vi.fn() }));
vi.mock('../src/hooks/use-playback', () => ({ usePlayback: vi.fn() }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), api: vi.fn() }));

function commandHarness(state = snapshot()) {
  const reportError = vi.fn();
  const setGuildId = vi.fn();
  const completeLogout = vi.fn();
  const clearLibrary = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useSession).mockReturnValue({ session, guildId: 'guild-a', guilds: [{ id: 'guild-a', name: 'Comunidad', icon: null }], authLoading: false, authError: '', guildsLoading: false, retryAuth: vi.fn(), setGuildId, reportError, completeLogout });
  vi.mocked(usePlayback).mockReturnValue({ state, connection: 'live', refresh });
  vi.mocked(useLibrary).mockReturnValue({ clearLibrary: () => { clearLibrary(); } } as ReturnType<typeof useLibrary>);
  return { app: useSonoraApp(), reportError, setGuildId, completeLogout, clearLibrary, refresh };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(api).mockResolvedValue(undefined); });

describe('extracted application command contracts', () => {
  it('uses the existing action endpoint, JSON command and session CSRF token', async () => {
    const { app, refresh } = commandHarness();
    await app.action({ action: 'move', from: 2, to: 1 });
    expect(api).toHaveBeenCalledWith('/api/guilds/guild-a/actions', { method: 'POST', body: '{"action":"move","from":2,"to":1}' }, 'csrf-fixture');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports server permission revocation without refreshing as if a command succeeded', async () => {
    const { app, reportError, refresh } = commandHarness();
    const forbidden = new ApiError('Ya no tienes acceso a este servidor.', 403);
    vi.mocked(api).mockRejectedValueOnce(forbidden);
    await app.action({ action: 'pause' });
    expect(reportError).toHaveBeenCalledWith(forbidden);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('invalidates an in-flight music continuation immediately when logout starts', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { app, setGuildId, completeLogout, clearLibrary, refresh, reportError } = commandHarness();
    vi.mocked(api).mockImplementation((path) => path === '/auth/logout' ? Promise.resolve(undefined) : pending);
    const command = app.action({ action: 'play', query: 'Una canción' });
    const logout = app.logout();
    expect(setGuildId).toHaveBeenCalledWith('');
    await logout;
    expect(api).toHaveBeenCalledWith('/auth/logout', { method: 'POST' }, 'csrf-fixture');
    expect(completeLogout).toHaveBeenCalledTimes(1);
    expect(clearLibrary).toHaveBeenCalledTimes(1);
    finish(undefined);
    await command;
    expect(refresh).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('restores the selected guild and reports a failed logout', async () => {
    const { app, setGuildId, completeLogout, clearLibrary, reportError } = commandHarness();
    const unavailable = new ApiError('Servidor no disponible.', 503);
    vi.mocked(api).mockRejectedValueOnce(unavailable);
    await app.logout();
    expect(setGuildId.mock.calls.map(([id]) => id)).toEqual(['', 'guild-a']);
    expect(reportError).toHaveBeenCalledWith(unavailable);
    expect(completeLogout).not.toHaveBeenCalled();
    expect(clearLibrary).not.toHaveBeenCalled();
  });

});
