import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';

export const skip: Command = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Salta a la siguiente canción en la cola'),

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

    try {
      const song = await queue.skip();
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor('#00FF00').setDescription(`⏭️ Saltando a: **${song.name}**`),
        ],
      });
    } catch {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay más canciones en la cola.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};