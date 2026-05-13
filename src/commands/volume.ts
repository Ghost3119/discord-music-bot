import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';

export const volume: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Ajusta el volumen del bot')
    .addIntegerOption((opt) =>
      opt.setName('valor').setDescription('Volumen del 1 al 100').setRequired(true).setMinValue(1).setMaxValue(100),
    ) as SlashCommandBuilder,

  async execute(interaction) {
    const distube = interaction.client.distube;
    const queue = distube.getQueue(interaction.guild!.id);

    if (!queue) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay música reproduciéndose.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const vol = interaction.options.getInteger('valor', true);
    distube.setVolume(interaction.guild!.id, vol);

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(`🔊 Volumen ajustado a **${vol}%**`)],
    });
  },
};