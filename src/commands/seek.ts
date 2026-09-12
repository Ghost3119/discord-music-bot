import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';
import { formatDuration } from '../utils/embed';

export const seek: Command = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Ajusta la posición de reproducción')
    .addIntegerOption((opt) =>
      opt
        .setName('segundos')
        .setDescription('Posición en segundos')
        .setRequired(true)
        .setMinValue(0),
    ) as SlashCommandBuilder,

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const queue = interaction.client.distube.getQueue(guild.id);

    if (!queue) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const seconds = interaction.options.getInteger('segundos', true);
    await queue.seek(seconds);

    const formattedTime = formatDuration(seconds * 1000);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(BotColors.Info)
          .setDescription(`⏩ Posición ajustada a **${formattedTime}**.`),
      ],
    });
  },
};
