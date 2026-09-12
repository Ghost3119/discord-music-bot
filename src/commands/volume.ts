import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const volume: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajusta el volumen del bot')
    .addIntegerOption((opt) =>
      opt.setName('valor').setDescription('Volumen del 1 al 100').setRequired(true).setMinValue(1).setMaxValue(100),
    ) as SlashCommandBuilder,

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const distube = interaction.client.distube;
    const queue = distube.getQueue(guild.id);

    if (!queue) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const vol = interaction.options.getInteger('valor', true);
    distube.setVolume(guild.id, vol);

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Info).setDescription(`🔊 Volumen ajustado a **${vol}%**`)],
    });
  },
};