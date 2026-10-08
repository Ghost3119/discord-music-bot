import { Interaction, MessageFlags, InteractionReplyOptions } from 'discord.js';
import { commands } from '../commands';
import { describeMusicError } from '../music/errors';
import { handleButton } from './buttonHandler';
import { getPlayerPanels } from '../music/playerPanel';
import { ensureControlChannel } from '../utils/guard';
import { checkpointQueue } from '../music/queueChanges';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    await handleCommand(interaction);
  } catch (error) {
    console.error('Error procesando interacción:', error);
    if (!interaction.isRepliable()) return;
    // A failed error response (expired token, deleted channel, missing permissions)
    // must not escape the interaction boundary either.
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: describeMusicError(error), embeds: [], components: [] });
      } else if (interaction.replied) {
        await interaction.followUp({ content: describeMusicError(error), flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: describeMusicError(error), flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      console.error('No se pudo informar el error de interacción:', replyError);
    }
  }
}

async function handleCommand(interaction: Interaction) {
  if (interaction.isAutocomplete()) {
    const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
    if (!command?.autocomplete) return;

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`Error en autocomplete para /${interaction.commandName}:`, error);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.find((cmd) => cmd.data.name === interaction.commandName);

  if (!command) {
    console.warn(`Comando desconocido: ${interaction.commandName}`);
    return;
  }

  try {
    const controlled = new Set(['play', 'search', 'skip', 'stop', 'pause', 'resume', 'volume', 'shuffle', 'remove', 'clear', 'move', 'seek', 'loop', 'autoplay', 'recommend']);
    const existing = interaction.guildId ? interaction.client.distube.getQueue(interaction.guildId) : undefined;
    if (existing && controlled.has(interaction.commandName) && !await ensureControlChannel(interaction, existing)) return;
    await command.execute(interaction);
    const queue = interaction.guildId ? interaction.client.distube.getQueue(interaction.guildId) : undefined;
    if (queue) { checkpointQueue(interaction.client.distube, queue); await getPlayerPanels(interaction.client.distube)?.refresh(queue); }
  } catch (error) {
    console.error(`Error ejecutando /${interaction.commandName}:`, error);

    const reply: InteractionReplyOptions = {
      content: describeMusicError(error),
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: describeMusicError(error), embeds: [], components: [], allowedMentions: { parse: [] } }).catch(() => {});
    } else if (interaction.replied) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}
