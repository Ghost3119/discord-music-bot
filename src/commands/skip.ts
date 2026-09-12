import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const skip: Command = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Salta a la siguiente canción en la cola'),

  async execute(interaction) {
    const guild = await ensureGuild(interaction);
    if (!guild) return;

    const distube = interaction.client.distube;
    const queue = distube.getQueue(guild.id);

    if (!queue) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const song = await queue.skip();
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Success).setDescription(`⏭️ Saltando a: **${song.name}**`),
        ],
      });
    } catch {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay más canciones en la cola.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};