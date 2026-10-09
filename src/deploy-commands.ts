import 'dotenv/config';
import './types';
import { createHash } from 'node:crypto';
import { REST, Routes } from 'discord.js';
import { commands } from './commands';
import { installLogs } from './runtime/logger';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Opción no válida. Usa --dry-run para comprobar los comandos sin registrarlos.');
  const body = commands.map(command => command.data.toJSON());
  const names = body.map(command => command.name);
  if (new Set(names).size !== names.length) throw new Error('Hay nombres de comandos duplicados; no se registró ningún comando.');
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  console.log(`Comprobados ${body.length} comandos: ${names.join(', ')}.`);
  console.log(`SHA-256 del registro: ${digest}`);
  if (args.includes('--dry-run')) {
    console.log('✅ Comprobación local correcta. No se contactó con Discord ni se inició el bot.');
    return;
  }

  // Configuration is intentionally loaded only for a real registration.
  const { config } = await import('./config');
  if (![config.clientId, config.guildId].every(id => /^\d{15,22}$/.test(id))) throw new Error('CLIENT_ID y GUILD_ID deben ser identificadores válidos de Discord.');
  const rest = new REST({ version: '10', timeout: 15_000, retries: 2, rejectOnRateLimit: () => true }).setToken(config.token);
  console.log(`Registrando ${body.length} comandos slash...`);
  const result = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  if (!Array.isArray(result) || result.length !== body.length || names.some(name => !result.some(command => command?.name === name))) {
    throw new Error('Discord devolvió un registro distinto del esperado. Revisa los comandos antes de iniciar la versión nueva.');
  }
  console.log('✅ Comandos registrados correctamente.');
}

if (require.main === module) {
  const logs = installLogs('deploy');
  void main().catch((error: unknown) => {
    console.error('❌ Error registrando comandos:', error);
    process.exitCode = 1;
  }).finally(() => logs.close());
}
