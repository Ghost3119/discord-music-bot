import { ApiError, type PlaybackSnapshot } from './api';

export interface StreamSource {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}
interface Options {
  guildId: string;
  fetchState: (signal: AbortSignal) => Promise<PlaybackSnapshot>;
  createSource: (url: string) => StreamSource;
  onState: (state: PlaybackSnapshot) => void;
  onConnection: (status: 'connecting' | 'live' | 'reconnecting') => void;
  onError: (error: unknown) => void;
  onInvalidate: () => void;
}
/** Closing also invalidates in-flight REST responses; SSE events always win over older fetches. */
export function connectPlayback(options: Options) {
  const abort = new AbortController();
  let closed = false;
  let revision = 0;
  let fetchRevision = 0;
  const close = () => { closed = true; abort.abort(); source.onopen = null; source.onerror = null; source.close(); };
  const refresh = async () => {
    if (closed) return;
    const revisionAtStart = revision;
    const request = ++fetchRevision;
    try {
      const state = await options.fetchState(abort.signal);
      if (!closed && request === fetchRevision && revisionAtStart === revision && state.guildId === options.guildId) options.onState(state);
    } catch (error) {
      if (!closed && !abort.signal.aborted) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          close();
          options.onInvalidate();
        }
        options.onError(error);
      }
    }
  };
  options.onConnection('connecting');
  const source = options.createSource(`/api/guilds/${encodeURIComponent(options.guildId)}/events`);
  source.onopen = () => { if (!closed) { options.onConnection('live'); void refresh(); } };
  source.onerror = () => {
    if (!closed) {
      options.onConnection('reconnecting');
      // EventSource hides HTTP status. REST detects an expired session or revoked access.
      void refresh();
    }
  };
  source.addEventListener('state', (event) => {
    if (closed) return;
    try {
      const state = JSON.parse(event.data) as PlaybackSnapshot;
      if (state.guildId !== options.guildId) return;
      revision++;
      options.onState(state);
      options.onConnection('live');
    } catch { options.onError(new Error('Se recibió una actualización inválida.')); }
  });
  void refresh();
  return {
    refresh,
    close,
    get closed() { return closed; },
  };
}
