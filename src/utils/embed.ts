import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { Queue, Song } from 'distube';
import { BotColors } from './colors';

export enum ButtonId {
  PauseResume = 'btn_pause_resume',
  Skip = 'btn_skip',
  Stop = 'btn_stop',
  Queue = 'btn_queue',
}

export function createPlayerButtons(paused = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ButtonId.PauseResume)
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ButtonId.Skip).setEmoji('⏭️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ButtonId.Stop).setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ButtonId.Queue).setEmoji('📋').setStyle(ButtonStyle.Secondary),
  );
}

export function createProgressBar(currentMs: number, totalMs: number, barLength = 15): string {
  if (totalMs <= 0) return '`En vivo`';

  const progress = Math.min(currentMs / totalMs, 1);
  const filled = Math.round(progress * barLength);
  const empty = barLength - filled;
  const bar = '▓'.repeat(filled) + '░'.repeat(empty);
  return `\`${bar}\` [${formatDuration(currentMs)} / ${formatDuration(totalMs)}]`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function createNowPlayingEmbed(song: Song, currentMs?: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BotColors.Success)
    .setTitle('🎵 Reproduciendo')
    .setDescription(`**${song.name ?? 'Canción sin título'}**`)
    .addFields(
      { name: 'Duración', value: song.formattedDuration, inline: true },
      { name: 'Solicitada por', value: song.member?.displayName ?? 'Desconocido', inline: true },
      { name: 'Fuente', value: (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source, inline: true },
    )
    .setThumbnail(song.thumbnail ?? null)
    .setTimestamp();

  if (song.url) {
    embed.setURL(song.url);
  }

  if (currentMs !== undefined && song.duration > 0) {
    embed.addFields({
      name: 'Progreso',
      value: createProgressBar(currentMs, song.duration * 1000),
      inline: false,
    });
  }

  return embed;
}

export function createAddQueueEmbed(song: Song): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BotColors.Info)
    .setDescription(`📥 Añadida a la cola: **${song.name ?? 'Canción sin título'}** — \`${song.formattedDuration}\``);
}

export function createQueueEmbed(queue: Queue): EmbedBuilder {
  const songs = queue.songs;
  const nowPlaying = songs[0];

  if (!nowPlaying) {
    return new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay cola de reproducción.');
  }

  const upcoming = songs.slice(1, 11);
  const description = upcoming
    .map((song, i) => `${i + 1}. **${song.name}** — \`${song.formattedDuration}\``)
    .join('\n');
  const remaining = songs.length - 1 > 10 ? `\n...y ${songs.length - 11} más.` : '';

  return new EmbedBuilder()
    .setColor(BotColors.Info)
    .setTitle('🎵 Cola de Reproducción')
    .setDescription(
      `**Reproduciendo:** ${nowPlaying.name} — \`${nowPlaying.formattedDuration}\`\n\n${description || '_No hay canciones en espera._'}${remaining}`,
    )
    .setFooter({ text: `Total: ${songs.length} canciones` })
    .setTimestamp();
}
