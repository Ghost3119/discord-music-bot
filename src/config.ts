import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`❌ Variable de entorno requerida no encontrada: ${key}`);
  }
  return value;
}

export const config = {
  token: requireEnv('DISCORD_TOKEN'),
  guildId: requireEnv('GUILD_ID'),
  clientId: requireEnv('CLIENT_ID'),
};
