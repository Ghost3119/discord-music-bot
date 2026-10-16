import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../features/auth/use-session';
import { useLibrary } from '../features/library/use-library';
import { api, type MusicAction } from '../lib/api';
import { AbandonedOperation, createOperationScope } from '../lib/operation-scope';
import type { View } from '../types/app';
import { usePlayback } from './use-playback';

/** Coordinates the session, music transport and collection feature without a global store. */
export function useSonoraApp() {
  const [view, setView] = useState<View>('player');
  const [mobileNav, setMobileNav] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [query, setQuery] = useState('');
  const selectedGuildRef = useRef('');
  const operationScope = useRef(createOperationScope());
  const runningOperation = useRef(0);

  const invalidateOperations = useCallback(() => {
    operationScope.current.invalidate();
    runningOperation.current++;
    setBusy('');
  }, []);
  const auth = useSession({ onError: setError, onExpire: invalidateOperations });
  const { session, guildId, setGuildId, reportError } = auth;
  selectedGuildRef.current = guildId;
  const { state, connection, refresh } = usePlayback(session ? guildId : '', reportError);

  async function run(key: string, task: () => Promise<void>) {
    if (busy || loggingOut) return;
    const operation = ++runningOperation.current;
    setBusy(key);
    setError('');
    try {
      await task();
    } catch (problem) {
      if (!(problem instanceof AbandonedOperation)) reportError(problem);
    } finally {
      if (operation === runningOperation.current) setBusy('');
    }
  }

  async function mutate(path: string, method: string, data?: unknown) {
    if (!session) return;
    await operationScope.current.run(() => api(path, {
      method,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }, session.csrfToken));
  }

  const library = useLibrary({ guildId, session, reportError, run, mutate, setNotice, setView, refresh });

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  useEffect(() => { setVolumeDraft(null); }, [state?.volume, guildId]);

  async function logout() {
    if (!session || loggingOut) return;
    const previousGuild = guildId;
    setLoggingOut(true);
    setError('');
    setNotice('');
    invalidateOperations();
    // Close SSE immediately; logout can cancel a long-running backend operation.
    setGuildId('');
    try {
      await api('/auth/logout', { method: 'POST' }, session.csrfToken);
      auth.completeLogout();
      library.clearLibrary();
      setBusy('');
    } catch (problem) {
      setGuildId(previousGuild);
      reportError(problem);
    } finally {
      setLoggingOut(false);
    }
  }

  function action(command: MusicAction) {
    const originGuild = guildId;
    return run(command.action, async () => {
      await mutate(`/api/guilds/${originGuild}/actions`, 'POST', command);
      if (originGuild === selectedGuildRef.current) await refresh();
    });
  }

  async function addToQueue(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    const text = query.trim();
    await run('play', async () => {
      await mutate(`/api/guilds/${guildId}/actions`, 'POST', { action: 'play', query: text });
      setQuery('');
      setNotice('Canción enviada a la cola.');
      await refresh();
    });
  }

  const current = state?.current;
  return {
    session, authLoading: auth.authLoading, authError: auth.authError, retryAuth: auth.retryAuth,
    guilds: auth.guilds, guildId, setGuildId, guildsLoading: auth.guildsLoading,
    guild: auth.guilds.find((item) => item.id === guildId),
    view, setView, mobileNav, setMobileNav, error, setError, notice, busy, loggingOut, logout,
    state, connection, refresh, current, controlsDisabled: !!busy || loggingOut || !state,
    playing: state?.status === 'playing',
    progress: current?.duration ? Math.min(100, Math.max(0, (state!.currentTime / current.duration) * 100)) : 0,
    queueDuration: state?.queue.reduce((sum, track) => sum + track.duration, 0) || 0,
    volumeDraft, setVolumeDraft, action, query, setQuery, addToQueue,
    ...library,
  };
}
