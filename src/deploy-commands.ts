import './types';
import { REST, Routes } from 'discord.js';
import { config } from './config';
import { commands } from './commands';

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log(`Registrando ${commands.length} comandos slash...`);

    const body = commands.map((cmd) => cmd.data.toJSON());

    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body,
    });

    console.log('✅ Comandos registrados correctamente.');
  } catch (error) {
    console.error('❌ Error registrando comandos:', error);
  }
})();