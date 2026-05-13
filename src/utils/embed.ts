import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

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

export function createNowPlayingEmbed(song: any, currentMs?: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle('🎵 Reproduciendo')
    .setDescription(`**${song.name}**`)
    .addFields(
      { name: 'Duración', value: song.formattedDuration, inline: true },
      { name: 'Solicitada por', value: song.member?.displayName ?? 'Desconocido', inline: true },
    )
    .setThumbnail(song.thumbnail ?? null)
    .setURL(song.url)
    .setTimestamp();

  if (currentMs !== undefined && song.duration > 0) {
    embed.addFields({
      name: 'Progreso',
      value: createProgressBar(currentMs, song.duration * 1000),
      inline: false,
    });
  }

  return embed;
}

export function createAddQueueEmbed(song: any): EmbedBuilder {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setDescription(`📥 Añadida a la cola: **${song.name}** — \`${song.formattedDuration}\``);
}