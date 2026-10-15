import path from 'node:path';

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
  origin: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
  allowedUserIds: string[];
  databasePath: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  staticRoot?: string;
}

/** The dashboard is opt-in. Disabled installations need no OAuth credentials. */
export function readWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const enabled = env['WEB_ENABLED'] === 'true';
  const port = Number(env['WEB_PORT'] ?? '8080');
  const origin = env['WEB_ORIGIN'] ?? `http://127.0.0.1:${port}`;
  const config: WebConfig = {
    enabled,
    host: env['WEB_HOST'] ?? '127.0.0.1',
    port,
    origin,
    oauthClientId: env['WEB_CLIENT_ID'] || env['CLIENT_ID'] || '',
    oauthClientSecret: env['WEB_CLIENT_SECRET'] ?? '',
    oauthRedirectUri: env['WEB_REDIRECT_URI'] ?? `${origin}/auth/discord/callback`,
    allowedUserIds: (env['WEB_ALLOWED_USER_IDS'] ?? '').split(',').map(id => id.trim()).filter(Boolean),
    databasePath: path.resolve(env['WEB_DATABASE_PATH'] ?? 'data/dashboard.sqlite'),
    sessionTtlMs: Number(env['WEB_SESSION_TTL_HOURS'] ?? '168') * 3_600_000,
    secureCookies: origin.startsWith('https:'),
    staticRoot: path.resolve('frontend/dist'),
  };
  if (enabled) validateWebConfig(config);
  return config;
}

export function validateWebConfig(config: WebConfig): void {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('WEB_PORT must be 1–65535');
  if (!config.host.trim()) throw new Error('WEB_HOST is required');
  let origin: URL;
  let redirect: URL;
  try { origin = new URL(config.origin); redirect = new URL(config.oauthRedirectUri); }
  catch { throw new Error('WEB_ORIGIN and WEB_REDIRECT_URI must be absolute URLs'); }
  if (origin.origin !== config.origin || origin.username || origin.password || origin.hash) throw new Error('WEB_ORIGIN must contain only scheme, host and port');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local)) throw new Error('WEB_ORIGIN requires HTTPS outside localhost');
  if (origin.protocol === 'https:' && !config.secureCookies) throw new Error('HTTPS dashboard cookies must be Secure');
  if (origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) throw new Error('HTTP dashboards must bind to localhost; use HTTPS for a public bind');
  if (redirect.origin !== origin.origin || redirect.pathname !== '/auth/discord/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error('WEB_REDIRECT_URI must be WEB_ORIGIN/auth/discord/callback');
  if (!/^\d{17,20}$/.test(config.oauthClientId) || !config.oauthClientSecret) throw new Error('WEB_CLIENT_ID/CLIENT_ID and WEB_CLIENT_SECRET are required');
  if (!config.allowedUserIds.length || config.allowedUserIds.some(id => !/^\d{17,20}$/.test(id))) throw new Error('WEB_ALLOWED_USER_IDS must contain Discord user IDs');
  if (!Number.isFinite(config.sessionTtlMs) || config.sessionTtlMs < 60_000 || config.sessionTtlMs > 30 * 86_400_000) throw new Error('WEB_SESSION_TTL_HOURS must be between 1 minute and 30 days');
}
