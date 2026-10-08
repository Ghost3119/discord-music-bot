import { EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { Command } from './command.types';
import { ensureGuild } from '../utils/guard';
import { getPlaybackState, playbackLabel } from '../music/playbackState';
import { getPlaybackHealth } from '../music/playbackHealth';
import { historyView } from '../music/historyView';
import { formatDuration } from '../utils/embed';

export const estado: Command = { data: new SlashCommandBuilder().setName('estado').setDescription('Diagnóstico privado de la música y la conexión'), async execute(interaction) {
  const guild = await ensureGuild(interaction); if (!guild) return;
  const queue = interaction.client.distube.getQueue(guild.id), state = queue ? getPlaybackState(queue) : undefined;
  const song = queue?.songs[0];
  const source = song ? (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source : '—';
  const lastFailed = getPlaybackHealth(interaction.client.distube)?.history.list(guild.id).find(entry => entry.result === 'failed');
  const error = state?.lastError ?? (lastFailed ? { code: lastFailed.code, reference: lastFailed.reference, time: lastFailed.time } : undefined);
  const embed = new EmbedBuilder().setColor(state?.blocked ? 0xED4245 : 0x5865F2).setTitle('🩺 Estado de música')
    .addFields(
      { name: 'Discord', value: interaction.client.isReady() ? `Conectado · ${Math.max(0, Math.round(interaction.client.ws.ping))} ms` : 'Reconectando', inline: true },
      { name: 'Tiempo activo', value: formatDuration(process.uptime() * 1000), inline: true },
      { name: 'Reproducción', value: queue ? playbackLabel(queue) : 'Sin cola', inline: true },
      { name: 'Voz', value: queue?.voiceChannel && !queue.voice.isDisconnected ? escapeMarkdown(queue.voiceChannel.name) : 'Sin conexión', inline: true },
      { name: 'Canción / fuente', value: `${escapeMarkdown((song?.name ?? '—').slice(0, 160))}\n${source}`, inline: false },
      { name: 'Recuperación', value: `${state?.attempt ?? 0}/3 · ${state?.failures.filter(time => Date.now() - time < 300_000).length ?? 0} fallos en 5 min`, inline: true },
      { name: 'Último avance', value: state?.lastProgress ? `<t:${Math.floor(state.lastProgress / 1000)}:R>` : 'Todavía no confirmado', inline: true },
      { name: 'Último error', value: error ? `${error.code} · Ref. ${error.reference}\n<t:${Math.floor(error.time / 1000)}:R>` : 'Sin errores registrados', inline: false });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
} };

export const historial: Command = { data: new SlashCommandBuilder().setName('historial').setDescription('Últimas canciones y reintentos del servidor'), async execute(interaction) {
  const guild = await ensureGuild(interaction); if (!guild) return;
  const history = getPlaybackHealth(interaction.client.distube)?.history;
  if (!history) { await interaction.reply({ content: 'El historial todavía no está disponible.', flags: MessageFlags.Ephemeral }); return; }
  await interaction.reply({ ...historyView(history, guild.id), flags: MessageFlags.Ephemeral });
} };
