import path from 'node:path';
import type { WebAccessMode } from './contracts';
export type { WebAccessMode } from './contracts';

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
  origin: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
  accessMode?: WebAccessMode;
  allowedUserIds: string[];
  allowedGuildIds?: string[];
  adminUserIds?: string[];
  membershipCacheTtlMs?: number;
  databasePath: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  staticRoot?: string;
}

const parseIds = (raw: string | undefined): string[] => (raw ?? '').split(',').map(id => id.trim()).filter(Boolean);
const isSnowflake = (id: string): boolean => /^\d{17,20}$/.test(id);

/** The dashboard is opt-in. Disabled installations need no OAuth credentials. */
export function readWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const enabled = env['WEB_ENABLED'] === 'true';
  const port = Number(env['WEB_PORT'] ?? '8080');
  const origin = env['WEB_ORIGIN'] ?? `http://127.0.0.1:${port}`;
  const accessMode = (env['WEB_ACCESS_MODE']?.trim() || 'allowlist') as WebAccessMode;
  const allowedUserIds = parseIds(env['WEB_ALLOWED_USER_IDS']);
  const allowedGuildIds = parseIds(env['WEB_ALLOWED_GUILD_IDS']);
  const explicitAdmins = parseIds(env['WEB_ADMIN_USER_IDS']);
  const adminUserIds = env['WEB_ADMIN_USER_IDS']?.trim() ? explicitAdmins : accessMode === 'allowlist' ? allowedUserIds : [];
  const config: WebConfig = {
    enabled,
    host: env['WEB_HOST'] ?? '127.0.0.1',
    port,
    origin,
    oauthClientId: env['WEB_CLIENT_ID'] || env['CLIENT_ID'] || '',
    oauthClientSecret: env['WEB_CLIENT_SECRET'] ?? '',
    oauthRedirectUri: env['WEB_REDIRECT_URI'] ?? `${origin}/auth/discord/callback`,
    accessMode,
    allowedUserIds,
    allowedGuildIds,
    adminUserIds,
    membershipCacheTtlMs: Number(env['WEB_MEMBERSHIP_CACHE_TTL_MS'] ?? '5000'),
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
  if (!isSnowflake(config.oauthClientId) || !config.oauthClientSecret) throw new Error('WEB_CLIENT_ID/CLIENT_ID and WEB_CLIENT_SECRET are required');
  const accessMode = config.accessMode ?? 'allowlist';
  if (accessMode !== 'allowlist' && accessMode !== 'guild_members') throw new Error('WEB_ACCESS_MODE must be allowlist or guild_members');
  if (accessMode === 'allowlist') {
    if (!config.allowedUserIds.length || config.allowedUserIds.some(id => !isSnowflake(id))) throw new Error('WEB_ALLOWED_USER_IDS must contain Discord user IDs');
    if (config.allowedGuildIds?.some(id => !isSnowflake(id))) throw new Error('WEB_ALLOWED_GUILD_IDS must contain Discord guild IDs');
  } else {
    if (!config.allowedGuildIds?.length || config.allowedGuildIds.some(id => !isSnowflake(id))) throw new Error('WEB_ALLOWED_GUILD_IDS must contain Discord guild IDs');
    if (config.allowedUserIds.some(id => !isSnowflake(id))) throw new Error('WEB_ALLOWED_USER_IDS must contain Discord user IDs');
  }
  if (config.adminUserIds?.some(id => !isSnowflake(id))) throw new Error('WEB_ADMIN_USER_IDS must contain Discord user IDs');
  if (config.membershipCacheTtlMs !== undefined && (!Number.isFinite(config.membershipCacheTtlMs) || config.membershipCacheTtlMs < 0 || config.membershipCacheTtlMs > 60_000)) {
    throw new Error('WEB_MEMBERSHIP_CACHE_TTL_MS must be between 0 and 60000 ms');
  }
  if (!Number.isFinite(config.sessionTtlMs) || config.sessionTtlMs < 60_000 || config.sessionTtlMs > 30 * 86_400_000) throw new Error('WEB_SESSION_TTL_HOURS must be between 1 minute and 30 days');
}
