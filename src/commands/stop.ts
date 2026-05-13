import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';

export const stop: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Detiene la música y desconecta al bot del canal'),

  async execute(interaction) {
    const distube = interaction.client.distube;
    const queue = distube.getQueue(interaction.guild!.id);

    if (!queue) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay música reproduciéndose.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    distube.stop(interaction.guild!.id);
    await interaction.reply({
      embeds: [
        new EmbedBuilder().setColor('#FF0000').setDescription('⏹️ Música detenida. ¡Hasta luego!'),
      ],
    });
  },
};