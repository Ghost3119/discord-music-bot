import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const shuffle: Command = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Mezcla las canciones de la cola'),

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

    await queue.shuffle();
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Info).setDescription('🔀 Cola mezclada.')],
    });
  },
};
