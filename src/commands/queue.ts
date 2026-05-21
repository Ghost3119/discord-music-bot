import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { Command } from './command.types';

export const queue: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Muestra la lista de reproducción actual'),

  async execute(interaction) {
    const distube = interaction.client.distube;
    const queue = distube.getQueue(interaction.guild!.id);

    if (!queue) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay cola de reproducción.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const songs = queue.songs;
    const nowPlaying = songs[0];

    if (!nowPlaying) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay cola de reproducción.'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const upcoming = songs.slice(1, 11);

    const description = upcoming
      .map((song, i) => `${i + 1}. **${song.name}** — \`${song.formattedDuration}\``)
      .join('\n');

    const remaining = songs.length - 1 > 10 ? `\n...y ${songs.length - 11} más.` : '';

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎵 Cola de Reproducción')
      .setDescription(
        `**Reproduciendo:** ${nowPlaying.name} — \`${nowPlaying.formattedDuration}\`\n\n${description || '_No hay canciones en espera._'}${remaining}`,
      )
      .setFooter({ text: `Total: ${songs.length} canciones` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
