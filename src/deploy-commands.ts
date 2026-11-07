import 'dotenv/config';
import './types';
import { createHash } from 'node:crypto';
import { REST, Routes } from 'discord.js';
import { commands } from './commands';
import { installLogs } from './runtime/logger';

interface DeployOptions {
  dryRun: boolean;
  global: boolean;
  guildIds: string[];
}

function parseDeployArgs(args: string[]): DeployOptions {
  let dryRun = false;
  let global = process.env['COMMAND_SCOPE']?.trim().toLowerCase() === 'global';
  const guildIds: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--global') {
      global = true;
    } else if (arg === '--guild') {
      const next = args[++i];
      if (!next) throw new Error('Falta el ID del servidor después de --guild.');
      for (const id of next.split(',').map((part) => part.trim()).filter(Boolean)) guildIds.push(id);
    } else if (arg.startsWith('--guild=')) {
      const raw = arg.slice('--guild='.length);
      const parsed = raw.split(',').map((part) => part.trim()).filter(Boolean);
      if (!parsed.length) throw new Error('Falta el ID del servidor en --guild=<id>.');
      guildIds.push(...parsed);
    } else {
      throw new Error('Opción no válida. Usa --dry-run, --global o --guild <id>.');
    }
  }

  if (global && guildIds.length) {
    throw new Error('No combines --global con --guild <id>.');
  }

  return { dryRun, global, guildIds: [...new Set(guildIds)] };
}

function verifyRegistrationResult(result: unknown, expectedCount: number, expectedNames: string[]): void {
  if (
    !Array.isArray(result) ||
    result.length !== expectedCount ||
    expectedNames.some((name) => !result.some((command) => (command as { name?: string } | null)?.name === name))
  ) {
    throw new Error(
      'Discord devolvió un registro distinto del esperado. Revisa los comandos antes de iniciar la versión nueva.',
    );
  }
}

async function main(): Promise<void> {
  const options = parseDeployArgs(process.argv.slice(2));
  const body = commands.map((command) => command.data.toJSON());
  const names = body.map((command) => command.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Hay nombres de comandos duplicados; no se registró ningún comando.');
  }
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  console.log(`Comprobados ${body.length} comandos: ${names.join(', ')}.`);
  console.log(`SHA-256 del registro: ${digest}`);
  if (options.dryRun) {
    console.log('✅ Comprobación local correcta. No se contactó con Discord ni se inició el bot.');
    return;
  }

  // Configuration is intentionally loaded only for a real registration.
  const { config } = await import('./config');
  if (!/^\d{15,22}$/.test(config.clientId)) {
    throw new Error('CLIENT_ID debe ser un identificador válido de Discord.');
  }

  const rest = new REST({ version: '10', timeout: 15_000, retries: 2, rejectOnRateLimit: () => true }).setToken(
    config.token,
  );

  if (options.global) {
    console.log(`Registrando ${body.length} comandos slash globales...`);
    const result = await rest.put(Routes.applicationCommands(config.clientId), { body });
    verifyRegistrationResult(result, body.length, names);
    console.log('✅ Comandos registrados correctamente (alcance global).');
    return;
  }

  const targetGuilds = options.guildIds.length ? options.guildIds : config.guildIds;
  if (!targetGuilds.length || !targetGuilds.every((id) => /^\d{15,22}$/.test(id))) {
    throw new Error('CLIENT_ID y GUILD_ID/GUILD_IDS deben ser identificadores válidos de Discord.');
  }

  console.log(
    `Registrando ${body.length} comandos slash en ${targetGuilds.length} ${
      targetGuilds.length === 1 ? 'servidor' : 'servidores'
    }...`,
  );
  for (const guildId of targetGuilds) {
    const result = await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body });
    verifyRegistrationResult(result, body.length, names);
  }
  console.log('✅ Comandos registrados correctamente.');
}

if (require.main === module) {
  const logs = installLogs('deploy');
  void main()
    .catch((error: unknown) => {
      console.error('❌ Error registrando comandos:', error);
      process.exitCode = 1;
    })
    .finally(() => logs.close());
}
