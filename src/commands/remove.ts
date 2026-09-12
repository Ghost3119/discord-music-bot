import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const remove: Command = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Elimina una canción de la cola')
    .addIntegerOption((opt) =>
      opt
        .setName('posicion')
        .setDescription('Posición de la canción en la cola')
        .setRequired(true)
        .setMinValue(1),
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

    const position = interaction.options.getInteger('posicion', true);

    if (position < 1 || position >= queue.songs.length) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BotColors.Error)
            .setDescription('❌ Posición no válida en la cola.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [removedSong] = queue.songs.splice(position, 1);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(BotColors.Info)
          .setDescription(`🗑️ Canción eliminada: **${removedSong?.name ?? 'Canción desconocida'}**`),
      ],
    });
  },
};
