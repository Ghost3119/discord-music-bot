import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { RepeatMode } from 'distube';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { BotColors } from '../utils/colors';

export const loop: Command = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Configura el modo de repetición')
    .addStringOption((opt) =>
      opt
        .setName('modo')
        .setDescription('Modo de repetición')
        .setRequired(true)
        .addChoices(
          { name: 'Desactivado', value: 'off' },
          { name: 'Canción', value: 'song' },
          { name: 'Cola', value: 'queue' },
        ),
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

    const modeChoice = interaction.options.getString('modo', true);

    let mode: RepeatMode;
    let message: string;

    switch (modeChoice) {
      case 'song':
        mode = RepeatMode.SONG;
        message = '🔂 Repitiendo la canción actual.';
        break;
      case 'queue':
        mode = RepeatMode.QUEUE;
        message = '🔁 Repitiendo toda la cola.';
        break;
      case 'off':
      default:
        mode = RepeatMode.DISABLED;
        message = '▶️ Modo de repetición desactivado.';
        break;
    }

    queue.setRepeatMode(mode);

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(BotColors.Info).setDescription(message)],
    });
  },
};
