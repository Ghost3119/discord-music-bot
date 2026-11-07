import dotenv from 'dotenv';
dotenv.config({ quiet: true });

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`❌ Variable de entorno requerida no encontrada: ${key}`);
  }
  return value;
}

export function parseGuildIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const seen = new Set<string>();
  const raw = [env['GUILD_ID'] ?? '', env['GUILD_IDS'] ?? ''].join(',');
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

const guildIds = parseGuildIds();

export const config = {
  token: requireEnv('DISCORD_TOKEN'),
  guildId: process.env['GUILD_ID']?.trim() || guildIds[0] || '',
  guildIds,
  clientId: requireEnv('CLIENT_ID'),
};
