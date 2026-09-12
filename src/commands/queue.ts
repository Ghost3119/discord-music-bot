import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { createQueueEmbed } from '../utils/embed';

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

    await interaction.reply({ embeds: [createQueueEmbed(queue)] });
  },
};
