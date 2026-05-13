import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { ButtonId, createPlayerButtons, createNowPlayingEmbed } from '../utils/embed';

export async function handleButton(interaction: ButtonInteraction) {
  if (!interaction.guild) return;

  const distube = interaction.client.distube;
  const queue = distube.getQueue(interaction.guild.id);

  if (!interaction.member || !('voice' in interaction.member)) return;
  const member = interaction.guild.members.cache.get(interaction.user.id);
  if (!member?.voice.channel) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Debes estar en un canal de voz.')],
      flags: 'Ephemeral' as any,
    });
    return;
  }

  switch (interaction.customId) {
    case ButtonId.PauseResume: {
      if (!queue) {
        await interaction.reply({ content: '❌ No hay cola.', flags: ['Ephemeral'] as any });
        return;
      }
      if (queue.paused) {
        distube.resume(interaction.guild.id);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription('▶️ Música reanudada.')] });
      } else {
        distube.pause(interaction.guild.id);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFA500').setDescription('⏸️ Música pausada.')] });
      }
      const song = queue.songs[0];
      const row = createPlayerButtons(queue.paused);
      await interaction.message.edit({ components: [row] }).catch(() => {});
      break;
    }

    case ButtonId.Skip: {
      if (!queue) {
        await interaction.reply({ content: '❌ No hay cola.', flags: ['Ephemeral'] as any });
        return;
      }
      try {
        const song = await queue.skip();
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`⏭️ Saltando a: **${song.name}**`)],
        });
      } catch {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay más canciones.')],
          flags: 'Ephemeral' as any,
        });
      }
      break;
    }

    case ButtonId.Stop: {
      if (!queue) {
        await interaction.reply({ content: '❌ No hay cola.', flags: ['Ephemeral'] as any });
        return;
      }
      distube.stop(interaction.guild.id);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('⏹️ Música detenida.')],
      });
      break;
    }

    case ButtonId.Queue: {
      if (!queue) {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ No hay cola.')],
          flags: 'Ephemeral' as any,
        });
        return;
      }
      const songs = queue.songs;
      const nowPlaying = songs[0];
      const upcoming = songs.slice(1, 11);
      const description = upcoming
        .map((s, i) => `${i + 1}. **${s.name}** — \`${s.formattedDuration}\``)
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
      await interaction.reply({ embeds: [embed], flags: 'Ephemeral' as any });
      break;
    }
  }
}