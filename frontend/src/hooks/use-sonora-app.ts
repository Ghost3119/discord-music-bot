import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../features/auth/use-session';
import { useLibrary } from '../features/library/use-library';
import { api, type MusicAction } from '../lib/api';
import type { MusicControlResult } from '../../../src/web/contracts';
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
  const runningKey = useRef('');
  const musicRequest = useRef<AbortController | null>(null);

  const invalidateOperations = useCallback(() => {
    operationScope.current.invalidate();
    musicRequest.current?.abort();
    runningKey.current = '';
    runningOperation.current++;
    setBusy('');
  }, []);
  const auth = useSession({ onError: setError, onExpire: invalidateOperations });
  const { session, guildId, setGuildId, reportError } = auth;
  selectedGuildRef.current = guildId;
  const { state, connection, refresh } = usePlayback(session ? guildId : '', reportError);
  useEffect(() => {
    setNotice('');
    return () => { musicRequest.current?.abort(); };
  }, [guildId, session?.user.id]);

  async function run(key: string, task: () => Promise<void>) {
    if (runningKey.current || busy || loggingOut) return;
    const operation = ++runningOperation.current;
    runningKey.current = key;
    setBusy(key);
    setError('');
    try {
      await task();
    } catch (problem) {
      if (!(problem instanceof AbandonedOperation)) reportError(problem);
    } finally {
      if (operation === runningOperation.current) { runningKey.current = ''; setBusy(''); }
    }
  }

  async function mutate(path: string, method: string, data?: unknown) {
    if (!session) return;
    await operationScope.current.run(() =>
      api(
        path,
        {
          method,
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        },
        session.csrfToken,
      ),
    );
  }

  const library = useLibrary({ guildId, session, reportError, run, mutate, setNotice, setView, refresh });

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  useEffect(() => {
    setVolumeDraft(null);
  }, [state?.volume, guildId]);

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
      if (!session) return;
      const controller = new AbortController(); musicRequest.current = controller;
      try {
        const result = await api<MusicControlResult>(`/api/guilds/${originGuild}/actions`, { method: 'POST', body: JSON.stringify(command), signal: controller.signal }, session.csrfToken);
        if (controller.signal.aborted || originGuild !== selectedGuildRef.current) throw new AbandonedOperation();
        await refresh();
        if (controller.signal.aborted || originGuild !== selectedGuildRef.current) throw new AbandonedOperation();
        if (command.action === 'autoplay' && typeof result.autoplay === 'boolean') setNotice(result.autoplay ? 'Radio activada.' : 'Radio desactivada.');
        if (command.action === 'recommend' && typeof result.recommendationsAdded === 'number') setNotice(result.recommendationsAdded ? `Añadidas ${result.recommendationsAdded} recomendaciones a la cola.` : 'No encontramos recomendaciones nuevas para esta cola.');
      } catch (error) {
        if (controller.signal.aborted) throw new AbandonedOperation();
        throw error;
      } finally { if (musicRequest.current === controller) musicRequest.current = null; }
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
    session,
    authLoading: auth.authLoading,
    authError: auth.authError,
    retryAuth: auth.retryAuth,
    guilds: auth.guilds,
    guildId,
    setGuildId,
    guildsLoading: auth.guildsLoading,
    guild: auth.guilds.find((item) => item.id === guildId),
    view,
    setView,
    mobileNav,
    setMobileNav,
    error,
    setError,
    notice,
    busy,
    loggingOut,
    logout,
    state,
    connection,
    refresh,
    current,
    controlsDisabled: !!busy || loggingOut || !state,
    playing: state?.status === 'playing',
    volumeDraft,
    setVolumeDraft,
    action,
    query,
    setQuery,
    addToQueue,
    ...library,
  };
}
