import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type GuildSummary, type Session } from '../../lib/api';

interface SessionOptions {
  onError: (message: string) => void;
  onExpire: () => void;
}

/** Owns authentication and the guilds visible to the current Discord member. */
export function useSession({ onError, onExpire }: SessionOptions) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [guildId, setGuildId] = useState('');
  const [guildsLoading, setGuildsLoading] = useState(false);

  const reportError = useCallback((problem: unknown) => {
    if (problem instanceof ApiError && problem.status === 401) {
      onExpire();
      setSession(null);
      setGuildId('');
      setGuilds([]);
      setAuthError('Tu sesión terminó. Inicia sesión de nuevo para continuar.');
    } else {
      onError(problem instanceof Error ? problem.message : 'Ocurrió un error. Vuelve a intentarlo.');
    }
  }, [onError, onExpire]);

  useEffect(() => {
    const abort = new AbortController();
    setAuthLoading(true);
    setAuthError('');
    api<Session>('/api/session', { signal: abort.signal })
      .then((value) => setSession(value))
      .catch((problem) => {
        if (abort.signal.aborted) return;
        if (!(problem instanceof ApiError && problem.status === 401)) {
          setAuthError(problem instanceof Error ? problem.message : 'No se pudo conectar al servidor.');
        }
      })
      .finally(() => { if (!abort.signal.aborted) setAuthLoading(false); });
    return () => abort.abort();
  }, [authAttempt]);

  useEffect(() => {
    if (!session) return;
    const abort = new AbortController();
    setGuildsLoading(true);
    api<{ guilds: GuildSummary[] }>('/api/guilds', { signal: abort.signal })
      .then(({ guilds: next }) => {
        if (abort.signal.aborted) return;
        setGuilds(next);
        setGuildId(next[0]?.id || '');
      })
      .catch((problem) => { if (!abort.signal.aborted) reportError(problem); })
      .finally(() => { if (!abort.signal.aborted) setGuildsLoading(false); });
    return () => abort.abort();
  }, [session, reportError]);

  const retryAuth = useCallback(() => setAuthAttempt((value) => value + 1), []);
  const completeLogout = useCallback(() => {
    setSession(null);
    setGuilds([]);
    setAuthError('');
  }, []);

  return {
    session, authLoading, authError, retryAuth,
    guilds, guildId, setGuildId, guildsLoading,
    reportError, completeLogout,
  };
}
