import { Interaction, MessageFlags, InteractionReplyOptions } from 'discord.js';
import { commands } from '../commands';

export async function handleInteraction(interaction: Interaction) {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.find((cmd) => cmd.data.name === interaction.commandName);

  if (!command) {
    console.warn(`Comando desconocido: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error ejecutando /${interaction.commandName}:`, error);

    const reply: InteractionReplyOptions = {
      content: '❌ Hubo un error al ejecutar el comando.',
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}
