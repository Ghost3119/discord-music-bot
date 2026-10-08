import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { Queue, RepeatMode, Song } from 'distube';
import { BotColors } from './colors';
import { getPlaybackState, playbackLabel } from '../music/playbackState';

export enum ButtonId {
  PauseResume = 'btn_pause_resume',
  Skip = 'btn_skip',
  Stop = 'btn_stop',
  Queue = 'btn_queue',
  History = 'btn_history',
  Retry = 'btn_retry',
}

export function createPlayerButtons(paused = false, disabled = false, skipDisabled = false, blocked = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(blocked ? ButtonId.Retry : ButtonId.PauseResume)
      .setEmoji(blocked ? '🔄' : paused ? '▶️' : '⏸️')
      .setLabel(blocked ? 'Reintentar' : paused ? 'Reanudar' : 'Pausar')
      .setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(ButtonId.Skip).setEmoji('⏭️').setLabel('Siguiente')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled || skipDisabled || blocked),
    new ButtonBuilder().setCustomId(ButtonId.Queue).setEmoji('📋').setLabel('Cola')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(ButtonId.Stop).setEmoji('⏹️').setLabel('Detener')
      .setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId(ButtonId.History).setEmoji('🕘').setLabel('Historial')
      .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

export function createProgressBar(currentMs: number, totalMs: number, barLength = 15): string {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return '`🔴 En vivo`';

  const position = Number.isFinite(currentMs) ? Math.max(0, Math.min(currentMs, totalMs)) : 0;
  const length = Number.isFinite(barLength) ? Math.max(1, Math.min(30, Math.floor(barLength))) : 15;
  const filled = Math.round(position / totalMs * length);
  const bar = '▰'.repeat(filled) + '▱'.repeat(length - filled);
  return `\`${formatDuration(position)} ${bar} ${formatDuration(totalMs)}\``;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

interface PlayerDetails {
  status?: string | undefined;
  remaining?: string | undefined;
  paused?: boolean;
  volume?: number;
  nextSong?: Song | undefined;
  queued?: number;
  autoplay?: boolean;
  repeatMode?: RepeatMode;
  ended?: string | undefined;
}

function httpUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function createNowPlayingEmbed(song: Song, currentMs = 0, details: PlayerDetails = {}): EmbedBuilder {
  const status = details.ended ?? details.status ?? (details.paused ? '⏸ En pausa' : '▶ Reproduciendo');
  const audioSource = (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source;
  const source = ({ youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify', apple_music: 'Apple Music' } as Record<string, string>)[audioSource] ?? audioSource;
  const repeat = details.repeatMode === RepeatMode.SONG ? ' · Repetir canción' : details.repeatMode === RepeatMode.QUEUE ? ' · Repetir cola' : '';
  const embed = new EmbedBuilder()
    .setColor(!details.ended && details.paused ? BotColors.Warning : BotColors.Info)
    .setAuthor({ name: status })
    .setTitle((song.name || 'Canción sin título').slice(0, 256))
    .setDescription(details.ended ? 'Añade otra canción con `/play`.' : createProgressBar(currentMs, song.duration * 1000, 12))
    .addFields(
      { name: 'Solicitada por', value: escapeMarkdown((song.member?.displayName || 'Desconocido').slice(0, 80)), inline: true },
      { name: 'Volumen', value: `${details.volume ?? 100} %`, inline: true },
    )
    .setImage(httpUrl(song.thumbnail ?? (song.stream.playFromSource ? undefined : song.stream.song?.thumbnail)))
    .setURL(httpUrl(song.url))
    .setFooter({ text: `${source} · ${details.ended ? 0 : details.queued ?? 0} en espera · Radio ${details.autoplay ? 'activada' : 'desactivada'}${repeat}`.slice(0, 2048) });
  if (!details.ended) {
    if (details.remaining) embed.addFields({ name: 'Tiempo restante de la cola actual', value: details.remaining });
    embed.addFields({ name: 'A continuación', value: details.nextSong
      ? `${escapeMarkdown((details.nextSong.name || 'Canción sin título').slice(0, 180))} · \`${details.nextSong.formattedDuration}\``
      : details.autoplay ? 'Buscaré una canción relacionada al terminar.' : 'No hay canciones en espera.' });
  }

  return embed;
}

export function createAddQueueEmbed(song: Song): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BotColors.Info)
    .setDescription(`📥 Añadida a la cola: **${song.name ?? 'Canción sin título'}** — \`${song.formattedDuration}\``);
}

export const QUEUE_PAGE_SIZE = 10;

export function queueEstimates(queue: Queue): (number | null)[] {
  const state = getPlaybackState(queue);
  const unavailable = state && ['preparing', 'recovering', 'alternative', 'blocked', 'disconnected'].includes(state.mode);
  let seconds: number | null = unavailable || queue.repeatMode === RepeatMode.SONG ? null : 0;
  return queue.songs.map((song, index) => {
    const start = seconds;
    if (!song.duration || !Number.isFinite(song.duration) || song.isLive) seconds = null;
    else if (seconds !== null) seconds += index === 0 ? Math.max(0, song.duration - (Number.isFinite(queue.currentTime) ? queue.currentTime : 0)) : song.duration;
    return start;
  });
}

export function queueRemaining(queue: Queue): string {
  if (queue.repeatMode === RepeatMode.SONG) return 'Repetición de canción · sin estimación';
  const state = getPlaybackState(queue);
  if (state && ['preparing', 'recovering', 'alternative', 'blocked', 'disconnected'].includes(state.mode)) return 'Estimación no disponible';
  if (queue.songs.some(song => !song.duration || !Number.isFinite(song.duration) || song.isLive)) return 'Duración desconocida o emisión en vivo';
  const seconds = queue.songs.reduce((sum, song, index) => sum + (index ? song.duration : Math.max(0, song.duration - (queue.currentTime || 0))), 0);
  return `≈ ${formatDuration(seconds * 1000)}${queue.paused ? ' desde la reanudación' : ''}${queue.repeatMode === RepeatMode.QUEUE ? ' · ciclo actual' : ''}`;
}

export function queuePage(queue: Queue, requested = 0): { page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(Math.max(0, queue.songs.length - 1) / QUEUE_PAGE_SIZE));
  const page = Number.isFinite(requested) ? Math.max(0, Math.min(pages - 1, Math.floor(requested))) : 0;
  return { page, pages };
}

export function createQueueButtons(queue: Queue, session: string, requested = 0): ActionRowBuilder<ButtonBuilder>[] {
  const { page, pages } = queuePage(queue, requested);
  if (pages === 1) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`queue_page:${session}:${Math.max(0, page - 1)}`).setLabel('Anterior')
      .setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    // Disabled buttons also need unique IDs. The indicator must not share the
    // previous/next page ID at the first or last page.
    new ButtonBuilder().setCustomId(`queue_page_indicator:${session}:${page}`).setLabel(`${page + 1} / ${pages}`)
      .setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`queue_page:${session}:${Math.min(pages - 1, page + 1)}`).setLabel('Siguiente')
      .setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
  )];
}

export function createQueueEmbed(queue: Queue, requested = 0): EmbedBuilder {
  const songs = queue.songs;
  const nowPlaying = songs[0];

  if (!nowPlaying) {
    return new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay cola de reproducción.');
  }

  const { page, pages } = queuePage(queue, requested);
  const offset = 1 + page * QUEUE_PAGE_SIZE;
  const upcoming = songs.slice(offset, offset + QUEUE_PAGE_SIZE);
  const estimates = queueEstimates(queue);
  const description = upcoming
    .map((song, i) => `${offset + i}. **${escapeMarkdown((song.name || 'Canción sin título').slice(0, 150))}** — \`${song.formattedDuration}\`\n` +
      (estimates[offset + i] == null ? 'Inicio sin estimación' : `≈ ${formatDuration(estimates[offset + i]! * 1000)} ${queue.paused ? 'al reanudar' : 'para empezar'}`))
    .join('\n');
  const remainingTime = songs.slice(1).reduce((total, song) => total + (Number.isFinite(song.duration) ? song.duration : 0), 0);
  const remaining = songs.slice(1).some((song) => song.isLive) ? 'Incluye emisiones en vivo' : `${formatDuration(remainingTime * 1000)} en espera`;

  return new EmbedBuilder()
    .setColor(BotColors.Info)
    .setTitle('🎵 Cola de Reproducción')
    .setDescription(
      `**${playbackLabel(queue)}:** ${escapeMarkdown((nowPlaying.name || 'Canción sin título').slice(0, 150))} — \`${nowPlaying.formattedDuration}\`\n\n${description || '_No hay canciones en espera._'}`,
    )
    .setFooter({ text: `${songs.length - 1} en espera · ${remaining} · Página ${page + 1}/${pages}` });
}
