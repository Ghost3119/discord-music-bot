import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { createQueueButtons, createQueueEmbed } from '../utils/embed';
import { getPlayerPanels } from '../music/playerPanel';

export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Muestra la lista de reproducción actual'),

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const distube = interaction.client.distube;
    const queue = distube.getQueue(guild.id);

    if (!queue) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay cola de reproducción.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = getPlayerPanels(distube)?.session(queue);
    await interaction.reply({ embeds: [createQueueEmbed(queue)], components: session ? createQueueButtons(queue, session) : [],
      flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};
