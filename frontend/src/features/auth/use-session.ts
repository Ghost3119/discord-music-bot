import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type GuildSummary, type Session } from '../../lib/api';

interface SessionOptions {
  onError: (message: string) => void;
  onExpire: () => void;
}

const LAST_GUILD_PREFIX = 'sonora:last-guild:';

function readStoredGuild(userId: string): string {
  if (!userId) return '';
  try {
    return typeof window !== 'undefined' ? window.localStorage?.getItem(`${LAST_GUILD_PREFIX}${userId}`) || '' : '';
  } catch {
    return '';
  }
}

function writeStoredGuild(userId: string, guildId: string): void {
  if (!userId || !guildId) return;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(`${LAST_GUILD_PREFIX}${userId}`, guildId);
    }
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
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

  const reportError = useCallback(
    (problem: unknown) => {
      if (problem instanceof ApiError && problem.status === 401) {
        onExpire();
        setSession(null);
        setGuildId('');
        setGuilds([]);
        setAuthError('Tu sesión terminó. Inicia sesión de nuevo para continuar.');
      } else {
        onError(problem instanceof Error ? problem.message : 'Ocurrió un error. Vuelve a intentarlo.');
      }
    },
    [onError, onExpire],
  );

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
      .finally(() => {
        if (!abort.signal.aborted) setAuthLoading(false);
      });
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
        setGuildId((current) => {
          if (current && next.some((item) => item.id === current)) {
            writeStoredGuild(session.user.id, current);
            return current;
          }
          const stored = readStoredGuild(session.user.id);
          const chosen = (stored && next.find((item) => item.id === stored)?.id) || next[0]?.id || '';
          if (chosen) writeStoredGuild(session.user.id, chosen);
          return chosen;
        });
      })
      .catch((problem) => {
        if (!abort.signal.aborted) reportError(problem);
      })
      .finally(() => {
        if (!abort.signal.aborted) setGuildsLoading(false);
      });
    return () => abort.abort();
  }, [session, reportError]);

  useEffect(() => {
    if (session?.user.id && guildId && guilds.some((item) => item.id === guildId)) {
      writeStoredGuild(session.user.id, guildId);
    }
  }, [session?.user.id, guildId, guilds]);

  const retryAuth = useCallback(() => setAuthAttempt((value) => value + 1), []);
  const completeLogout = useCallback(() => {
    setSession(null);
    setGuilds([]);
    setAuthError('');
  }, []);

  return {
    session,
    authLoading,
    authError,
    retryAuth,
    guilds,
    guildId,
    setGuildId,
    guildsLoading,
    reportError,
    completeLogout,
  };
}
