import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { GuildPermissions, GuildSummary, MusicBridge, PlaybackSnapshot } from './contracts';
import { WebConfig, validateWebConfig } from './config';
import { WebDatabase, WebError, WebSession, type SavedPlaylist, csrfTokenFor, hashToken, openWebDatabase } from './database';
import { musicAction, object, playlistImportCommitPayload, playlistName, resolveTrackUrlMetadata, trackMetadata } from './validation';
import { createPlaylistImportService, type PlaylistImportService } from './playlistImport';
import { createMusicSearchService, type MusicSearchService } from './musicSearch';
import { createLyricsService, type LyricsService } from './lyrics/service';
import { candidateCompatibilityWarning } from './lyrics/matching';
import type { LyricsCurrentResponse, LyricsSearchResponse, LyricsResult, LyricsSearchResult } from './lyrics/contracts';

declare module 'fastify' { interface FastifyRequest { webSession: WebSession | null } }
export interface WebServerOptions {
  config: WebConfig;
  bridge: MusicBridge;
  /** Injected databases remain caller-owned and must be closed by the caller. */
  database?: WebDatabase;
  oauthFetch?: typeof fetch;
  now?: () => number;
  sseIntervalMs?: number;
  /** Bounded music-handler deadline; injectable for deterministic tests. */
  musicOperationTimeoutMs?: number;
  /** Test/provider injection; no client-supplied upstream URLs. */
  lyricsService?: LyricsService;
  /** Test/extractor injection for public playlist import previews. */
  playlistImportService?: PlaylistImportService;
  /** Test/provider injection for integrated multi-platform music search. */
  musicSearchService?: MusicSearchService;
}
interface LiveStream { response: ServerResponse; tokenHash: string; userId: string; guildId: string; close: () => void }
interface PendingOperation { tokenHash: string; userId: string; guildId: string | undefined; controller: AbortController; timedOut: boolean; done: () => void }
const SESSION_COOKIE = 'music_session';
const STATE_COOKIE = 'music_oauth_state';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function params(request: FastifyRequest): Record<string, string> { return request.params as Record<string, string>; }

/** Stop waiting promptly even when an external resolver settles after cancellation. */
function waitForOperation<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(new WebError(409, 'Playback operation cancelled')); };
    const cleanup = (): void => { signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) { cleanup(); abort(); }
  });
}


/** Creates an isolated server; the bot lifecycle explicitly decides whether to listen. */
export async function createWebServer(options: WebServerOptions): Promise<FastifyInstance> {
  const { config, bridge } = options;
  validateWebConfig(config);
  const database = options.database ?? openWebDatabase(config.databasePath);
  const now = options.now ?? Date.now;
  const oauthFetch = options.oauthFetch ?? fetch;
  const lyrics = options.lyricsService ?? createLyricsService();
  const playlistImporter = options.playlistImportService ?? createPlaylistImportService();
  const musicSearcher = options.musicSearchService ?? createMusicSearchService({ fetch: oauthFetch });
  const accessMode = config.accessMode ?? 'allowlist';
  const allowed = new Set(config.allowedUserIds);
  const allowedGuilds = config.allowedGuildIds?.length || accessMode === 'guild_members' ? new Set(config.allowedGuildIds ?? []) : null;
  const adminUsers = config.adminUserIds !== undefined
    ? new Set(config.adminUserIds)
    : accessMode === 'allowlist' ? new Set(config.allowedUserIds) : new Set<string>();
  const isAdmin = (userId: string): boolean => adminUsers.has(userId);
  const states = new Map<string, number>();
  const streams = new Set<LiveStream>();
  const operations = new Set<PendingOperation>();
  const loads = new Map<string, AbortController>();
  const activeImports = new Set<string>();
  const completedImports = new Map<string, { playlist: SavedPlaylist; expiresAt: number }>();
  const pendingStreams = new Map<string, number>();
  // Ephemeral IDs only: selection cannot turn this authenticated route into a catalogue proxy.
  const lyricChoices = new Map<string, { ids: Set<number>; expiresAt: number }>();
  let expiryCleanup: ReturnType<typeof setInterval> | undefined;
  let closing = false;
  const app = Fastify({ logger: false, bodyLimit: 16_384, requestTimeout: 120_000, connectionTimeout: 15_000, trustProxy: false });
  // Listener errors are isolated from the process hosting the music engine.
  app.server.on('error', () => { console.warn('[Web] Dashboard HTTP listener error; audio remains available.'); });
  try {
  app.decorateRequest('webSession', null);
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const cookieOptions = { httpOnly: true, secure: config.secureCookies, sameSite: 'lax' as const, path: '/' };
  const stateOptions = { ...cookieOptions, path: '/auth/discord', maxAge: 300 };

  function revokeUserAccess(userId: string, guildId?: string): void {
    bridge.invalidateMembership?.(userId, guildId);
    for (const stream of streams) if (stream.userId === userId && (!guildId || stream.guildId === guildId)) stream.close();
  }
  async function listAuthorizedGuilds(userId: string): Promise<GuildSummary[]> {
    const guilds = await bridge.listGuilds(userId);
    return allowedGuilds ? guilds.filter(guild => allowedGuilds.has(guild.id)) : guilds;
  }
  async function assertGuildAccess(userId: string, guildId: string): Promise<void> {
    if (allowedGuilds && !allowedGuilds.has(guildId)) {
      revokeUserAccess(userId, guildId);
      throw new WebError(403, 'You do not have access to this Discord server');
    }
    try { await bridge.assertGuildAccess(userId, guildId); }
    catch (error) { revokeUserAccess(userId, guildId); throw error; }
  }
  async function resolvePermissions(userId: string, guildId: string, snapshot?: PlaybackSnapshot): Promise<GuildPermissions> {
    const admin = isAdmin(userId);
    const base = snapshot?.permissions ?? (await bridge.getPermissions?.(userId, guildId));
    const canControl = base ? base.canControl : true;
    const inVoiceChannel = base ? base.inVoiceChannel : Boolean(snapshot?.voice);
    return {
      role: admin ? 'admin' : canControl ? 'voice' : 'member',
      isMember: true,
      inVoiceChannel,
      canControl,
      isAdmin: admin,
      canRead: true,
      canManageLibrary: true,
      canViewDiagnostics: admin,
      canManageConfig: admin,
    };
  }
  async function projectSnapshot(userId: string, guildId: string, snapshot: PlaybackSnapshot): Promise<PlaybackSnapshot> {
    const permissions = await resolvePermissions(userId, guildId, snapshot);
    return {
      ...snapshot,
      health: permissions.canViewDiagnostics ? snapshot.health : {},
      incidents: permissions.canViewDiagnostics ? snapshot.incidents : [],
      permissions,
    };
  }
  function authenticate(request: FastifyRequest): WebSession {
    const session = database.getSession(request.cookies[SESSION_COOKIE], now());
    if (!session || (accessMode === 'allowlist' && !allowed.has(session.user.id))) throw new WebError(401, 'Sign in with an authorized Discord account');
    return session;
  }
  function beginOperation(request: FastifyRequest, response: ServerResponse, timeoutMs: number): PendingOperation {
    const session = request.webSession!;
    const guildId = params(request)['guildId'];
    const controller = new AbortController();
    const socket = request.raw.socket;
    const previousSocketTimeout = socket?.timeout;
    // Slow authenticated handlers use an explicit deadline instead of the global 15s idle reset.
    socket?.setTimeout?.(timeoutMs + 1000);
    let operationDeadline: ReturnType<typeof setTimeout>;
    const abort = (): void => { controller.abort(); };
    let deadline: ReturnType<typeof setTimeout>;
    const scheduleDeadline = (): void => {
      const remaining = session.expiresAt - now();
      if (remaining <= 0) { abort(); return; }
      deadline = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
      deadline.unref();
    };
    scheduleDeadline();
    const monitor = setInterval(() => {
      try { authenticate(request); } catch { abort(); }
    }, Math.max(20, options.sseIntervalMs ?? 2000));
    monitor.unref();
    const operation: PendingOperation = { tokenHash: session.tokenHash, userId: session.user.id, guildId, controller, timedOut: false, done: () => {
      clearTimeout(deadline); clearTimeout(operationDeadline); clearInterval(monitor);
      if (!socket?.destroyed) socket?.setTimeout?.(previousSocketTimeout ?? 15_000);
      response.off('close', abort); request.raw.off('aborted', abort);
      operations.delete(operation);
    } };
    response.on('close', abort); request.raw.on('aborted', abort);
    operations.add(operation);
    operationDeadline = setTimeout(() => { operation.timedOut = true; abort(); }, timeoutMs);
    operationDeadline.unref();
    if (closing) abort();
    return operation;
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (config.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    const route = request.url.split('?')[0]!;
    if (route.startsWith('/api/') || route.startsWith('/auth/')) reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== config.origin) throw new WebError(403, 'Invalid request origin');
    if ((route.startsWith('/api/') || route === '/auth/logout') && request.headers.origin && request.headers.origin !== config.origin) throw new WebError(403, 'Invalid request origin');
  });
  app.addHook('preHandler', async request => {
    const route = request.url.split('?')[0]!;
    if (!(route.startsWith('/api/') || route === '/auth/logout')) return;
    const session = authenticate(request);
    request.webSession = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || csrf.length !== 64 || !safeEqual(hashToken(csrf), session.csrfHash)) throw new WebError(403, 'Invalid CSRF token');
    }
    const guildId = params(request)['guildId'];
    if (guildId) {
      if (!/^\d{17,20}$/.test(guildId)) throw new WebError(400, 'Invalid Discord guild ID');
      await assertGuildAccess(session.user.id, guildId);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as Error & { statusCode?: number; errorCode?: string };
    const bridgeErrors: Record<string, [number, string]> = {
      GUILD_ACCESS_DENIED: [403, 'You do not have access to this Discord server'],
      CONTROL_CHANNEL_REQUIRED: [403, 'Join the same voice channel as the bot to control playback'],
      VOICE_PERMISSIONS: [403, 'Discord voice channel permissions do not allow this action'],
      SESSION_CHANGED: [409, 'The playback session changed; refresh and try again'],
      QUEUE_BLOCKED: [409, 'Playback recovery is in progress; try again shortly'],
      NO_QUEUE: [400, 'There is no active playback queue'],
      INVALID_ACTION: [400, 'Invalid playback action'],
      INVALID_QUEUE_POSITION: [400, 'The queue position is no longer available'],
      NO_UP_NEXT: [400, 'There are no pending tracks'],
      MUSIC_BUSY: [409, 'Ya hay una búsqueda de recomendaciones en curso para esta cola.'],
      RECOMMEND_UNAVAILABLE: [503, 'No se pudo consultar YouTube Mix ahora.'],
      MUSIC_OPERATION_TIMEOUT: [504, 'La operación superó el tiempo de espera. Algunas canciones pueden estar ya en la cola; revísala antes de reintentar.'],
      PLAYLIST_IMPORT_TIMEOUT: [504, 'La consulta de la playlist superó el tiempo de espera. Inténtalo de nuevo.'],
      MUSIC_SEARCH_TIMEOUT: [504, 'La búsqueda superó el tiempo de espera. Inténtalo de nuevo.'],
      SPOTIFY_IMPORT_UNSUPPORTED: [501, 'La importación de playlists de Spotify estará disponible próximamente. Por ahora puedes importar playlists públicas de YouTube y YouTube Music.'],
    };
    const known = candidate.errorCode && Object.hasOwn(bridgeErrors, candidate.errorCode) ? bridgeErrors[candidate.errorCode] : undefined;
    if (known) { void reply.code(known[0]).send({ error: known[1] }); return; }
    const status = candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 600 ? candidate.statusCode : 500;
    // Internal provider, database and extractor errors must never leak credentials.
    void reply.code(status).send({ error: status >= 500 ? 'The dashboard could not complete this request' : candidate.message });
  });

  app.get('/auth/discord', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_request, reply) => {
    for (const [key, expiry] of states) if (expiry <= now()) states.delete(key);
    if (states.size >= 1000) throw new WebError(503, 'Too many pending sign-ins');
    const state = randomBytes(32).toString('base64url');
    states.set(hashToken(state), now() + 300_000);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: config.oauthClientId, redirect_uri: config.oauthRedirectUri, response_type: 'code', scope: 'identify', state }).toString();
    return reply.setCookie(STATE_COOKIE, state, stateOptions).redirect(url.toString());
  });
  app.get('/auth/discord/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.clearCookie(STATE_COOKIE, { ...cookieOptions, path: '/auth/discord' });
    const query = request.query as Record<string, unknown>;
    const state = query['state'];
    const stateCookie = request.cookies[STATE_COOKIE];
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state) || !stateCookie || !safeEqual(state, stateCookie)) throw new WebError(400, 'Invalid or expired OAuth state');
    const key = hashToken(state);
    const expiry = states.get(key);
    states.delete(key); // Consume before network work: failures and parallel callbacks cannot replay.
    if (!expiry || expiry <= now()) throw new WebError(400, 'Invalid or expired OAuth state');
    if (typeof query['code'] !== 'string' || !query['code'] || query['code'].length > 2048 || query['error']) throw new WebError(400, 'Discord authorization was not completed');
    const tokenResponse = await oauthFetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.oauthClientId, client_secret: config.oauthClientSecret, redirect_uri: config.oauthRedirectUri, code: query['code'] }), signal: AbortSignal.timeout(10_000) });
    if (!tokenResponse.ok) throw new WebError(502, 'Discord sign-in is temporarily unavailable');
    const token = object(await tokenResponse.json());
    if (typeof token['access_token'] !== 'string' || token['token_type'] !== 'Bearer') throw new WebError(502, 'Invalid Discord token response');
    const profileResponse = await oauthFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token['access_token']}` }, signal: AbortSignal.timeout(10_000) });
    if (!profileResponse.ok) throw new WebError(502, 'Discord sign-in is temporarily unavailable');
    const profile = object(await profileResponse.json());
    if (typeof profile['id'] !== 'string' || !/^\d{17,20}$/.test(profile['id'])) throw new WebError(403, 'This Discord account is not authorized');
    if (accessMode === 'allowlist') {
      if (!allowed.has(profile['id'])) throw new WebError(403, 'This Discord account is not authorized');
    } else {
      const guilds = await listAuthorizedGuilds(profile['id']).catch(() => []);
      if (!guilds.length) throw new WebError(403, 'This Discord account is not authorized');
    }
    if (typeof profile['username'] !== 'string' || !profile['username'] || profile['username'].length > 100) throw new WebError(502, 'Invalid Discord profile');
    const avatarHash = typeof profile['avatar'] === 'string' && /^[a-zA-Z0-9_]+$/.test(profile['avatar']) ? profile['avatar'] : null;
    const avatar = avatarHash ? `https://cdn.discordapp.com/avatars/${profile['id']}/${avatarHash}.png?size=128` : null;
    database.deleteSession(request.cookies[SESSION_COOKIE]);
    const session = database.createSession({ id: profile['id'], username: profile['username'], avatar }, now(), config.sessionTtlMs);
    return reply.setCookie(SESSION_COOKIE, session.token, { ...cookieOptions, maxAge: Math.floor(config.sessionTtlMs / 1000) }).redirect('/');
  });
  app.post('/auth/logout', async (request, reply) => {
    database.deleteSession(request.cookies[SESSION_COOKIE]);
    for (const stream of streams) if (stream.tokenHash === request.webSession!.tokenHash) stream.close();
    for (const operation of operations) if (operation.tokenHash === request.webSession!.tokenHash) operation.controller.abort();
    return reply.clearCookie(SESSION_COOKIE, cookieOptions).send({ ok: true });
  });
  app.get('/api/session', async request => {
    const session = request.webSession!;
    if (accessMode === 'guild_members') {
      const guilds = await listAuthorizedGuilds(session.user.id).catch(() => []);
      if (!guilds.length) {
        database.deleteSession(request.cookies[SESSION_COOKIE]);
        revokeUserAccess(session.user.id);
        throw new WebError(401, 'Sign in with an authorized Discord account');
      }
    }
    const admin = isAdmin(session.user.id);
    return { user: session.user, csrfToken: csrfTokenFor(request.cookies[SESSION_COOKIE]!), accessMode, role: admin ? 'admin' : 'member', isAdmin: admin };
  });
  app.get('/api/config', async request => {
    const userId = request.webSession!.user.id;
    if (accessMode === 'guild_members') {
      const guilds = await listAuthorizedGuilds(userId).catch(() => []);
      if (!guilds.length) {
        database.deleteSession(request.cookies[SESSION_COOKIE]);
        revokeUserAccess(userId);
        throw new WebError(403, 'You do not have access to this Discord server');
      }
    }
    if (!isAdmin(userId)) throw new WebError(403, 'Administrator access is required');
    return {
      accessMode,
      allowedGuildIds: [...(allowedGuilds ?? [])],
      adminUserIds: [...adminUsers],
      sessionTtlMs: config.sessionTtlMs,
      secureCookies: config.secureCookies,
    };
  });
  app.get('/api/guilds', async request => ({ guilds: await listAuthorizedGuilds(request.webSession!.user.id) }));
  app.get('/api/guilds/:guildId/permissions', async request => ({
    permissions: await resolvePermissions(request.webSession!.user.id, params(request)['guildId']!),
  }));
  app.get('/api/guilds/:guildId/diagnostics', async request => {
    const userId = request.webSession!.user.id;
    if (!isAdmin(userId)) throw new WebError(403, 'Administrator access is required');
    const snapshot = await bridge.getState(userId, params(request)['guildId']!);
    return { guildId: snapshot.guildId, health: snapshot.health, incidents: snapshot.incidents };
  });
  app.get('/api/guilds/:guildId/state', async request => {
    const userId = request.webSession!.user.id;
    const guildId = params(request)['guildId']!;
    return projectSnapshot(userId, guildId, await bridge.getState(userId, guildId));
  });
  app.get('/api/guilds/:guildId/lyrics/current', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply): Promise<LyricsCurrentResponse> => {
    const userId = request.webSession!.user.id;
    const guildId = params(request)['guildId']!;
    const before = await bridge.getState(userId, guildId);
    const identity = { guildId, trackId: before.current?.id ?? null, playbackId: before.playbackId ?? null };
    if (!before.current || before.status === 'idle') return { ...identity, status: 'idle' };
    // A legacy injected bridge without instance identity cannot safely attach lyrics.
    if (!identity.playbackId) return { ...identity, status: 'stale' };
    const operation = beginOperation(request, reply.raw, 12_000);
    const signal = operation.controller.signal;
    try {
      const result = await waitForOperation(lyrics.findLyrics({
        title: before.current.title, artist: before.current.artist, duration: before.current.duration,
        ...(before.current.source === 'youtube' ? { durationReliable: false } : {}),
        ...(before.current.album ? { album: before.current.album } : {}),
      }, signal), signal);
      signal.throwIfAborted();
      // Membership/session revocation during an upstream wait must take effect before returning text.
      authenticate(request);
      await assertGuildAccess(userId, guildId);
      const after = await bridge.getState(userId, guildId);
      signal.throwIfAborted();
      if (after.playbackId !== before.playbackId || after.current?.id !== before.current.id || after.current?.url !== before.current.url || after.status === 'idle') {
        return { guildId, trackId: after.current?.id ?? null, playbackId: after.playbackId ?? null, status: 'stale' };
      }
      return { ...identity, ...result };
    } catch (error) {
      if (signal.aborted) {
        authenticate(request);
        return { ...identity, status: 'temporary_error', retryAfterMs: 5000, reason: operation.timedOut ? 'timeout' : 'unavailable' };
      }
      throw error;
    } finally { operation.done(); }
  });
  for (const kind of ['search', 'selection'] as const) {
    app.get(`/api/guilds/:guildId/lyrics/${kind}`, { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply): Promise<LyricsCurrentResponse | LyricsSearchResponse> => {
      const userId = request.webSession!.user.id;
      const guildId = params(request)['guildId']!;
      const input = request.query as Record<string, unknown>;
      const fields = kind === 'search' ? ['title', 'artist', 'trackId', 'playbackId'] : ['recordId', 'trackId', 'playbackId'];
      if (Object.keys(input).some(key => !fields.includes(key))) throw new WebError(400, 'Invalid lyrics parameters');
      const text = (field: string, max: number): string => {
        const value = input[field];
        if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new WebError(400, 'Invalid lyrics parameters');
        return value.trim();
      };
      const trackId = text('trackId', 300), playbackId = text('playbackId', 200);
      const title = kind === 'search' ? text('title', 200) : '';
      const artist = kind === 'search' ? text('artist', 200) : '';
      const recordId = kind === 'selection' ? Number(text('recordId', 16)) : 0;
      if (kind === 'selection' && (!/^\d+$/.test(input['recordId'] as string) || !Number.isSafeInteger(recordId) || recordId <= 0)) throw new WebError(400, 'Invalid lyrics record ID');
      const before = await bridge.getState(userId, guildId);
      const identity = { guildId, trackId: before.current?.id ?? null, playbackId: before.playbackId ?? null };
      if (!before.current || before.status === 'idle') return { ...identity, status: 'idle' };
      if (!identity.playbackId || trackId !== identity.trackId || playbackId !== identity.playbackId) return { ...identity, status: 'stale' };
      const choiceKey = JSON.stringify([request.webSession!.tokenHash, guildId, trackId, playbackId, before.current.url]);
      for (const [key, choice] of lyricChoices) if (choice.expiresAt <= now()) lyricChoices.delete(key);
      if (kind === 'selection' && !lyricChoices.get(choiceKey)?.ids.has(recordId)) throw new WebError(409, 'Search again before selecting lyrics');
      const operation = beginOperation(request, reply.raw, 12_000);
      const signal = operation.controller.signal;
      try {
        const task = kind === 'search'
          ? lyrics.searchLyrics?.({ title, artist, duration: before.current.duration }, signal)
          : lyrics.selectLyrics?.(recordId, signal);
        if (!task) return { ...identity, status: 'temporary_error', retryAfterMs: 5000, reason: 'unavailable' };
        const result = await waitForOperation<LyricsResult | LyricsSearchResult>(task, signal);
        signal.throwIfAborted();
        authenticate(request);
        await assertGuildAccess(userId, guildId);
        const after = await bridge.getState(userId, guildId);
        signal.throwIfAborted();
        if (after.playbackId !== before.playbackId || after.current?.id !== before.current.id || after.current?.url !== before.current.url || after.status === 'idle') {
          lyricChoices.delete(choiceKey);
          return { guildId, trackId: after.current?.id ?? null, playbackId: after.playbackId ?? null, status: 'stale' };
        }
        if (result.status === 'results') {
          result.candidates = result.candidates.map(candidate => {
            const warning = candidateCompatibilityWarning({ title: before.current!.title, artist: before.current!.artist, duration: before.current!.duration,
              ...(before.current!.album ? { album: before.current!.album } : {}) }, candidate);
            const { warning: _editedQueryWarning, ...metadata } = candidate;
            return { ...metadata, ...(warning ? { warning } : {}) };
          });
          lyricChoices.delete(choiceKey);
          while (lyricChoices.size >= 128) lyricChoices.delete(lyricChoices.keys().next().value!);
          lyricChoices.set(choiceKey, { ids: new Set(result.candidates.map(candidate => candidate.id)), expiresAt: now() + 120_000 });
        }
        return { ...identity, ...result };
      } catch (error) {
        if (signal.aborted) {
          authenticate(request);
          await assertGuildAccess(userId, guildId);
          return { ...identity, status: 'temporary_error', retryAfterMs: 5000, reason: operation.timedOut ? 'timeout' : 'unavailable' };
        }
        throw error;
      } finally { operation.done(); }
    });
  }
  app.post('/api/guilds/:guildId/actions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const action = musicAction(request.body);
    const operation = beginOperation(request, reply.raw, options.musicOperationTimeoutMs ?? 120_000);
    try {
      const result = await waitForOperation(bridge.control(request.webSession!.user.id, params(request)['guildId']!, action, operation.controller.signal), operation.controller.signal);
      if (operation.controller.signal.aborted) throw new WebError(409, 'Playback operation cancelled');
      return { ok: true, ...result };
    } catch (error) {
      if (operation.timedOut) throw Object.assign(new WebError(504, 'Music operation timed out'), { errorCode: 'MUSIC_OPERATION_TIMEOUT' });
      if (operation.controller.signal.aborted) throw new WebError(409, 'Playback operation cancelled');
      throw error;
    } finally { operation.done(); }
  });
  app.get('/api/guilds/:guildId/events', async (request, reply) => {
    const session = request.webSession!;
    const pending = pendingStreams.get(session.user.id) ?? 0;
    if (closing || streams.size + [...pendingStreams.values()].reduce((sum, count) => sum + count, 0) >= 128 || [...streams].filter(item => item.userId === session.user.id).length + pending >= 4) throw new WebError(429, 'Too many live dashboard connections');
    const guildId = params(request)['guildId']!;
    let initial: PlaybackSnapshot;
    pendingStreams.set(session.user.id, pending + 1);
    try { initial = await projectSnapshot(session.user.id, guildId, await bridge.getState(session.user.id, guildId)); }
    finally {
      const remaining = (pendingStreams.get(session.user.id) ?? 1) - 1;
      if (remaining) pendingStreams.set(session.user.id, remaining); else pendingStreams.delete(session.user.id);
    }
    if (closing) throw new WebError(503, 'Dashboard is shutting down');
    authenticate(request);
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': config.origin });
    response.setTimeout(0);
    let closed = false;
    let busy = false;
    let blockedAt: number | null = null;
    let timer: ReturnType<typeof setInterval>;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      streams.delete(stream);
      response.off('drain', drain);
      response.off('close', close);
      response.off('error', close);
      response.end();
    };
    const drain = (): void => { blockedAt = null; };
    const stream: LiveStream = { response, tokenHash: session.tokenHash, userId: session.user.id, guildId, close };
    const send = (snapshot: PlaybackSnapshot): void => {
      const data = `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`;
      if (Buffer.byteLength(data) > 1_048_576) { close(); return; }
      if (!response.write(data)) blockedAt = now();
    };
    streams.add(stream);
    response.on('close', close);
    response.on('error', close);
    response.on('drain', drain);
    timer = setInterval(() => { void (async () => {
      if (closed || busy) return;
      if (blockedAt !== null) { if (now() - blockedAt > 10_000) close(); return; }
      busy = true;
      try {
        const currentSession = authenticate(request);
        await assertGuildAccess(currentSession.user.id, guildId);
        const snapshot = await projectSnapshot(currentSession.user.id, guildId, await bridge.getState(currentSession.user.id, guildId));
        if (!closed) send(snapshot);
      } catch { close(); }
      finally { busy = false; }
    })(); }, Math.max(20, options.sseIntervalMs ?? 2000));
    timer.unref();
    send(initial);
  });

  app.get('/api/guilds/:guildId/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = request.webSession!.user.id;
    const guildId = params(request)['guildId']!;
    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    const allowedKeys = new Set(['q', 'query', 'platform', 'limit']);
    if (Object.keys(rawQuery).some(key => !allowedKeys.has(key))) {
      throw new WebError(400, 'Parámetros de búsqueda no válidos.');
    }
    const input = {
      query: rawQuery['q'] !== undefined ? rawQuery['q'] : rawQuery['query'],
      platform: rawQuery['platform'],
      limit: rawQuery['limit'],
    };
    musicSearcher.validateQuery(input);
    const operation = beginOperation(request, reply.raw, options.musicOperationTimeoutMs ?? 25_000);
    const signal = operation.controller.signal;
    try {
      const response = await waitForOperation(musicSearcher.search(input, signal), signal);
      if (signal.aborted) throw new WebError(409, 'La búsqueda fue cancelada.');
      authenticate(request);
      await assertGuildAccess(userId, guildId);
      return response;
    } catch (error) {
      if (operation.timedOut) {
        throw Object.assign(new WebError(504, 'La búsqueda superó el tiempo de espera. Inténtalo de nuevo.'), {
          errorCode: 'MUSIC_SEARCH_TIMEOUT',
        });
      }
      if (signal.aborted) throw new WebError(409, 'La búsqueda fue cancelada.');
      throw error;
    } finally {
      operation.done();
    }
  });
  app.get('/api/guilds/:guildId/tracks/resolve', async request => ({
    track: await resolveTrackUrlMetadata((request.query as Record<string, unknown>)['url'], oauthFetch),
  }));
  app.post('/api/guilds/:guildId/tracks/resolve', async request => ({
    track: await resolveTrackUrlMetadata(object(request.body)['url'], oauthFetch),
  }));
  app.get('/api/guilds/:guildId/playlists', async request => ({ playlists: database.listPlaylists(request.webSession!.user.id, params(request)['guildId']!) }));
  app.post('/api/guilds/:guildId/playlists', async request => ({ playlist: database.createPlaylist(request.webSession!.user.id, params(request)['guildId']!, playlistName(request.body), now()) }));
  app.post('/api/guilds/:guildId/playlists/import/preview', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = request.webSession!.user.id;
    const guildId = params(request)['guildId']!;
    const url = object(request.body)['url'];
    playlistImporter.parseUrl(url);
    const operation = beginOperation(request, reply.raw, options.musicOperationTimeoutMs ?? 60_000);
    const signal = operation.controller.signal;
    try {
      const preview = await waitForOperation(playlistImporter.previewPlaylist(url, signal), signal);
      if (signal.aborted) throw new WebError(409, 'La consulta de la playlist fue cancelada.');
      authenticate(request);
      await assertGuildAccess(userId, guildId);
      return { preview };
    } catch (error) {
      if (operation.timedOut) throw Object.assign(new WebError(504, 'La consulta de la playlist superó el tiempo de espera. Inténtalo de nuevo.'), { errorCode: 'PLAYLIST_IMPORT_TIMEOUT' });
      if (signal.aborted) throw new WebError(409, 'La consulta de la playlist fue cancelada.');
      throw error;
    } finally { operation.done(); }
  });
  app.post('/api/guilds/:guildId/playlists/import', { bodyLimit: 524_288, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async request => {
    const userId = request.webSession!.user.id;
    const guildId = params(request)['guildId']!;
    const { name, tracks, requestId } = playlistImportCommitPayload(request.body);
    const currentNow = now();
    for (const [key, entry] of completedImports) {
      if (entry.expiresAt <= currentNow) completedImports.delete(key);
    }
    const idempotencyKey = requestId ? `${userId}:${guildId}:${requestId}` : null;
    if (idempotencyKey) {
      const existing = completedImports.get(idempotencyKey);
      if (existing && existing.expiresAt > currentNow) {
        return { playlist: existing.playlist };
      }
    }
    const lockKey = `${userId}:${guildId}`;
    if (activeImports.has(lockKey)) {
      throw new WebError(409, 'Ya hay una importación en curso. Espera un momento.');
    }
    activeImports.add(lockKey);
    try {
      const playlist = database.createPlaylistWithTracks(userId, guildId, name, tracks, currentNow);
      if (idempotencyKey) {
        while (completedImports.size >= 256) completedImports.delete(completedImports.keys().next().value!);
        completedImports.set(idempotencyKey, { playlist, expiresAt: currentNow + 300_000 });
      }
      return { playlist };
    } finally {
      activeImports.delete(lockKey);
    }
  });
  app.patch('/api/guilds/:guildId/playlists/:playlistId', async request => ({ playlist: database.renamePlaylist(request.webSession!.user.id, params(request)['guildId']!, params(request)['playlistId']!, playlistName(request.body)) }));
  app.delete('/api/guilds/:guildId/playlists/:playlistId', async request => {
    database.deletePlaylist(request.webSession!.user.id, params(request)['guildId']!, params(request)['playlistId']!); return { ok: true };
  });
  app.post('/api/guilds/:guildId/playlists/:playlistId/tracks', async request => {
    const raw = object(request.body);
    const needsResolve = typeof raw['title'] !== 'string' || !raw['title'].trim();
    const resolved = needsResolve ? await resolveTrackUrlMetadata(raw['url'], oauthFetch) : null;
    const candidate = resolved ? {
      ...resolved,
      ...raw,
      title: typeof raw['title'] === 'string' && raw['title'].trim() ? raw['title'] : resolved.title,
      artist: typeof raw['artist'] === 'string' && raw['artist'].trim() && raw['artist'].trim() !== 'Artista desconocido' ? raw['artist'] : resolved.artist,
      duration: typeof raw['duration'] === 'number' && raw['duration'] > 0 ? raw['duration'] : resolved.duration,
      thumbnail: raw['thumbnail'] ?? resolved.thumbnail,
      source: raw['source'] ?? resolved.source,
    } : raw;
    return { track: database.addPlaylistTrack(request.webSession!.user.id, params(request)['guildId']!, params(request)['playlistId']!, trackMetadata(candidate)) };
  });
  app.delete('/api/guilds/:guildId/playlists/:playlistId/tracks/:trackId', async request => {
    database.deletePlaylistTrack(request.webSession!.user.id, params(request)['guildId']!, params(request)['playlistId']!, params(request)['trackId']!); return { ok: true };
  });
  app.put('/api/guilds/:guildId/playlists/:playlistId/tracks/order', async request => {
    const trackIds = object(request.body)['trackIds'];
    if (!Array.isArray(trackIds) || trackIds.length > 500 || trackIds.some(id => typeof id !== 'string')) throw new WebError(400, 'Invalid trackIds');
    return { playlist: database.reorderPlaylist(request.webSession!.user.id, params(request)['guildId']!, params(request)['playlistId']!, trackIds as string[]) };
  });
  app.post('/api/guilds/:guildId/playlists/:playlistId/load', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const userId = request.webSession!.user.id;
    const guildId = params(request)['guildId']!;
    const playlist = database.getPlaylist(userId, guildId, params(request)['playlistId']!);
    if (!playlist.tracks.length || playlist.tracks.length > 500) throw new WebError(400, 'Load playlists with 1–500 tracks');
    const key = `${guildId}:${userId}`;
    if (loads.has(key)) throw new WebError(409, 'A playlist is already loading');
    const operation = beginOperation(request, reply.raw, options.musicOperationTimeoutMs ?? 300_000);
    const controller = operation.controller;
    loads.set(key, controller);
    const fatalErrorCodes = new Set([
      'GUILD_ACCESS_DENIED',
      'CONTROL_CHANNEL_REQUIRED',
      'VOICE_PERMISSIONS',
      'SESSION_CHANGED',
      'QUEUE_BLOCKED',
      'NO_QUEUE',
    ]);
    try {
      let loaded = 0;
      let failed = 0;
      let lastError: unknown;
      for (let index = 0; index < playlist.tracks.length; index++) {
        const item = playlist.tracks[index]!;
        if (controller.signal.aborted) throw new WebError(409, 'Playlist load cancelled');
        if (index > 0 && index % 25 === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
          if (controller.signal.aborted) throw new WebError(409, 'Playlist load cancelled');
        }
        authenticate(request);
        await assertGuildAccess(userId, guildId);
        try {
          await waitForOperation(bridge.control(userId, guildId, { action: 'play', query: item.url, track: item }, controller.signal), controller.signal);
          loaded++;
        } catch (trackError) {
          if (controller.signal.aborted) throw new WebError(409, 'Playlist load cancelled');
          const candidate = trackError as Error & { statusCode?: number; errorCode?: string };
          if (
            candidate.name === 'AbortError' ||
            (candidate.errorCode && fatalErrorCodes.has(candidate.errorCode)) ||
            (candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 500 && candidate.errorCode !== 'INVALID_ACTION')
          ) {
            throw trackError;
          }
          failed++;
          lastError = trackError;
        }
      }
      if (!loaded && lastError) throw lastError;
      return { ok: true, loaded, total: playlist.tracks.length, failed };
    } catch (error) {
      if (operation.timedOut) throw Object.assign(new WebError(504, 'Music operation timed out'), { errorCode: 'MUSIC_OPERATION_TIMEOUT' });
      if (controller.signal.aborted) throw new WebError(409, 'Playback operation cancelled');
      throw error;
    } finally { loads.delete(key); operation.done(); }
  });
  app.get('/api/guilds/:guildId/favorites', async request => ({ favorites: database.listFavorites(request.webSession!.user.id, params(request)['guildId']!) }));
  app.post('/api/guilds/:guildId/favorites', async request => ({ track: database.addFavorite(request.webSession!.user.id, params(request)['guildId']!, trackMetadata(request.body), now()) }));
  app.delete('/api/guilds/:guildId/favorites/:trackId', async request => {
    database.deleteFavorite(request.webSession!.user.id, params(request)['guildId']!, params(request)['trackId']!); return { ok: true };
  });

  expiryCleanup = setInterval(() => {
    try { database.purgeExpired(now()); }
    catch { console.warn('[Web] Dashboard expired-session cleanup failed.'); }
  }, 60_000);
  expiryCleanup.unref();
  app.addHook('preClose', async () => {
    closing = true;
    clearInterval(expiryCleanup);
    for (const stream of streams) stream.close();
    for (const controller of loads.values()) controller.abort();
    for (const operation of operations) operation.controller.abort();
    states.clear();
    if (!options.lyricsService) lyrics.close();
  });
  app.addHook('onClose', async () => { if (!options.database && database.sqlite.open) database.close(); });
  if (config.staticRoot && existsSync(config.staticRoot)) {
    await app.register(serveStatic, { root: config.staticRoot, index: ['index.html'], dotfiles: 'deny' });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !/^\/(api|auth)(\/|$)/.test(request.url)) return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else app.get('/', async (_request, reply) => reply.code(503).type('text/plain').send('Build the dashboard frontend with npm run build.'));
  await app.ready();
  return app;
  } catch (error) {
    closing = true;
    if (!options.lyricsService) lyrics.close();
    clearInterval(expiryCleanup);
    for (const stream of streams) stream.close();
    for (const operation of operations) { operation.controller.abort(); operation.done(); }
    await app.close().catch(() => undefined);
    if (!options.database && database.sqlite.open) database.close();
    throw error;
  }
}
