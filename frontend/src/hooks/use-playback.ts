import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PlaybackSnapshot } from '../lib/api';
import { connectPlayback } from '../lib/playback-stream';

export function usePlayback(guildId: string, onError: (error: unknown) => void) {
  const [state, setState] = useState<PlaybackSnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<ReturnType<typeof connectPlayback> | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    setState(null);
    if (!guildId) return;
    const current = connectPlayback({
      guildId,
      fetchState: (signal) => api<PlaybackSnapshot>(`/api/guilds/${encodeURIComponent(guildId)}/state`, { signal }),
      createSource: (url) => new EventSource(url, { withCredentials: true }),
      onState: setState,
      onConnection: setConnection,
      onError: (error) => errorRef.current(error),
      onInvalidate: () => { setState(null); setConnection('reconnecting'); },
    });
    controller.current = current;
    return () => { current.close(); if (controller.current === current) controller.current = null; };
  }, [guildId, attempt]);
  const refresh = useCallback(() => {
    if (controller.current?.closed) { setAttempt((value) => value + 1); return Promise.resolve(); }
    return controller.current?.refresh();
  }, []);
  // Render never shows the previous guild while React runs effect cleanup.
  return { state: state?.guildId === guildId ? state : null, connection, refresh };
}
