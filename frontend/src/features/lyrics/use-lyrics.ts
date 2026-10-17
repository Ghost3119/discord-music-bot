import { useEffect, useRef, useState } from 'react';
import type { LyricsCurrentResponse } from '../../../../src/web/lyrics/contracts';
import type { PlaybackSnapshot } from '../../lib/api';
import { api, ApiError } from '../../lib/api';
import { clearManualLyrics, useManualLyrics } from './manual-lyrics';

type Identity = { key: string; guildId: string; trackId: string; playbackId: string | null };
type QueryState = { key: string; data: LyricsCurrentResponse | null; error: string; status: 'loading' | 'ready' | 'error' | 'stale'; retryAt: number };
type Flight = { promise: Promise<LyricsCurrentResponse>; controller: AbortController; users: number; abortTimer?: ReturnType<typeof setTimeout> };
const cache = new Map<string, { data: LyricsCurrentResponse; expires: number }>();
const flights = new Map<string, Flight>();
const MAX_CACHE = 24;
const MAX_FLIGHTS = 8;
export function clearLyricsCache() { cache.clear(); }

function identity(snapshot: PlaybackSnapshot | null): Identity | null {
  if (!snapshot?.current) return null;
  const playbackId = snapshot.playbackId ?? null;
  return { key: JSON.stringify([snapshot.guildId, snapshot.current.id, playbackId]), guildId: snapshot.guildId, trackId: snapshot.current.id, playbackId };
}
function matches(data: LyricsCurrentResponse, target: Identity): boolean {
  return data.guildId === target.guildId && data.trackId === target.trackId && data.playbackId === target.playbackId;
}
function store(target: Identity, data: LyricsCurrentResponse) {
  if (data.status === 'stale' || data.status === 'idle' || data.status === 'temporary_error') return;
  const ttl = data.status === 'not_found' || data.status === 'ambiguous' ? 30_000 : 120_000;
  cache.delete(target.key);
  cache.set(target.key, { data, expires: Date.now() + ttl });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
}
function acquire(target: Identity) {
  let flight = flights.get(target.key);
  if (!flight) {
    if (flights.size >= MAX_FLIGHTS) throw new Error('Espera a que termine la consulta de letras.');
    const controller = new AbortController();
    flight = { controller, users: 0, promise: api<LyricsCurrentResponse>(`/api/guilds/${encodeURIComponent(target.guildId)}/lyrics/current`, { signal: controller.signal }) };
    flights.set(target.key, flight);
    const request = flight;
    void request.promise.finally(() => {
      if (flights.get(target.key) === request) flights.delete(target.key);
    }).catch(() => {});
  }
  clearTimeout(flight.abortTimer);
  flight.users += 1;
  const request = flight;
  return {
    promise: request.promise,
    release() {
      request.users -= 1;
      if (request.users === 0) {
        // One turn lets React StrictMode immediately reacquire the same request.
        request.abortTimer = setTimeout(() => {
          if (request.users === 0) {
            request.controller.abort();
            if (flights.get(target.key) === request) flights.delete(target.key);
          }
        }, 0);
      }
    },
  };
}

/** The current playback is the only query input; lyrics never own an SSE connection. */
export function useLyrics(snapshot: PlaybackSnapshot | null, enabled = true) {
  const manual = useManualLyrics(snapshot, enabled);
  const target = identity(snapshot);
  const key = target?.key ?? '';
  const [query, setQuery] = useState<QueryState | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const retryGate = useRef({ key: '', at: 0 });
  useEffect(() => {
    if (!enabled || !target || manual) return;
    let live = true;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      setQuery({ key, data: cached.data, error: '', status: 'ready', retryAt: 0 });
      return;
    }
    cache.delete(key);
    setQuery({ key, data: null, error: '', status: 'loading', retryAt: 0 });
    let request: ReturnType<typeof acquire>;
    try { request = acquire(target); }
    catch (error) {
      setQuery({ key, data: null, error: (error as Error).message, status: 'error', retryAt: Date.now() + 2000 });
      return;
    }
    void request.promise.then((data) => {
      if (!live) return;
      if (!data || !matches(data, target) || data.status === 'stale' || data.status === 'idle') {
        retryGate.current = { key, at: Date.now() + 1000 };
        setQuery({ key, data: null, error: '', status: 'stale', retryAt: retryGate.current.at });
        return;
      }
      store(target, data);
      const retryAt = data.status === 'temporary_error' ? Date.now() + Math.min(2_147_483_647, Math.max(1000, data.retryAfterMs)) : 0;
      retryGate.current = { key, at: retryAt };
      setQuery({ key, data, error: '', status: 'ready', retryAt });
    }).catch((error: unknown) => {
      if (!live || request && (error as Error)?.name === 'AbortError') return;
      const denied = error instanceof ApiError && (error.status === 401 || error.status === 403);
      if (denied) { cache.clear(); clearManualLyrics(snapshot); }
      const retryAt = Date.now() + 2000;
      retryGate.current = { key, at: retryAt };
      setQuery({ key, data: null, status: 'error', error: denied ? 'La sesión o el acceso al servidor cambió. Vuelve al dashboard para conectar.' : 'No se pudieron consultar las letras. Puedes volver a intentarlo.', retryAt: denied ? Infinity : retryAt });
    });
    return () => { live = false; request.release(); };
    // Identity, rather than every two-second snapshot, owns the request lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, revision, manual]);

  const current = enabled && query?.key === key ? query : null;
  const retryAt = current?.retryAt ?? 0;
  useEffect(() => {
    if (!enabled || !Number.isFinite(retryAt) || retryAt <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), retryAt - Date.now() + 5);
    return () => clearTimeout(timer);
  }, [enabled, retryAt]);
  const canRetry = !!target && !!current && current.status !== 'loading' && retryAt !== Infinity && Math.max(now, Date.now()) >= retryAt;
  const retry = () => {
    if (!target || !canRetry || retryGate.current.key === key && Date.now() < retryGate.current.at) return;
    retryGate.current = { key, at: Date.now() + 1000 };
    cache.delete(key);
    setQuery({ key, data: null, error: '', status: 'loading', retryAt: 0 });
    setRevision((value) => value + 1);
  };
  return { status: !enabled || !target ? 'idle' as const : manual ? 'ready' as const : current?.status ?? 'loading' as const, data: enabled ? manual ?? current?.data ?? null : null, error: manual ? '' : current?.error ?? '', canRetry: !manual && canRetry, retry };
}
