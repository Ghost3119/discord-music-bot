import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, trackMetadata } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());
describe('dashboard API client', () => {
  it('sends same-origin credentials and CSRF token for mutations', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await api('/api/guilds/1/actions', { method: 'POST', body: JSON.stringify({ action: 'pause' }) }, 'csrf-test');
    const options = fetch.mock.calls[0][1];
    expect(options.credentials).toBe('same-origin');
    expect(options.headers.get('x-csrf-token')).toBe('csrf-test');
    expect(options.headers.get('content-type')).toBe('application/json');
  });
  it('preserves server messages and HTTP status for session expiry handling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Tu sesión expiró.' }), { status: 401 })));
    await expect(api('/api/session')).rejects.toMatchObject({ status: 401, message: 'Tu sesión expiró.' });
    await expect(api('/api/session')).rejects.toBeInstanceOf(ApiError);
  });
  it('supports an empty success response and excludes ephemeral IDs from saved metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api('/auth/logout', { method: 'POST' }, 'csrf-test')).resolves.toBeUndefined();
    expect(trackMetadata({ id: 'queue-ephemeral-id', url: 'https://youtu.be/test', title: 'Canción', artist: 'Artista', duration: 180, thumbnail: null, source: 'youtube' })).toEqual({ url: 'https://youtu.be/test', title: 'Canción', artist: 'Artista', duration: 180, thumbnail: null, source: 'youtube' });
  });
});
