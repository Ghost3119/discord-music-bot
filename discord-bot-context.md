This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.
The content has been processed where line numbers have been added.

# File Summary

## Purpose
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: **/.env*, **/cookies.json, **/data/**, **/logs/**
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Line numbers have been added to the beginning of each line
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
````
docs/
  OPERACION.md
  PLAN_MEJORAS.md
scripts/
  logger.cjs
  supervise.cjs
  update-ytdlp.cjs
src/
  commands/
    autoplay.ts
    command.types.ts
    diagnostics.ts
    index.ts
    loop.ts
    nowplaying.ts
    pause.ts
    play.ts
    queue.ts
    queueManagement.ts
    recommend.ts
    remove.ts
    resume.ts
    search.ts
    seek.ts
    shuffle.ts
    skip.ts
    stop.ts
    volume.ts
  events/
    buttonHandler.ts
    interactionCreate.ts
    ready.ts
  music/
    distube.ts
    emptyVoice.ts
    errors.ts
    events.ts
    history.ts
    historyView.ts
    playbackHealth.ts
    playbackRecovery.ts
    playbackState.ts
    playerPanel.ts
    queueActions.ts
    queueChanges.ts
    queueRecovery.ts
    recoveryNotices.ts
    streamErrors.ts
    ytDlpRunner.ts
    ytDlpSearchPlugin.ts
  runtime/
    instanceLock.ts
    logger.ts
    safety.ts
  utils/
    appleMusic.ts
    colors.ts
    embed.ts
    guard.ts
    searchHelper.ts
    suggestions.ts
  bootstrap.ts
  config.ts
  deploy-commands.ts
  index.ts
  types.ts
test/
  autoplay.test.js
  deploy.test.js
  distube-config.test.js
  historyPersistence.test.js
  instanceLock.test.js
  logger.test.js
  musicErrors.test.js
  operations.test.js
  play-errors.test.js
  playbackRecovery.test.js
  playerPanel.test.js
  queueRecovery.test.js
  recommend-command.test.js
  recommend.test.js
  resilience.test.js
  search.test.js
  streamErrors.test.js
  supervisor.test.js
  voiceLifecycle.test.js
.gitignore
package.json
README.md
test_mix.js
tsconfig.json
````

# Files

## File: scripts/update-ytdlp.cjs
````javascript
1: const { spawn } = require('node:child_process');
2: const path = require('node:path');
3: require('dotenv').config();
4: const directory = process.env.YTDLP_DIR || path.join(path.dirname(require.resolve('@distube/yt-dlp')), '..', 'bin');
5: const filename = process.env.YTDLP_FILENAME || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
6: const child = spawn(path.join(directory, filename), ['--update'], { stdio: 'inherit', windowsHide: true, timeout: 60000 });
7: child.on('error', (error) => { console.error('No se pudo actualizar yt-dlp:', error); process.exitCode = 1; });
8: child.on('exit', (code) => { process.exitCode = code === 0 ? 0 : 1; });
````

## File: src/commands/autoplay.ts
````typescript
 1: import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: 
 6: export const autoplay: Command = {
 7:   data: new SlashCommandBuilder()
 8:     .setName('autoplay')
 9:     .setDescription('Activa o desactiva la radio al terminar la cola'),
10: 
11:   async execute(interaction) {
12:     const guild = await ensureGuild(interaction);
13:     if (!guild) return;
14: 
15:     const queue = interaction.client.distube.getQueue(guild.id);
16:     if (!queue?.songs[0]) {
17:       await interaction.reply({
18:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
19:         flags: MessageFlags.Ephemeral,
20:       });
21:       return;
22:     }
23: 
24:     const member = guild.members.cache.get(interaction.user.id);
25:     if (!member?.voice.channel || member.voice.channel.id !== queue.voiceChannel?.id) {
26:       await interaction.reply({
27:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en el mismo canal de voz que el bot.')],
28:         flags: MessageFlags.Ephemeral,
29:       });
30:       return;
31:     }
32: 
33:     const enabled = queue.toggleAutoplay();
34:     await interaction.reply({
35:       embeds: [new EmbedBuilder()
36:         .setColor(BotColors.Info)
37:         .setDescription(enabled
38:           ? '▶️ Radio activada. Al terminar la cola buscaré canciones relacionadas en YouTube.'
39:           : '⏹️ Radio desactivada.')],
40:     });
41:   },
42: };
````

## File: src/commands/diagnostics.ts
````typescript
 1: import { EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { getPlaybackState, playbackLabel } from '../music/playbackState';
 5: import { getPlaybackHealth } from '../music/playbackHealth';
 6: import { historyView } from '../music/historyView';
 7: import { formatDuration } from '../utils/embed';
 8: 
 9: export const estado: Command = { data: new SlashCommandBuilder().setName('estado').setDescription('Diagnóstico privado de la música y la conexión'), async execute(interaction) {
10:   const guild = await ensureGuild(interaction); if (!guild) return;
11:   const queue = interaction.client.distube.getQueue(guild.id), state = queue ? getPlaybackState(queue) : undefined;
12:   const song = queue?.songs[0];
13:   const source = song ? (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source : '—';
14:   const lastFailed = getPlaybackHealth(interaction.client.distube)?.history.list(guild.id).find(entry => entry.result === 'failed');
15:   const error = state?.lastError ?? (lastFailed ? { code: lastFailed.code, reference: lastFailed.reference, time: lastFailed.time } : undefined);
16:   const embed = new EmbedBuilder().setColor(state?.blocked ? 0xED4245 : 0x5865F2).setTitle('🩺 Estado de música')
17:     .addFields(
18:       { name: 'Discord', value: interaction.client.isReady() ? `Conectado · ${Math.max(0, Math.round(interaction.client.ws.ping))} ms` : 'Reconectando', inline: true },
19:       { name: 'Tiempo activo', value: formatDuration(process.uptime() * 1000), inline: true },
20:       { name: 'Reproducción', value: queue ? playbackLabel(queue) : 'Sin cola', inline: true },
21:       { name: 'Voz', value: queue?.voiceChannel && !queue.voice.isDisconnected ? escapeMarkdown(queue.voiceChannel.name) : 'Sin conexión', inline: true },
22:       { name: 'Canción / fuente', value: `${escapeMarkdown((song?.name ?? '—').slice(0, 160))}\n${source}`, inline: false },
23:       { name: 'Recuperación', value: `${state?.attempt ?? 0}/3 · ${state?.failures.filter(time => Date.now() - time < 300_000).length ?? 0} fallos en 5 min`, inline: true },
24:       { name: 'Último avance', value: state?.lastProgress ? `<t:${Math.floor(state.lastProgress / 1000)}:R>` : 'Todavía no confirmado', inline: true },
25:       { name: 'Último error', value: error ? `${error.code} · Ref. ${error.reference}\n<t:${Math.floor(error.time / 1000)}:R>` : 'Sin errores registrados', inline: false });
26:   await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
27: } };
28: 
29: export const historial: Command = { data: new SlashCommandBuilder().setName('historial').setDescription('Últimas canciones y reintentos del servidor'), async execute(interaction) {
30:   const guild = await ensureGuild(interaction); if (!guild) return;
31:   const history = getPlaybackHealth(interaction.client.distube)?.history;
32:   if (!history) { await interaction.reply({ content: 'El historial todavía no está disponible.', flags: MessageFlags.Ephemeral }); return; }
33:   await interaction.reply({ ...historyView(history, guild.id), flags: MessageFlags.Ephemeral });
34: } };
````

## File: src/commands/loop.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { RepeatMode } from 'distube';
 3: import { Command } from './command.types';
 4: import { ensureGuild } from '../utils/guard';
 5: import { BotColors } from '../utils/colors';
 6: 
 7: export const loop: Command = {
 8:   data: new SlashCommandBuilder()
 9:     .setName('loop')
10:     .setDescription('Configura el modo de repetición')
11:     .addStringOption((opt) =>
12:       opt
13:         .setName('modo')
14:         .setDescription('Modo de repetición')
15:         .setRequired(true)
16:         .addChoices(
17:           { name: 'Desactivado', value: 'off' },
18:           { name: 'Canción', value: 'song' },
19:           { name: 'Cola', value: 'queue' },
20:         ),
21:     ) as SlashCommandBuilder,
22: 
23:   async execute(interaction) {
24:     const guild = await ensureGuild(interaction);
25:     if (!guild) return;
26: 
27:     const queue = interaction.client.distube.getQueue(guild.id);
28: 
29:     if (!queue) {
30:       await interaction.reply({
31:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
32:         flags: MessageFlags.Ephemeral,
33:       });
34:       return;
35:     }
36: 
37:     const modeChoice = interaction.options.getString('modo', true);
38: 
39:     let mode: RepeatMode;
40:     let message: string;
41: 
42:     switch (modeChoice) {
43:       case 'song':
44:         mode = RepeatMode.SONG;
45:         message = '🔂 Repitiendo la canción actual.';
46:         break;
47:       case 'queue':
48:         mode = RepeatMode.QUEUE;
49:         message = '🔁 Repitiendo toda la cola.';
50:         break;
51:       case 'off':
52:       default:
53:         mode = RepeatMode.DISABLED;
54:         message = '▶️ Modo de repetición desactivado.';
55:         break;
56:     }
57: 
58:     queue.setRepeatMode(mode);
59: 
60:     await interaction.reply({
61:       embeds: [new EmbedBuilder().setColor(BotColors.Info).setDescription(message)],
62:     });
63:   },
64: };
````

## File: src/commands/queueManagement.ts
````typescript
 1: import { MessageFlags, SlashCommandBuilder } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureControlChannel, ensureGuild } from '../utils/guard';
 4: import { editQueue, QueueAction } from '../music/queueActions';
 5: 
 6: function management(name: string, description: string, options: (builder: SlashCommandBuilder) => SlashCommandBuilder,
 7:   action: (interaction: Parameters<Command['execute']>[0]) => QueueAction): Command {
 8:   return { data: options(new SlashCommandBuilder().setName(name).setDescription(description)), async execute(interaction) {
 9:     const guild = await ensureGuild(interaction);
10:     if (!guild) return;
11:     const distube = interaction.client.distube, queue = distube.getQueue(guild.id);
12:     if (!queue) { await interaction.reply({ content: '❌ No hay cola de reproducción.', flags: MessageFlags.Ephemeral }); return; }
13:     if (!await ensureControlChannel(interaction, queue)) return;
14:     await interaction.deferReply({ flags: MessageFlags.Ephemeral });
15:     const result = await editQueue(distube, queue, action(interaction), () =>
16:       guild.members.cache.get(interaction.user.id)?.voice.channel?.id === queue.voiceChannel?.id);
17:     await interaction.editReply({ content: result, allowedMentions: { parse: [] } });
18:   } };
19: }
20: export const shuffle = management('shuffle', 'Mezcla las canciones pendientes', builder => builder, () => ({ type: 'shuffle' }));
21: export const remove = management('remove', 'Retira una canción pendiente', builder => builder.addIntegerOption(option =>
22:   option.setName('posicion').setDescription('Primera pendiente: 1').setMinValue(1).setRequired(true)) as SlashCommandBuilder,
23:   interaction => ({ type: 'remove', position: interaction.options.getInteger('posicion', true) }));
24: export const clear = management('clear', 'Retira las pendientes y conserva la canción actual', builder => builder, () => ({ type: 'clear' }));
25: export const move = management('move', 'Cambia la posición de una canción pendiente', builder => builder
26:   .addIntegerOption(option => option.setName('origen').setDescription('Posición actual; primera pendiente: 1').setMinValue(1).setRequired(true))
27:   .addIntegerOption(option => option.setName('destino').setDescription('Posición final; primera pendiente: 1').setMinValue(1).setRequired(true)) as SlashCommandBuilder,
28:   interaction => ({ type: 'move', from: interaction.options.getInteger('origen', true), to: interaction.options.getInteger('destino', true) }));
````

## File: src/commands/seek.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: import { formatDuration } from '../utils/embed';
 6: 
 7: export const seek: Command = {
 8:   data: new SlashCommandBuilder()
 9:     .setName('seek')
10:     .setDescription('Ajusta la posición de reproducción')
11:     .addIntegerOption((opt) =>
12:       opt
13:         .setName('segundos')
14:         .setDescription('Posición en segundos')
15:         .setRequired(true)
16:         .setMinValue(0),
17:     ) as SlashCommandBuilder,
18: 
19:   async execute(interaction) {
20:     const guild = await ensureGuild(interaction);
21:     if (!guild) return;
22: 
23:     const queue = interaction.client.distube.getQueue(guild.id);
24: 
25:     if (!queue) {
26:       await interaction.reply({
27:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
28:         flags: MessageFlags.Ephemeral,
29:       });
30:       return;
31:     }
32: 
33:     const seconds = interaction.options.getInteger('segundos', true);
34:     await queue.seek(seconds);
35: 
36:     const formattedTime = formatDuration(seconds * 1000);
37:     await interaction.reply({
38:       embeds: [
39:         new EmbedBuilder()
40:           .setColor(BotColors.Info)
41:           .setDescription(`⏩ Posición ajustada a **${formattedTime}**.`),
42:       ],
43:     });
44:   },
45: };
````

## File: src/events/ready.ts
````typescript
1: import { Events, Client } from 'discord.js';
2: 
3: export const ready = {
4:   event: Events.ClientReady as const,
5:   once: true,
6:   execute: (client: Client) => {
7:     console.log(`✅ Bot conectado como ${client.user?.tag}`);
8:   },
9: };
````

## File: src/music/emptyVoice.ts
````typescript
 1: import { Client, Events, VoiceState } from 'discord.js';
 2: import { DisTube, Events as MusicEvents, Queue } from 'distube';
 3: import { guardedEvent } from '../runtime/safety';
 4: 
 5: /** DisTube 5 has no 'empty' event; observe actual Discord voice state changes. */
 6: export function registerEmptyVoice(client: Client, distube: DisTube, timeoutMs = 60_000): () => void {
 7:   const timers = new Map<string, ReturnType<typeof setTimeout>>();
 8:   const clear = (guildId: string) => {
 9:     const timer = timers.get(guildId);
10:     if (timer) clearTimeout(timer);
11:     timers.delete(guildId);
12:   };
13:   const onVoice = guardedEvent('Canal de voz vacío', (_oldState: VoiceState, state: VoiceState) => {
14:     const queue = distube.getQueue(state.guild.id);
15:     if (!queue) return;
16:     const channel = queue.voiceChannel;
17:     if (!channel || channel.members.some((member) => !member.user.bot)) {
18:       clear(queue.id);
19:       return;
20:     }
21:     if (timers.has(queue.id)) return;
22:     timers.set(queue.id, setTimeout(guardedEvent('Desconectar canal vacío', async () => {
23:       clear(queue.id);
24:       if (distube.getQueue(queue.id) !== queue || queue.voiceChannel?.members.some((member) => !member.user.bot)) return;
25:       await queue.stop();
26:       await queue.textChannel?.send('🔇 Canal vacío por 1 minuto — desconectando.');
27:     }), timeoutMs));
28:   });
29:   const onDelete = (queue: Queue) => clear(queue.id);
30:   client.on(Events.VoiceStateUpdate, onVoice);
31:   distube.on(MusicEvents.DELETE_QUEUE, onDelete);
32:   return () => {
33:     for (const guildId of timers.keys()) clear(guildId);
34:     client.off(Events.VoiceStateUpdate, onVoice);
35:     distube.off(MusicEvents.DELETE_QUEUE, onDelete);
36:   };
37: }
````

## File: src/music/historyView.ts
````typescript
 1: import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
 2: import { HistoryStore } from './history';
 3: 
 4: const PAGE_SIZE = 5;
 5: export function historyView(history: HistoryStore, guildId: string, requested = 0) {
 6:   const entries = history.list(guildId), pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
 7:   const page = Math.max(0, Math.min(pages - 1, Number.isFinite(requested) ? Math.floor(requested) : 0));
 8:   const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
 9:   const icons = { completed: '✅', skipped: '⏭️', failed: '❌' };
10:   const rows: ActionRowBuilder<ButtonBuilder>[] = [];
11:   const retry = visible.flatMap((entry, index) => entry.url ? [new ButtonBuilder()
12:     .setCustomId(`hist_retry:${guildId}:${entry.id}`).setLabel(`Volver a intentar ${page * PAGE_SIZE + index + 1}`).setStyle(ButtonStyle.Secondary)] : []);
13:   if (retry.length) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(retry));
14:   if (pages > 1) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
15:     new ButtonBuilder().setCustomId(`hist_page:${guildId}:${Math.max(0, page - 1)}`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
16:     new ButtonBuilder().setCustomId(`hist_indicator:${guildId}:${page}`).setLabel(`${page + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
17:     new ButtonBuilder().setCustomId(`hist_page:${guildId}:${Math.min(pages - 1, page + 1)}`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)));
18:   return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🕘 Historial de música')
19:     .setDescription(visible.map((entry, index) => `${page * PAGE_SIZE + index + 1}. ${icons[entry.result]} **${escapeMarkdown(entry.title.slice(0, 130))}**\n` +
20:       `${entry.source} · <t:${Math.floor(entry.time / 1000)}:R>${entry.code ? ` · ${entry.code}` : ''}${entry.reference ? ` · Ref. ${entry.reference}` : ''}` +
21:       (entry.alternative ? `\nAudio: ${escapeMarkdown(entry.alternative.slice(0, 130))}` : '')).join('\n\n') || 'Todavía no hay canciones en el historial.')
22:     .setFooter({ text: `${entries.length} entradas · Últimos 7 días · Página ${page + 1}/${pages}` })], components: rows, allowedMentions: { parse: [] as const } };
23: }
````

## File: src/music/playbackState.ts
````typescript
 1: import { randomBytes } from 'node:crypto';
 2: import { Queue, Song } from 'distube';
 3: 
 4: export type PlaybackMode = 'preparing' | 'playing' | 'paused' | 'recovering' | 'alternative' | 'blocked' | 'ended' | 'disconnected';
 5: export interface PlaybackState {
 6:   session: string;
 7:   mode: PlaybackMode;
 8:   attempt: number;
 9:   failures: number[];
10:   blocked: boolean;
11:   closing: boolean;
12:   probe: boolean;
13:   busy: number;
14:   revision: number;
15:   lastError: { code: string; reference: string; time: number } | undefined;
16:   errorSong: Song | undefined;
17:   lastProgress: number | undefined;
18:   resource: object | undefined;
19:   song: Song | undefined;
20:   frames: number;
21:   observedAt: number;
22:   waiting: number;
23:   continuous: number;
24:   stalled: boolean;
25: }
26: const states = new WeakMap<Queue, PlaybackState>();
27: export function getPlaybackState(queue: Queue): PlaybackState | undefined { return states.get(queue); }
28: export function initPlaybackState(queue: Queue, now = Date.now()): PlaybackState {
29:   const existing = states.get(queue);
30:   if (existing) return existing;
31:   const state: PlaybackState = { session: randomBytes(8).toString('hex'), mode: 'preparing', attempt: 0, failures: [], blocked: false,
32:     closing: false, probe: false, busy: 0, revision: 0, lastError: undefined, errorSong: undefined, lastProgress: undefined, resource: undefined, song: undefined,
33:     frames: 0, observedAt: now, waiting: 0, continuous: 0, stalled: false };
34:   states.set(queue, state); return state;
35: }
36: export const playbackLabels: Record<PlaybackMode, string> = {
37:   preparing: '⏳ Preparando audio', playing: '▶ Reproduciendo', paused: '⏸ En pausa', recovering: '🔄 Recuperando audio',
38:   alternative: '🔎 Buscando alternativa', blocked: '🛑 Pausado por fallos', ended: '✓ Cola terminada', disconnected: '🔌 Desconectado',
39: };
40: export function playbackLabel(queue: Queue): string {
41:   const state = getPlaybackState(queue);
42:   return state?.blocked ? playbackLabels.blocked : queue.paused ? playbackLabels.paused : playbackLabels[state?.mode ?? 'playing'];
43: }
44: export function markQueueEdited(queue: Queue): void {
45:   const state = getPlaybackState(queue);
46:   if (state) state.revision++;
47: }
48: export function resetObservation(queue: Queue, now = Date.now()): void {
49:   const state = getPlaybackState(queue);
50:   if (!state) return;
51:   state.resource = undefined; state.waiting = 0; state.continuous = 0; state.stalled = false; state.observedAt = now;
52: }
````

## File: src/music/queueActions.ts
````typescript
 1: import { DisTube, Queue } from 'distube';
 2: import { getPlayerPanels } from './playerPanel';
 3: import { checkpointQueue } from './queueChanges';
 4: import { markQueueEdited } from './playbackState';
 5: 
 6: export type QueueAction = { type: 'shuffle' | 'clear' } | { type: 'remove'; position: number } | { type: 'move'; from: number; to: number };
 7: const actionError = (errorCode: string, message: string) => Object.assign(new Error(message), { errorCode });
 8: export async function editQueue(distube: DisTube, queue: Queue, action: QueueAction, authorized: () => boolean = () => true): Promise<string> {
 9:   await queue._taskQueue.queuing();
10:   let result: string;
11:   try {
12:     if (queue.stopped || distube.getQueue(queue.id) !== queue) throw actionError('SESSION_CHANGED', 'La sesión terminó mientras esperaba.');
13:     if (!authorized()) throw actionError('CONTROL_CHANNEL_REQUIRED', 'Debes seguir en el canal de voz del bot.');
14:     const valid = (position: number) => Number.isInteger(position) && position >= 1 && position < queue.songs.length;
15:     switch (action.type) {
16:       case 'clear': {
17:         const count = queue.songs.splice(1).length;
18:         result = `🧹 Retiradas ${count} canciones pendientes. La canción actual continúa${queue.autoplay ? '; la radio sigue activada' : ''}.`;
19:         break;
20:       }
21:       case 'remove': {
22:         if (!valid(action.position)) throw actionError('INVALID_QUEUE_POSITION', 'Posición no válida; la primera canción pendiente es la 1.');
23:         const [song] = queue.songs.splice(action.position, 1);
24:         result = `🗑️ Retirada de la cola: ${(song?.name ?? 'Canción sin título').slice(0, 160)}`;
25:         break;
26:       }
27:       case 'move': {
28:         if (!valid(action.from) || !valid(action.to)) throw actionError('INVALID_QUEUE_POSITION', 'Posiciones no válidas; solo puedes mover canciones pendientes.');
29:         const [song] = queue.songs.splice(action.from, 1);
30:         queue.songs.splice(action.to, 0, song!);
31:         result = `↕️ Movida de la posición ${action.from} a la ${action.to}: ${(song?.name ?? 'Canción sin título').slice(0, 160)}`;
32:         break;
33:       }
34:       case 'shuffle':
35:         for (let i = queue.songs.length - 1; i > 1; i--) {
36:           const j = 1 + Math.floor(Math.random() * i);
37:           [queue.songs[i], queue.songs[j]] = [queue.songs[j]!, queue.songs[i]!];
38:         }
39:         result = '🔀 Canciones pendientes mezcladas.';
40:         break;
41:     }
42:     markQueueEdited(queue); checkpointQueue(distube, queue);
43:   } finally { queue._taskQueue.resolve(); }
44:   await getPlayerPanels(distube)?.refresh(queue);
45:   return result;
46: }
````

## File: src/music/queueChanges.ts
````typescript
1: import { DisTube, Queue } from 'distube';
2: const checkpoints = new WeakMap<DisTube, (queue: Queue) => void>();
3: export function registerCheckpoint(distube: DisTube, capture: (queue: Queue) => void): () => void {
4:   checkpoints.set(distube, capture);
5:   return () => { if (checkpoints.get(distube) === capture) checkpoints.delete(distube); };
6: }
7: export function checkpointQueue(distube: DisTube, queue: Queue): void { checkpoints.get(distube)?.(queue); }
````

## File: src/music/ytDlpRunner.ts
````typescript
 1: import { json } from '@distube/yt-dlp';
 2: import { setTimeout as delay } from 'node:timers/promises';
 3: import { classifyMusicError } from './errors';
 4: 
 5: export type YtDlpFlags = NonNullable<Parameters<typeof json>[1]> & { jsRuntimes?: string };
 6: const TRANSIENT = new Set(['NETWORK_TIMEOUT', 'NETWORK_ERROR', 'SOURCE_UNAVAILABLE']);
 7: export function isTransientMusicError(error: unknown): boolean {
 8:   return TRANSIENT.has(classifyMusicError(error));
 9: }
10: 
11: export class ExtractionPool {
12:   private active = 0;
13:   private readonly waiting: (() => void)[] = [];
14:   constructor(private readonly limit = 3, private readonly maxWaiting = 50) {}
15: 
16:   async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
17:     signal.throwIfAborted();
18:     if (this.active >= this.limit) {
19:       if (this.waiting.length >= this.maxWaiting) throw Object.assign(new Error('Demasiadas consultas pendientes'), { code: 'MUSIC_BUSY' });
20:       await new Promise<void>((resolve, reject) => {
21:         const abort = () => {
22:           const index = this.waiting.indexOf(start);
23:           if (index !== -1) this.waiting.splice(index, 1);
24:           reject(signal.reason);
25:         };
26:         const start = () => {
27:           signal.removeEventListener('abort', abort);
28:           resolve();
29:         };
30:         this.waiting.push(start);
31:         signal.addEventListener('abort', abort, { once: true });
32:       });
33:     } else {
34:       this.active += 1;
35:     }
36:     try {
37:       signal.throwIfAborted();
38:       return await task();
39:     } finally {
40:       const next = this.waiting.shift();
41:       if (next) next(); // Transfer the occupied slot to the next caller.
42:       else this.active -= 1;
43:     }
44:   }
45: }
46: 
47: const pool = new ExtractionPool();
48: 
49: export async function retryTransient<T>(
50:   operation: () => Promise<T>,
51:   signal: AbortSignal,
52:   retries = 2,
53:   wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, abort) => delay(ms, undefined, { signal: abort }),
54: ): Promise<T> {
55:   for (let attempt = 0; ; attempt += 1) {
56:     signal.throwIfAborted();
57:     try {
58:       return await operation();
59:     } catch (error) {
60:       if (signal.aborted || attempt >= retries || !isTransientMusicError(error)) throw error;
61:       await wait(500 * 2 ** attempt, signal);
62:     }
63:   }
64: }
65: 
66: export async function runYtDlp(input: string, flags: YtDlpFlags = {}, signal?: AbortSignal): Promise<unknown> {
67:   const deadline = AbortSignal.timeout(60_000);
68:   const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
69:   try {
70:     return await retryTransient(async () => {
71:       const attempt = AbortSignal.any([budget, AbortSignal.timeout(20_000)]);
72:       try {
73:         return await pool.run(() => json(input, {
74:           dumpSingleJson: true, noWarnings: true, skipDownload: true, simulate: true,
75:           jsRuntimes: `node:${process.execPath}`,
76:           socketTimeout: 8, retries: 0, extractorRetries: 0,
77:           ...flags,
78:         }, { signal: attempt, windowsHide: true }), attempt);
79:       } catch (error) {
80:         if (attempt.aborted) throw Object.assign(new Error('yt-dlp: tiempo de espera agotado', { cause: error }), { code: 'ETIMEDOUT' });
81:         throw error;
82:       }
83:     }, budget);
84:   } catch (error) {
85:     if (budget.aborted) throw Object.assign(new Error('yt-dlp: tiempo total de espera agotado', { cause: error }), { code: 'ETIMEDOUT' });
86:     throw error;
87:   }
88: }
````

## File: src/runtime/instanceLock.ts
````typescript
 1: import { createHash } from 'node:crypto';
 2: import { createServer } from 'node:net';
 3: 
 4: export class InstanceLockError extends Error {
 5:   constructor(readonly code: 'INSTANCE_ALREADY_RUNNING' | 'INSTANCE_LOCK_FAILED') {
 6:     super(code === 'INSTANCE_ALREADY_RUNNING'
 7:       ? 'Ya hay una instancia de este bot en el equipo. No se inició otra conexión a Discord.'
 8:       : 'No se pudo reservar la instancia del bot; se canceló el inicio para evitar duplicados.');
 9:     this.name = 'InstanceLockError';
10:   }
11: }
12: 
13: /** The OS releases the reservation even if the process crashes or is killed. */
14: export async function acquireInstanceLock(applicationId: string): Promise<() => Promise<void>> {
15:   if (!applicationId) throw new InstanceLockError('INSTANCE_LOCK_FAILED');
16:   const key = createHash('sha256').update(applicationId).digest('hex');
17:   const address = process.platform === 'win32'
18:     ? { path: `\\\\.\\pipe\\discord-music-bot-${key}` }
19:     : { host: '127.0.0.1', port: 30_000 + parseInt(key.slice(0, 8), 16) % 30_000 };
20:   // This is only an OS reservation, never a control or diagnostic endpoint.
21:   const server = createServer(socket => socket.destroy());
22:   await new Promise<void>((resolve, reject) => {
23:     const failed = (error: NodeJS.ErrnoException) => reject(new InstanceLockError(
24:       error.code === 'EADDRINUSE' ? 'INSTANCE_ALREADY_RUNNING' : 'INSTANCE_LOCK_FAILED'));
25:     server.once('error', failed);
26:     server.listen({ ...address, exclusive: true }, () => {
27:       server.off('error', failed);
28:       server.on('error', error => console.error('[Instancia] Error de reserva:', error.message));
29:       resolve();
30:     });
31:   });
32:   let closing: Promise<void> | undefined;
33:   return () => closing ??= new Promise<void>(resolve => server.close(() => resolve()));
34: }
````

## File: src/runtime/safety.ts
````typescript
 1: /** EventEmitter does not await async listeners. Catch both throws and rejections here. */
 2: export function guardedEvent<Args extends unknown[]>(
 3:   context: string,
 4:   handler: (...args: Args) => unknown,
 5: ): (...args: Args) => void {
 6:   return (...args) => {
 7:     try {
 8:       void Promise.resolve(handler(...args)).catch((error: unknown) => {
 9:         console.error(`[${context}]`, error);
10:       });
11:     } catch (error) {
12:       console.error(`[${context}]`, error);
13:     }
14:   };
15: }
16: 
17: export function installProcessHandlers(shutdown: (code: number) => void): () => void {
18:   let failed = false;
19:   const fatal = (error: unknown) => {
20:     console.error('[Fatal] Reiniciando el proceso para recuperar un estado limpio:', error);
21:     if (failed) return;
22:     failed = true;
23:     shutdown(1);
24:   };
25:   process.on('uncaughtException', fatal);
26:   process.on('unhandledRejection', fatal);
27:   return () => {
28:     process.off('uncaughtException', fatal);
29:     process.off('unhandledRejection', fatal);
30:   };
31: }
````

## File: src/utils/colors.ts
````typescript
1: export const BotColors = {
2:   Error: '#FF0000',
3:   Success: '#00FF00',
4:   Warning: '#FFA500',
5:   Info: '#5865F2',
6:   Gold: '#FFD700',
7: } as const;
````

## File: src/utils/suggestions.ts
````typescript
 1: /**
 2:  * Fetches search suggestions for YouTube queries using the lightweight suggest API.
 3:  * Uses a 2-second timeout to respect Discord's 3-second autocomplete response deadline.
 4:  */
 5: export async function fetchSearchSuggestions(query: string): Promise<string[]> {
 6:   const trimmed = query.trim();
 7:   if (!trimmed || trimmed.length < 2 || /^https?:\/\//i.test(trimmed)) {
 8:     return [];
 9:   }
10: 
11:   try {
12:     const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(trimmed)}`;
13:     const response = await fetch(url, {
14:       signal: AbortSignal.timeout(2000),
15:       headers: {
16:         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
17:       },
18:     });
19: 
20:     if (!response.ok) return [];
21: 
22:     const data: unknown = await response.json();
23:     if (Array.isArray(data) && Array.isArray(data[1])) {
24:       return (data[1] as unknown[])
25:         .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
26:         .slice(0, 25);
27:     }
28: 
29:     return [];
30:   } catch {
31:     return [];
32:   }
33: }
````

## File: src/types.ts
````typescript
1: import { DisTube } from 'distube';
2: 
3: declare module 'discord.js' {
4:   interface Client {
5:     distube: DisTube;
6:   }
7: }
````

## File: test/autoplay.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const { MessageFlags } = require('discord.js');
 4: const { autoplay } = require('../dist/commands/autoplay');
 5: 
 6: function makeInteraction(queue, userChannelId = 'voice-1') {
 7:   const replies = [];
 8:   const interaction = {
 9:     guild: {
10:       id: 'guild-1',
11:       members: { cache: new Map([['user-1', { voice: { channel: userChannelId ? { id: userChannelId } : null } }]]) },
12:     },
13:     user: { id: 'user-1' },
14:     client: { distube: { getQueue: () => queue } },
15:     reply: async (payload) => { replies.push(payload); },
16:   };
17:   return { interaction, replies };
18: }
19: 
20: test('/autoplay rejects an empty queue', async () => {
21:   const { interaction, replies } = makeInteraction(null);
22: 
23:   await autoplay.execute(interaction);
24: 
25:   assert.equal(replies.length, 1);
26:   assert.equal(replies[0].flags, MessageFlags.Ephemeral);
27:   assert.match(replies[0].embeds[0].data.description, /No hay música/);
28: });
29: 
30: test('/autoplay only accepts someone in the bot voice channel', async () => {
31:   let toggles = 0;
32:   const queue = {
33:     songs: [{}],
34:     voiceChannel: { id: 'voice-1' },
35:     toggleAutoplay: () => { toggles += 1; return true; },
36:   };
37:   const { interaction, replies } = makeInteraction(queue, 'voice-2');
38: 
39:   await autoplay.execute(interaction);
40: 
41:   assert.equal(toggles, 0);
42:   assert.equal(replies[0].flags, MessageFlags.Ephemeral);
43:   assert.match(replies[0].embeds[0].data.description, /mismo canal/);
44: });
45: 
46: test('/autoplay toggles the queue on and off', async () => {
47:   const queue = {
48:     songs: [{}],
49:     voiceChannel: { id: 'voice-1' },
50:     autoplay: false,
51:     toggleAutoplay() { this.autoplay = !this.autoplay; return this.autoplay; },
52:   };
53:   const { interaction, replies } = makeInteraction(queue);
54: 
55:   await autoplay.execute(interaction);
56:   assert.equal(queue.autoplay, true);
57:   assert.match(replies[0].embeds[0].data.description, /activada/);
58: 
59:   await autoplay.execute(interaction);
60:   assert.equal(queue.autoplay, false);
61:   assert.match(replies[1].embeds[0].data.description, /desactivada/);
62: });
````

## File: test/deploy.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const { execFile } = require('node:child_process');
 4: const { promisify } = require('node:util');
 5: const fs = require('node:fs');
 6: const os = require('node:os');
 7: const path = require('node:path');
 8: 
 9: const run = promisify(execFile);
10: const entry = require.resolve('../dist/deploy-commands');
11: function fixture(t, replacement) {
12:   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-deploy-test-'));
13:   t.after(() => {
14:     assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
15:     fs.rmSync(directory, { recursive: true, force: true });
16:   });
17:   const preload = path.join(directory, 'rest.cjs');
18:   fs.writeFileSync(preload, `
19:     const logger = require(${JSON.stringify(require.resolve('../scripts/logger.cjs'))});
20:     const install = logger.installConsole;
21:     logger.installConsole = options => install({ ...options, directory: ${JSON.stringify(path.join(directory, 'logs'))} });
22:     require(${JSON.stringify(require.resolve('discord.js'))}).REST.prototype.put = ${replacement};
23:   `);
24:   return { preload, options: { cwd: directory, windowsHide: true, timeout: 10000,
25:     env: { ...process.env, DISCORD_TOKEN: 'fixture-token', CLIENT_ID: '1503904508109918299', GUILD_ID: '1082065100111872170' } } };
26: }
27: 
28: test('command deployment can be checked without credentials, network or a bot session', async t => {
29:   const f = fixture(t, 'async () => { throw new Error("Network must not be used"); }');
30:   f.options.env.DISCORD_TOKEN = ''; f.options.env.CLIENT_ID = ''; f.options.env.GUILD_ID = '';
31:   const result = await run(process.execPath, ['--require', f.preload, entry, '--dry-run'], f.options);
32:   assert.match(result.stdout, /19 comandos/); assert.match(result.stdout, /SHA-256.*[a-f0-9]{64}/);
33:   assert.match(result.stdout, /No se contactó con Discord/); assert.equal(result.stderr, '');
34: });
35: 
36: test('failed registration exits unsuccessfully and hides credentials in the diagnostic', async t => {
37:   const f = fixture(t, 'async () => { throw new Error("HTTP 403 https://discord.com/api/webhooks/id/webhook-secret Authorization: Bot fixture-token"); }');
38:   await assert.rejects(run(process.execPath, ['--require', f.preload, entry], f.options), error => {
39:     assert.equal(error.code, 1); assert.match(error.stderr, /Error registrando comandos/);
40:     assert.doesNotMatch(error.stderr, /webhook-secret|fixture-token/);
41:     assert.doesNotMatch(error.stdout, /registrados correctamente/); return true;
42:   });
43: });
44: 
45: test('registration success requires Discord to acknowledge the expected command set', async t => {
46:   const f = fixture(t, 'async (_route, options) => options.body.map(command => ({ name: command.name }))');
47:   const result = await run(process.execPath, ['--require', f.preload, entry], f.options);
48:   assert.match(result.stdout, /Comandos registrados correctamente/); assert.equal(result.stderr, '');
49: });
50: 
51: test('an incomplete registration response fails instead of authorizing activation', async t => {
52:   const f = fixture(t, 'async () => []');
53:   await assert.rejects(run(process.execPath, ['--require', f.preload, entry], f.options), error => {
54:     assert.equal(error.code, 1); assert.match(error.stderr, /registro distinto del esperado/); return true;
55:   });
56: });
````

## File: test/distube-config.test.js
````javascript
 1: const assert=require('node:assert/strict');
 2: const test=require('node:test');
 3: const fs=require('node:fs');
 4: const os=require('node:os');
 5: const path=require('node:path');
 6: const {createServer}=require('node:http');
 7: const {spawn}=require('node:child_process');
 8: const {once}=require('node:events');
 9: const {Client,GatewayIntentBits}=require('discord.js');
10: const ffmpeg=require('ffmpeg-static');
11: const {createDisTube}=require('../dist/music/distube');
12: const {registerDisTubeEvents}=require('../dist/music/events');
13: const {registerEmptyVoice}=require('../dist/music/emptyVoice');
14: const {QueueRecovery}=require('../dist/music/queueRecovery');
15: const {classifyMusicError}=require('../dist/music/errors');
16: 
17: test('production observers fit a finite listener budget without accumulating at startup',async t=>{
18:   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'music-listeners-test-'));
19:   t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
20:   const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
21:   t.after(()=>client.destroy());
22:   const distube=createDisTube(client);
23:   const stopEvents=registerDisTubeEvents(distube);t.after(stopEvents);
24:   const stopEmpty=registerEmptyVoice(client,distube);t.after(stopEmpty);
25:   const recovery=new QueueRecovery(client,distube,path.join(directory,'queues.json'));t.after(()=>recovery.stop());
26:   assert.equal(distube.getMaxListeners(),10);
27:   assert.equal(distube.listenerCount('initQueue'),2);
28:   assert.equal(distube.listenerCount('playSong'),2);
29:   assert.equal(distube.listenerCount('addSong'),2);
30:   assert.equal(distube.listenerCount('addList'),2);
31:   assert.equal(distube.listenerCount('deleteQueue'),3);
32:   for(const event of distube.eventNames())assert.ok(distube.listenerCount(event)<=distube.getMaxListeners());
33: });
34: 
35: test('the installed FFmpeg returns the decoded HTTP 403 exit tag for a real rejected request',async t=>{
36:   const server=createServer((_request,response)=>{response.writeHead(403);response.end('Forbidden');});
37:   server.listen(0,'127.0.0.1');await once(server,'listening');
38:   t.after(()=>{server.closeAllConnections();server.close();});
39:   const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i',`http://127.0.0.1:${server.address().port}/audio`,'-f','null','-'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
40:   t.after(()=>{if(child.exitCode===null)child.kill();});
41:   const timer=setTimeout(()=>child.kill(),5000);t.after(()=>clearTimeout(timer));
42:   let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
43:   const [code]=await once(child,'close');
44:   assert.match(stderr,/403 Forbidden/);
45:   if(process.platform==='win32')assert.equal(classifyMusicError({errorCode:'FFMPEG_EXITED',message:`ffmpeg exited with code ${code}`}), 'SOURCE_BLOCKED');
46:   else assert.notEqual(code,0);
47: });
````

## File: test/historyPersistence.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const test = require('node:test');
  3: const fs = require('node:fs');
  4: const disk = require('node:fs/promises');
  5: const os = require('node:os');
  6: const path = require('node:path');
  7: const { spawnSync } = require('node:child_process');
  8: const { Song } = require('distube');
  9: const { HistoryStore } = require('../dist/music/history');
 10: 
 11: const guildId = '1082065100111872170';
 12: function fixture(t, blocked = true) {
 13:   t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
 14:   const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
 15:   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-history-'));
 16:   const parent = path.join(directory, 'data'), file = path.join(parent, 'history.json');
 17:   if (blocked) fs.writeFileSync(parent, 'temporarily unavailable');
 18:   const store = new HistoryStore(file), queue = { id: guildId };
 19:   t.after(async () => {
 20:     await store.close();
 21:     assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
 22:     fs.rmSync(directory, { recursive: true, force: true });
 23:   });
 24:   const add = id => store.finish(queue, new Song({ plugin: null, source: 'youtube', playFromSource: true,
 25:     id, name: `Song ${id}`, duration: 200, url: `https://www.youtube.com/watch?v=${id}` }), 'completed');
 26:   function repair() { fs.unlinkSync(parent); fs.mkdirSync(parent); }
 27:   return { store, errors, file, add, repair, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
 28: }
 29: 
 30: test('history retries after disk recovery without requiring another completed song', async t => {
 31:   const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
 32:   assert.equal(f.errors.length, 1); f.repair();
 33:   t.mock.timers.tick(59_999); await f.store.flush(); assert.equal(fs.existsSync(f.file), false);
 34:   t.mock.timers.tick(1); await f.store.flush();
 35:   assert.equal(f.read()[0].title, 'Song AAAAAAAAAAA'); assert.equal(f.errors.length, 1);
 36: });
 37: 
 38: test('persistent disk failure retries once per minute while retaining recent history', async t => {
 39:   const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
 40:   for (let i = 0; i < 20; i++) f.add(String(i).padStart(11, 'B'));
 41:   await f.store.flush(); assert.equal(f.errors.length, 1);
 42:   t.mock.timers.tick(60_000); await f.store.flush(); assert.equal(f.errors.length, 2);
 43:   t.mock.timers.tick(59_999); await f.store.flush(); assert.equal(f.errors.length, 2);
 44:   f.repair(); t.mock.timers.tick(1); await f.store.flush();
 45:   assert.equal(f.read().length, 21); assert.equal(f.errors.length, 2);
 46: });
 47: 
 48: test('closing attempts to save recovered disk immediately and does not restart retries', async t => {
 49:   const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
 50:   f.repair(); f.add('BBBBBBBBBBB');
 51:   const rename = disk.rename; let writes = 0;
 52:   t.mock.method(disk, 'rename', async (...args) => { writes++; return rename(...args); });
 53:   await Promise.all([f.store.close(), f.store.close()]);
 54:   assert.equal(f.read().length, 2); assert.equal(writes, 1);
 55:   t.mock.timers.tick(10 * 60_000); await f.store.flush(); await f.store.close();
 56:   assert.equal(writes, 1);
 57: });
 58: 
 59: test('closing on a failed disk contains the last failure and cancels the retry timer', async t => {
 60:   const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush();
 61:   await assert.doesNotReject(() => f.store.close());
 62:   assert.equal(f.errors.length, 2); assert.equal(f.store.list(guildId).length, 1);
 63:   t.mock.timers.tick(10 * 60_000); await f.store.flush(); await f.store.close();
 64:   assert.equal(f.errors.length, 2);
 65: });
 66: 
 67: test('closing waits for in-flight atomic writes and includes changes received during the write', async t => {
 68:   const f = fixture(t, false), rename = disk.rename;
 69:   let entered, release;
 70:   const gate = new Promise(resolve => { release = resolve; });
 71:   const ready = new Promise(resolve => { entered = resolve; });
 72:   let active = 0, peak = 0;
 73:   t.mock.method(disk, 'rename', async (...args) => {
 74:     active++; peak = Math.max(peak, active); entered();
 75:     try { await gate; return await rename(...args); } finally { active--; }
 76:   });
 77:   f.add('AAAAAAAAAAA'); await ready; f.add('BBBBBBBBBBB');
 78:   let closing;
 79:   try { closing = f.store.close(); } finally { release(); }
 80:   await closing; await f.store.flush();
 81:   assert.equal(peak, 1); assert.equal(f.read().length, 2);
 82:   assert.deepEqual(f.read().map(entry => entry.title), ['Song BBBBBBBBBBB', 'Song AAAAAAAAAAA']);
 83: });
 84: 
 85: test('a failed atomic replacement preserves the previous history and retries the latest entries', async t => {
 86:   const f = fixture(t, false); f.add('AAAAAAAAAAA'); await f.store.flush();
 87:   const original = fs.readFileSync(f.file, 'utf8'), rename = disk.rename; let failing = true;
 88:   t.mock.method(disk, 'rename', async (...args) => {
 89:     if (failing) throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' });
 90:     return rename(...args);
 91:   });
 92:   f.add('BBBBBBBBBBB'); await f.store.flush();
 93:   assert.equal(fs.readFileSync(f.file, 'utf8'), original); assert.equal(f.errors.length, 1);
 94:   failing = false; t.mock.timers.tick(60_000); await f.store.flush();
 95:   assert.deepEqual(f.read().map(entry => entry.title), ['Song BBBBBBBBBBB', 'Song AAAAAAAAAAA']);
 96: });
 97: 
 98: test('retries prune expired history before writing after a prolonged disk outage', async t => {
 99:   const f = fixture(t); f.add('AAAAAAAAAAA'); await f.store.flush(); f.repair();
100:   t.mock.timers.tick(8 * 24 * 60 * 60_000); await f.store.flush();
101:   assert.deepEqual(f.read(), []);
102: });
103: 
104: test('closing still makes its final attempt when an in-flight replacement fails', async t => {
105:   const f = fixture(t, false), rename = disk.rename;
106:   let entered, release, writes = 0;
107:   const gate = new Promise(resolve => { release = resolve; });
108:   const ready = new Promise(resolve => { entered = resolve; });
109:   t.mock.method(disk, 'rename', async (...args) => {
110:     writes++;
111:     if (writes === 1) {
112:       entered(); await gate;
113:       throw Object.assign(new Error('temporary replacement failure'), { code: 'EBUSY' });
114:     }
115:     return rename(...args);
116:   });
117:   f.add('AAAAAAAAAAA'); await ready;
118:   let closing;
119:   try { closing = f.store.close(); } finally { release(); }
120:   await closing;
121:   assert.equal(writes, 2); assert.equal(f.read().length, 1); assert.equal(f.errors.length, 1);
122:   t.mock.timers.tick(10 * 60_000); await f.store.flush(); assert.equal(writes, 2);
123: });
124: 
125: test('a scheduled history retry does not keep a finished process alive', t => {
126:   const f = fixture(t);
127:   const source = `
128:     const { HistoryStore } = require('./dist/music/history');
129:     console.error = () => {};
130:     const store = new HistoryStore(process.argv[1]);
131:     store.finish({ id: '${guildId}' }, {
132:       name: 'Song', source: 'youtube', stream: { playFromSource: true },
133:       url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA'
134:     }, 'completed');
135:     store.flush().then(() => console.log(store.list('${guildId}').length));
136:   `;
137:   const result = spawnSync(process.execPath, ['-e', source, f.file], {
138:     cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10_000,
139:   });
140:   assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
141:   assert.equal(result.stdout.trim(), '1');
142: });
````

## File: test/instanceLock.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const { randomUUID } = require('node:crypto');
 4: const { fork, execFile } = require('node:child_process');
 5: const { promisify } = require('node:util');
 6: const fs = require('node:fs');
 7: const os = require('node:os');
 8: const path = require('node:path');
 9: const { acquireInstanceLock } = require('../dist/runtime/instanceLock');
10: 
11: function runner(t, failLogin = false) {
12:   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-instance-test-'));
13:   const file = path.join(directory, 'boot.cjs');
14:   const bootstrap = require.resolve('../dist/bootstrap'), index = require.resolve('../dist/index');
15:   const logger = require.resolve('../dist/runtime/logger');
16:   fs.writeFileSync(file, `
17:     require.cache[${JSON.stringify(logger)}] = { id:${JSON.stringify(logger)}, filename:${JSON.stringify(logger)}, loaded:true,
18:       exports:{ installLogs:()=>({close:async()=>{}}) } };
19:     require.cache[${JSON.stringify(index)}] = { id:${JSON.stringify(index)}, filename:${JSON.stringify(index)}, loaded:true,
20:       exports: {
21:         get client() { console.log('INDEX_IMPORTED'); return {destroy:async()=>{}}; },
22:         queueRecovery:{stop(){}}, stopEmptyVoice(){}, stopPlayerPanels(){}, history:{close:async()=>{}},
23:         startBot:async()=>{
24:           if (${JSON.stringify(failLogin)}) throw new Error('invalid token fixture');
25:           console.log('STARTED'); process.send?.({type:'ready'});
26:         }
27:       }
28:     };
29:     require(${JSON.stringify(bootstrap)});
30:   `);
31:   t.after(() => {
32:     assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
33:     fs.rmSync(directory, { recursive: true, force: true });
34:   });
35:   return { file, options: { cwd: directory, windowsHide: true, timeout: 10000 } };
36: }
37: const environment = id => ({ ...process.env, CLIENT_ID: id, GUILD_ID: '1082065100111872170', DISCORD_TOKEN: 'fixture-not-real-token' });
38: async function startFixture(t, f, id) {
39:   const child = fork(f.file, [], { ...f.options, timeout: undefined, env: environment(id), stdio: ['ignore','pipe','pipe','ipc'] });
40:   const closed = new Promise(resolve => child.once('close', code => resolve(code)));
41:   t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
42:   await new Promise((resolve, reject) => {
43:     const timeout = setTimeout(() => reject(new Error('Fixture startup timeout')), 10000);
44:     child.once('message', message => { clearTimeout(timeout); message.type === 'ready' ? resolve() : reject(new Error('Unexpected fixture message')); });
45:     child.once('error', error => { clearTimeout(timeout); reject(error); });
46:     child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exited before ready: ${code}`)); });
47:   });
48:   return { child, closed };
49: }
50: 
51: test('concurrent startup reservations allow exactly one owner for the same application', async t => {
52:   const id = randomUUID(), attempts = await Promise.allSettled(Array.from({length:12}, () => acquireInstanceLock(id)));
53:   const owners = attempts.filter(result => result.status === 'fulfilled');
54:   t.after(async () => { for (const owner of owners) await owner.value(); });
55:   assert.equal(owners.length, 1);
56:   for (const blocked of attempts.filter(result => result.status === 'rejected')) assert.equal(blocked.reason.code, 'INSTANCE_ALREADY_RUNNING');
57: });
58: 
59: test('different Discord applications can reserve independent instances', async t => {
60:   const releases = await Promise.all([acquireInstanceLock(randomUUID()), acquireInstanceLock(randomUUID())]);
61:   t.after(async () => { await Promise.all(releases.map(release => release())); });
62:   assert.equal(releases.length, 2);
63: });
64: 
65: test('releasing an instance is idempotent and cannot unlock its successor', async t => {
66:   const id = randomUUID(), release = await acquireInstanceLock(id);
67:   await Promise.all([release(), release()]);
68:   const next = await acquireInstanceLock(id); t.after(next);
69:   await release(); await assert.rejects(acquireInstanceLock(id), { code:'INSTANCE_ALREADY_RUNNING' });
70: });
71: 
72: test('the OS releases a reservation after a process is forcibly terminated', async t => {
73:   const f = runner(t), id = randomUUID(), owner = await startFixture(t, f, id);
74:   await assert.rejects(acquireInstanceLock(id), {code:'INSTANCE_ALREADY_RUNNING'});
75:   owner.child.kill('SIGKILL'); await owner.closed;
76:   const release = await acquireInstanceLock(id); await release();
77: });
78: 
79: test('bootstrap refuses a duplicate before importing the bot or attempting login', async t => {
80:   const f = runner(t), id = randomUUID(), release = await acquireInstanceLock(id); t.after(release);
81:   await assert.rejects(promisify(execFile)(process.execPath, [f.file], { ...f.options, env:environment(id) }), error => {
82:     assert.equal(error.code, 79); assert.match(error.stderr, /Ya hay una instancia/);
83:     assert.doesNotMatch(error.stdout, /INDEX_IMPORTED|STARTED/); return true;
84:   });
85: });
86: 
87: test('bootstrap releases the reservation after a normal IPC shutdown', async t => {
88:   const f = runner(t), id = randomUUID(), owner = await startFixture(t, f, id);
89:   owner.child.send({type:'shutdown'}); assert.equal(await owner.closed, 0);
90:   const release = await acquireInstanceLock(id); await release();
91: });
92: 
93: test('a failed bot startup exits with configuration status and releases its reservation', async t => {
94:   const f = runner(t, true), id = randomUUID();
95:   await assert.rejects(promisify(execFile)(process.execPath, [f.file], { ...f.options, env:environment(id) }), error => {
96:     assert.equal(error.code, 78); assert.match(error.stderr, /invalid token fixture/); return true;
97:   });
98:   const release = await acquireInstanceLock(id); await release();
99: });
````

## File: test/playbackRecovery.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const test = require('node:test');
  3: const { EventEmitter } = require('node:events');
  4: const { Song, Playlist } = require('distube');
  5: const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
  6: const { PlaybackRecovery } = require('../dist/music/playbackRecovery');
  7: const { RecoveryNotices, createRecoveryNotice } = require('../dist/music/recoveryNotices');
  8: const { registerDisTubeEvents } = require('../dist/music/events');
  9: 
 10: const tick = () => new Promise(resolve => setImmediate(resolve));
 11: const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
 12: const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
 13: const audioError = { errorCode: 'FFMPEG_EXITED', message: 'ffmpeg exited with code 3436169992' };
 14: function track(plugin, id = 'original', extra = {}, options = {}) {
 15:   return new Song({ plugin, source: 'youtube', playFromSource: true, id, name: 'Artist Song', duration: 200,
 16:     url: `https://www.youtube.com/watch?v=${id}`, ...extra }, options);
 17: }
 18: function quiet(t) {
 19:   t.mock.method(console, 'info', () => {});
 20:   t.mock.method(console, 'error', () => {});
 21: }
 22: function reachAlternative(recovery, queue, original, plugin) {
 23:   for (let attempt = 1; attempt <= 3; attempt++) {
 24:     assert.equal(queue.songs.shift(), original);
 25:     assert.equal(recovery.retry(queue, original, audioError, plugin), attempt);
 26:     assert.equal(queue.songs[0], original, 'The failed head must be retained synchronously');
 27:   }
 28: }
 29: 
 30: test('alternative discovery prefers another source and preserves request metadata and playlist', async () => {
 31:   const plugin = new YtDlpSearchPlugin();
 32:   const original = track(plugin, 'original', { name: 'Artist Song (Official Music Video)' }, { metadata: { searchSource: 'youtube' } });
 33:   new Playlist({ id: 'playlist', source: 'youtube', songs: [original] }, { metadata: original.metadata });
 34:   const calls = [];
 35:   plugin.fetchInfo = async (input, flags, signal) => {
 36:     calls.push(input); assert.equal(signal.aborted, false);
 37:     if (input.startsWith('scsearch')) {
 38:       assert.equal(input, 'scsearch5:Artist Song');
 39:       return { entries: [{ id: 'alternative', title: 'Artist Song', webpage_url: 'https://soundcloud.com/artist/song' }] };
 40:     }
 41:     assert.equal(flags.noPlaylist, true);
 42:     return { id: 'alternative', title: 'Song', uploader: 'Artist', duration: 205,
 43:       webpage_url: input, url: 'https://audio.test/valid' };
 44:   };
 45:   const alternative = await plugin.findAlternative(original);
 46:   assert.equal(alternative.source, 'soundcloud');
 47:   assert.equal(alternative.metadata, original.metadata);
 48:   assert.equal(alternative.playlist, original.playlist);
 49:   assert.equal(alternative.stream.url, 'https://audio.test/valid');
 50:   assert.equal(await plugin.getStreamURL(alternative), 'https://audio.test/valid');
 51:   assert.equal(calls.length, 2, 'Playback uses the freshly extracted URL');
 52: });
 53: 
 54: test('alternative discovery rejects the same video under another URL and finds a different upload', async () => {
 55:   const plugin = new YtDlpSearchPlugin();
 56:   const original = track(plugin);
 57:   const hydrated = [];
 58:   plugin.fetchInfo = async (input, flags) => {
 59:     if (input.startsWith('scsearch')) return { entries: [] };
 60:     if (flags.flatPlaylist) return { entries: [
 61:       { id: 'original', title: 'Artist Song', url: 'https://youtu.be/original' },
 62:       { id: 'different', title: 'Artist Song', url: 'https://youtube.com/different' },
 63:     ] };
 64:     hydrated.push(input);
 65:     return { id: 'different', title: 'Artist Song audio', duration: 200, webpage_url: input, url: 'https://audio.test/new' };
 66:   };
 67:   assert.equal((await plugin.findAlternative(original)).id, 'different');
 68:   assert.deepEqual(hydrated, ['https://youtube.com/different']);
 69: });
 70: 
 71: for (const [label, changes] of [
 72:   ['another song', { title: 'Artist Different' }], ['a cover', { title: 'Artist Song cover' }],
 73:   ['a remix', { title: 'Artist Song remix' }], ['an incompatible duration', { duration: 400 }],
 74:   ['unknown duration', { duration: null }], ['a live stream', { is_live: true }],
 75:   ['restricted content', { age_limit: 18 }], ['missing audio', { url: undefined }],
 76: ]) {
 77:   test(`alternative discovery rejects ${label}`, async () => {
 78:     const plugin = new YtDlpSearchPlugin();
 79:     plugin.fetchInfo = async (input, flags) => flags.flatPlaylist
 80:       ? { entries: [{ id: 'candidate', title: 'Artist Song', webpage_url: `https://candidate.test/${input.slice(0, 2)}` }] }
 81:       : { id: 'candidate', title: 'Artist Song', duration: 200, webpage_url: input, url: 'https://audio.test/new', ...changes };
 82:     assert.equal(await plugin.findAlternative(track(plugin)), null);
 83:   });
 84: }
 85: 
 86: test('metadata recovery checks artist separately even when a long title mostly matches', async () => {
 87:   const plugin = new YtDlpSearchPlugin();
 88:   const original = track(null, 'spotify', { source: 'spotify', playFromSource: false,
 89:     name: 'One Two Three Four Five Six Seven Eight Nine Ten', uploader: { name: 'Rightartist' } });
 90:   original.stream.song = track(plugin);
 91:   plugin.fetchInfo = async (input, flags) => {
 92:     if (flags.flatPlaylist) { assert.match(input, /Rightartist/); return { entries: [{ id: 'candidate', title: original.name, webpage_url: 'https://candidate.test/song' }] }; }
 93:     return { id: 'candidate', title: original.name, uploader: 'Wrongartist', duration: 200,
 94:       webpage_url: input, url: 'https://audio.test/new' };
 95:   };
 96:   assert.equal(await plugin.findAlternative(original), null);
 97: });
 98: 
 99: test('discovery is bounded to six candidates and honours cancellation', async () => {
100:   const plugin = new YtDlpSearchPlugin();
101:   let hydrated = 0;
102:   plugin.fetchInfo = async (input, flags) => {
103:     if (flags.flatPlaylist) return { entries: Array.from({ length: 5 }, (_, id) => ({
104:       id: `${input}:${id}`, title: 'Artist Song', webpage_url: `https://candidate.test/${encodeURIComponent(input)}/${id}`,
105:     })) };
106:     hydrated++;
107:     return { title: 'Artist Song remix', duration: 200, webpage_url: input, url: 'https://audio.test/new' };
108:   };
109:   assert.equal(await plugin.findAlternative(track(plugin)), null);
110:   assert.equal(hydrated, 6);
111:   const abort = new AbortController();
112:   abort.abort();
113:   await assert.rejects(plugin.findAlternative(track(plugin), abort.signal), { name: 'AbortError' });
114:   assert.equal(hydrated, 6);
115: });
116: 
117: test('a blocked alternative provider falls back without repeatedly querying that provider', async () => {
118:   const plugin = new YtDlpSearchPlugin();
119:   let blocked = 0;
120:   plugin.fetchInfo = async (input, flags) => {
121:     if (input.startsWith('scsearch')) { blocked++; throw new Error('HTTP Error 403: Forbidden'); }
122:     if (flags.flatPlaylist) return { entries: [{ id: 'new', title: 'Artist Song', webpage_url: 'https://youtube.com/new' }] };
123:     return { id: 'new', title: 'Artist Song', duration: 200, webpage_url: input, url: 'https://audio.test/new' };
124:   };
125:   assert.equal((await plugin.findAlternative(track(plugin))).source, 'youtube');
126:   assert.equal((await plugin.findAlternative(track(plugin))).source, 'youtube');
127:   assert.equal(blocked, 1);
128: });
129: 
130: test('recovery replaces only the failed head, shares lookup and keeps the retry limit for its replacement', async t => {
131:   quiet(t);
132:   const plugin = new YtDlpSearchPlugin();
133:   const original = track(plugin), next = track(plugin, 'next'), alternative = track(plugin, 'alternative');
134:   const queue = { songs: [original, next], stopped: false, currentTime: 80, _beginTime: 79 };
135:   const recovery = new PlaybackRecovery(); t.after(() => recovery.dispose());
136:   const lookup = deferred(); let calls = 0;
137:   plugin.findAlternative = async () => { calls++; return lookup.promise; };
138:   reachAlternative(recovery, queue, original, plugin);
139:   const first = recovery.prepareAlternative(queue, original, plugin);
140:   const second = recovery.prepareAlternative(queue, original, plugin);
141:   lookup.resolve(alternative);
142:   assert.deepEqual(await Promise.all([first, second]), [true, true]);
143:   assert.equal(calls, 1);
144:   assert.deepEqual(queue.songs, [alternative, next]);
145:   assert.equal(queue._beginTime, 0, 'A different recording starts at the beginning');
146:   queue.songs.shift();
147:   assert.equal(recovery.retry(queue, alternative, audioError, plugin), 0);
148:   assert.deepEqual(queue.songs, [next]);
149: });
150: 
151: for (const throws of [false, true]) {
152:   test(`a ${throws ? 'rejected' : 'fruitless'} lookup skips only the failed head`, async t => {
153:     quiet(t);
154:     const plugin = new YtDlpSearchPlugin(), original = track(plugin), next = track(plugin, 'next');
155:     const queue = { songs: [original, next], stopped: false, _beginTime: 40 };
156:     const statuses = [];
157:     const recovery = new PlaybackRecovery(status => statuses.push(status.stage)); t.after(() => recovery.dispose());
158:     plugin.findAlternative = async () => { if (throws) throw new Error('failed'); return null; };
159:     reachAlternative(recovery, queue, original, plugin);
160:     assert.equal(await recovery.prepareAlternative(queue, original, plugin), false);
161:     assert.deepEqual(queue.songs, [next]);
162:     assert.equal(statuses.at(-1), 'failed');
163:     assert.equal(queue._beginTime, 0);
164:   });
165: }
166: 
167: test('a result arriving after a manual change cannot replace the new head', async t => {
168:   quiet(t);
169:   const plugin = new YtDlpSearchPlugin(), original = track(plugin), next = track(plugin, 'next');
170:   const queue = { songs: [original, next], stopped: false };
171:   const recovery = new PlaybackRecovery(); t.after(() => recovery.dispose());
172:   const lookup = deferred(); plugin.findAlternative = () => lookup.promise;
173:   reachAlternative(recovery, queue, original, plugin);
174:   const pending = recovery.prepareAlternative(queue, original, plugin);
175:   queue.songs.shift();
176:   lookup.resolve(track(plugin, 'alternative'));
177:   assert.equal(await pending, false);
178:   assert.deepEqual(queue.songs, [next]);
179:   assert.equal(recovery.alternativeFailed(queue, original), false);
180: });
181: 
182: test('success requires audio progress, not just a playSong event or a seek position', async t => {
183:   quiet(t);
184:   const plugin = new YtDlpSearchPlugin(), original = track(plugin);
185:   const resource = { playbackDuration: 0 };
186:   const queue = { songs: [], stopped: false, currentTime: 80, voice: { stream: { audioResource: resource } } };
187:   const stages = [];
188:   const recovery = new PlaybackRecovery(status => stages.push(status.stage), 5); t.after(() => recovery.dispose());
189:   recovery.retry(queue, original, audioError, plugin);
190:   recovery.markStarted(queue, original);
191:   await wait(20);
192:   assert.deepEqual(stages, ['renew']);
193:   resource.playbackDuration = 20;
194:   await wait(20);
195:   assert.deepEqual(stages, ['renew', 'recovered']);
196:   recovery.dispose(); await wait(10);
197:   assert.equal(stages.length, 2);
198: });
199: 
200: test('recovery notices send once and edit yellow progress into green success', async () => {
201:   const notices = new RecoveryNotices();
202:   const original = track(null), sends = [], edits = [];
203:   const queue = { songs: [original], textChannel: { send: async payload => {
204:     sends.push(payload); return { edit: async payload => edits.push(payload) };
205:   } } };
206:   const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
207:   await notices.update(status);
208:   await notices.update({ ...status, stage: 'alternative', attempt: 3 });
209:   await notices.update({ ...status, stage: 'recovered', attempt: 3 });
210:   assert.equal(sends.length, 1); assert.equal(edits.length, 2);
211:   assert.equal(sends[0].embeds[0].data.color, 0xF0B232);
212:   assert.equal(edits[1].embeds[0].data.color, 0x3BA55D);
213:   assert.match(edits[1].embeds[0].data.description, /Audio recuperado en YouTube/);
214:   assert.deepEqual(sends[0].allowedMentions.parse, []);
215:   notices.dispose();
216: });
217: 
218: test('a status changed during send edits the same message to its latest result', async () => {
219:   const notices = new RecoveryNotices(), sending = deferred(), edits = [];
220:   const original = track(null); let sends = 0;
221:   const queue = { songs: [], textChannel: { send: async () => { sends++; return sending.promise; } } };
222:   const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
223:   const pending = notices.update(status); await tick();
224:   const latest = notices.update({ ...status, stage: 'failed', attempt: 3 });
225:   sending.resolve({ edit: async payload => edits.push(payload) });
226:   await Promise.all([pending, latest]);
227:   assert.equal(sends, 1); assert.equal(edits.length, 1);
228:   assert.match(edits[0].embeds[0].data.description, /No quedan canciones/);
229:   notices.dispose();
230: });
231: 
232: test('notice permission failures are contained and do not create replacement messages', async t => {
233:   quiet(t);
234:   const notices = new RecoveryNotices(), original = track(null); let sends = 0;
235:   const queue = { songs: [], textChannel: { send: async () => { sends++; throw new Error('Missing Permissions'); } } };
236:   const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
237:   await assert.doesNotReject(notices.update(status));
238:   await assert.doesNotReject(notices.update({ ...status, stage: 'failed' }));
239:   assert.equal(sends, 1); notices.dispose();
240:   const description = createRecoveryNotice({ ...status, original: track(null, 'test', { name: '**test**' }), stage: 'failed' }).data.description;
241:   assert.match(description, /\\\*\\\*test\\\*\\\*/);
242: });
243: 
244: test('a notice arriving just as the previous write completes is not stranded', async () => {
245:   const notices = new RecoveryNotices(), original = track(null), edits = [];
246:   let late;
247:   const queue = { songs: [], textChannel: { send: () => Promise.resolve({ edit: async payload => edits.push(payload) }).then(message => {
248:     queueMicrotask(() => queueMicrotask(() => { late = notices.update({ ...status, stage: 'failed' }); }));
249:     return message;
250:   }) } };
251:   const status = { queue, original, song: original, code: 'SOURCE_BLOCKED', attempt: 1, stage: 'renew' };
252:   await notices.update(status);
253:   await late;
254:   assert.equal(edits.length, 1);
255:   assert.match(edits[0].embeds[0].data.description, /No pude reproducir/);
256:   notices.dispose();
257: });
258: 
259: function eventHarness(t, withNext = true, skipFails = false) {
260:   quiet(t);
261:   const distube = new EventEmitter(), plugin = new YtDlpSearchPlugin();
262:   const original = track(plugin), next = track(plugin, 'next'), played = [];
263:   let lock = Promise.resolve();
264:   distube.plugins = [plugin];
265:   const queue = { id: 'guild', songs: withNext ? [original, next] : [original], stopped: false,
266:     voice: { play: async () => {}, stop: () => {} },
267:     remove: () => { queue.stopped = true; queue.songs = []; distube.emit('deleteQueue', queue); },
268:     skip: async () => { await lock; if (skipFails) throw new Error('NO_UP_NEXT'); queue.songs.shift(); },
269:     stop: async () => { await lock; queue.remove(); },
270:   };
271:   distube.getQueue = () => queue.stopped ? undefined : queue;
272:   const native = async q => { played.push(q.songs[0]); };
273:   distube.queues = { playSong: native };
274:   queue.play = () => distube.queues.playSong(queue);
275:   t.after(registerDisTubeEvents(distube));
276:   distube.emit('initQueue', queue);
277:   for (let attempt = 1; attempt <= 3; attempt++) {
278:     assert.equal(queue.songs.shift(), original);
279:     distube.emit('error', audioError, queue, original);
280:     assert.equal(queue.songs[0], original);
281:   }
282:   return { distube, plugin, original, next, played, queue, lockUntil: pending => { lock = pending; } };
283: }
284: 
285: test('the playback hook waits for lookup then plays the replacement once', async t => {
286:   const { distube, plugin, queue, played, next } = eventHarness(t);
287:   const lookup = deferred(), alternative = track(plugin, 'alternative');
288:   plugin.findAlternative = () => lookup.promise;
289:   const pending = distube.queues.playSong(queue);
290:   const duplicate = distube.queues.playSong(queue);
291:   await tick(); assert.equal(played.length, 0);
292:   lookup.resolve(alternative); await Promise.all([pending, duplicate]);
293:   assert.deepEqual(played, [alternative]); assert.deepEqual(queue.songs, [alternative, next]);
294: });
295: 
296: test('an empty failed recovery removes the queue without waiting for its own task lock', async t => {
297:   const { distube, plugin, queue, played } = eventHarness(t, false);
298:   plugin.findAlternative = async () => null;
299:   queue.stop = () => assert.fail('stop() would deadlock an already held queue lock');
300:   await distube.queues.playSong(queue);
301:   assert.equal(queue.stopped, true); assert.equal(played.length, 0);
302: });
303: 
304: test('a failed recovery plays the next queued song', async t => {
305:   const { distube, plugin, queue, played, next } = eventHarness(t);
306:   plugin.findAlternative = async () => null;
307:   await distube.queues.playSong(queue);
308:   assert.deepEqual(played, [next]); assert.deepEqual(queue.songs, [next]);
309: });
310: 
311: for (const control of ['skip', 'stop']) {
312:   test(`${control} aborts lookup before waiting for the playback lock`, { timeout: 2000 }, async t => {
313:     const { distube, plugin, queue, played, next, lockUntil } = eventHarness(t);
314:     let aborted = false;
315:     plugin.findAlternative = (_song, signal) => new Promise((_resolve, reject) => {
316:       signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
317:     });
318:     const pending = distube.queues.playSong(queue);
319:     lockUntil(pending);
320:     await tick();
321:     await queue[control]();
322:     await pending;
323:     assert.equal(aborted, true); assert.equal(played.length, 0);
324:     assert.deepEqual(queue.songs, control === 'skip' ? [next] : []);
325:   });
326: }
327: 
328: test('a rejected skip after cancelling lookup cannot leave the failed song stuck', { timeout: 2000 }, async t => {
329:   const { distube, plugin, queue, played, lockUntil } = eventHarness(t, false, true);
330:   plugin.findAlternative = (_song, signal) => new Promise((_resolve, reject) => {
331:     signal.addEventListener('abort', () => reject(signal.reason), { once: true });
332:   });
333:   const pending = distube.queues.playSong(queue);
334:   lockUntil(pending);
335:   await tick();
336:   await assert.rejects(queue.skip(), /NO_UP_NEXT/);
337:   await pending;
338:   assert.equal(queue.stopped, true); assert.equal(played.length, 0);
339: });
````

## File: test/recommend-command.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const test = require('node:test');
  3: const { MessageFlags } = require('discord.js');
  4: const { Song } = require('distube');
  5: const { recommend } = require('../dist/commands/recommend');
  6: const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
  7: 
  8: function makeSong(id) {
  9:   return new Song({
 10:     plugin: null,
 11:     source: 'youtube',
 12:     playFromSource: true,
 13:     id,
 14:     name: id,
 15:     url: `https://www.youtube.com/watch?v=${id}`,
 16:   });
 17: }
 18: 
 19: function makeInteraction(queue, plugin, amount = 2, userChannelId = 'voice-1') {
 20:   const replies = [];
 21:   const edits = [];
 22:   let deferred = false;
 23:   const distube = {
 24:     plugins: [plugin],
 25:     getQueue: () => queue,
 26:   };
 27:   const interaction = {
 28:     guild: {
 29:       id: 'guild-1',
 30:       members: { cache: new Map([['user-1', { voice: { channel: userChannelId ? { id: userChannelId } : null } }]]) },
 31:     },
 32:     user: { id: 'user-1' },
 33:     client: { distube },
 34:     options: { getInteger: () => amount },
 35:     reply: async (payload) => { replies.push(payload); },
 36:     deferReply: async () => { deferred = true; },
 37:     editReply: async (payload) => { edits.push(payload); },
 38:   };
 39:   return { interaction, distube, replies, edits, wasDeferred: () => deferred };
 40: }
 41: 
 42: test('/recommend requires a playing queue and the same voice channel', async () => {
 43:   const plugin = new YtDlpSearchPlugin();
 44:   const noQueue = makeInteraction(null, plugin);
 45:   await recommend.execute(noQueue.interaction);
 46:   assert.equal(noQueue.replies[0].flags, MessageFlags.Ephemeral);
 47:   assert.equal(noQueue.wasDeferred(), false);
 48: 
 49:   const queue = { songs: [makeSong('AAAAAAAAAAA')], voiceChannel: { id: 'voice-1' } };
 50:   const wrongChannel = makeInteraction(queue, plugin, 2, 'voice-2');
 51:   await recommend.execute(wrongChannel.interaction);
 52:   assert.equal(wrongChannel.replies[0].flags, MessageFlags.Ephemeral);
 53:   assert.equal(wrongChannel.wasDeferred(), false);
 54: });
 55: 
 56: test('/recommend uses another queue seed when needed and excludes already played songs', async () => {
 57:   const current = makeSong('AAAAAAAAAAA');
 58:   const last = makeSong('BBBBBBBBBBB');
 59:   const queue = {
 60:     songs: [current, last],
 61:     previousSongs: [makeSong('CCCCCCCCCCC')],
 62:     voiceChannel: { id: 'voice-1' },
 63:     stopped: false,
 64:     addToQueue(songs) { this.songs.push(...songs); },
 65:   };
 66:   const plugin = new YtDlpSearchPlugin();
 67:   const seeds = [];
 68:   plugin.getRecommendations = async (seed) => {
 69:     seeds.push(seed.id);
 70:     return seed === current
 71:       ? [makeSong('CCCCCCCCCCC'), makeSong('DDDDDDDDDDD')]
 72:       : [makeSong('DDDDDDDDDDD'), makeSong('EEEEEEEEEEE')];
 73:   };
 74:   const { interaction, edits, wasDeferred } = makeInteraction(queue, plugin);
 75: 
 76:   await recommend.execute(interaction);
 77: 
 78:   assert.equal(wasDeferred(), true);
 79:   assert.deepEqual(seeds, ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
 80:   assert.deepEqual(queue.songs.map((song) => song.id), [
 81:     'AAAAAAAAAAA', 'BBBBBBBBBBB', 'DDDDDDDDDDD', 'EEEEEEEEEEE',
 82:   ]);
 83:   assert.match(edits[0].embeds[0].data.description, /Añadidas \*\*2\*\*/);
 84: });
 85: 
 86: test('/recommend does not append songs if the queue ends during lookup', async () => {
 87:   const queue = {
 88:     songs: [makeSong('AAAAAAAAAAA')],
 89:     previousSongs: [],
 90:     voiceChannel: { id: 'voice-1' },
 91:     stopped: false,
 92:     addToQueue() { assert.fail('A stopped queue must not be modified'); },
 93:   };
 94:   const plugin = new YtDlpSearchPlugin();
 95:   plugin.getRecommendations = async () => {
 96:     queue.stopped = true;
 97:     return [makeSong('BBBBBBBBBBB')];
 98:   };
 99:   const { interaction, edits } = makeInteraction(queue, plugin);
100: 
101:   await recommend.execute(interaction);
102: 
103:   assert.match(edits[0].embeds[0].data.description, /La cola terminó/);
104: });
````

## File: test/voiceLifecycle.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const test = require('node:test');
  3: const { EventEmitter } = require('node:events');
  4: const { Client, GatewayIntentBits } = require('discord.js');
  5: const { DisTube, Song } = require('distube');
  6: const ffmpeg = require('ffmpeg-static');
  7: const { registerDisTubeEvents } = require('../dist/music/events');
  8: const { getPlaybackState } = require('../dist/music/playbackState');
  9: const { getPlaybackHealth } = require('../dist/music/playbackHealth');
 10: const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
 11: 
 12: const guildId = '1082065100111872170';
 13: const tick = () => new Promise(resolve => setImmediate(resolve));
 14: function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
 15: async function fixture(t) {
 16:   const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
 17:   t.mock.method(console, 'log', () => {}); t.mock.method(console, 'info', () => {}); t.mock.method(console, 'warn', () => {});
 18:   const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] }); t.after(() => client.destroy());
 19:   const plugin = new YtDlpSearchPlugin(); plugin.invalidateStream = () => {}; plugin.findAlternative = async () => null;
 20:   const distube = new DisTube(client, { plugins: [plugin], ffmpeg: { path: ffmpeg } }); distube.setMaxListeners(10);
 21:   const streams = [], voice = new EventEmitter(); Object.assign(voice, { id: guildId, emittedError: false, playbackTime: 0, volume: 50,
 22:     channel: { id: '1082065100569059471', guildId, guild: { members: { me: null } } },
 23:     join: async () => voice, pause() {}, unpause() {},
 24:     play: async stream => { streams.push(stream); voice.stream = stream; voice.emittedError = false; }, stop: () => { voice.emit('finish'); } });
 25:   distube.voices.create = () => voice;
 26:   let now = Date.now();
 27:   const dispose = registerDisTubeEvents(distube, undefined, { interval: 0, clock: () => now }); t.after(dispose);
 28:   const queue = await distube.queues.create(voice.channel);
 29:   const song = id => new Song({ plugin, source: 'youtube', id, name: id, duration: 200,
 30:     playFromSource: true, url: `https://www.youtube.com/watch?v=${id}` });
 31:   queue.songs = [song('AAAAAAAAAAA'), song('BBBBBBBBBBB')];
 32:   distube.handler.attachStreamInfo = async current => { current.stream.url = 'https://unused.test/audio'; };
 33:   t.after(() => { for (const stream of streams) stream.kill(); if (!queue.stopped) queue.remove(); });
 34:   const health = getPlaybackHealth(distube);
 35:   function advance(frames) { now += 2000; if (frames !== undefined) voice.stream.audioResource.playbackDuration = frames; health.tick(); }
 36:   return { distube, queue, voice, plugin, errors, song, advance, state: getPlaybackState(queue), history: health.history };
 37: }
 38: 
 39: test('a late voice error after stopping the native Queue is contained without restarting playback', { timeout: 10000 }, async t => {
 40:   const f = await fixture(t); await f.queue.play(); await f.queue.stop();
 41:   assert.doesNotThrow(() => f.voice.emit('error', new Error('late-voice-error')));
 42:   await tick(); assert.equal(f.distube.getQueue(guildId), undefined);
 43:   assert.equal(f.history.list(guildId).length, 0);
 44: });
 45: 
 46: test('voice cleanup failures are caught at the event boundary and still remove the exhausted queue', async t => {
 47:   const f = await fixture(t); f.queue.songs.splice(1); await f.queue.play();
 48:   f.voice.stop = () => { throw new Error('voice-stop-failure'); };
 49:   f.voice.emit('error', new Error('This video is private')); await tick();
 50:   assert.equal(f.queue.stopped, true); assert.equal(f.distube.getQueue(guildId), undefined);
 51:   assert.equal(f.history.list(guildId)[0].result, 'failed');
 52:   assert.ok(f.errors.some(args => String(args[0]).includes('Error de reproducción de voz')));
 53: });
 54: 
 55: test('duplicate errors and an old finish event cannot consume extra recovery attempts or skip the next song', async t => {
 56:   const f = await fixture(t); await f.queue.play(); const original = f.queue.songs[0], gate = deferred();
 57:   f.distube.handler.attachStreamInfo = async current => { await gate.promise; current.stream.url = 'https://unused.test/renewed'; };
 58:   f.voice.emit('error', new Error('HTTP 403 Forbidden'));
 59:   f.voice.emit('error', new Error('HTTP 403 Forbidden')); f.voice.emit('finish');
 60:   assert.equal(f.state.attempt, 1); assert.equal(f.queue.songs[0], original); assert.equal(f.queue.songs.length, 2);
 61:   assert.equal(f.history.list(guildId).length, 0);
 62:   gate.resolve(); await tick(); assert.equal(f.state.busy, 0);
 63: });
 64: 
 65: test('native skip during renewed audio starts the next track and records the original as skipped', async t => {
 66:   const f = await fixture(t); await f.queue.play();
 67:   f.voice.emit('error', new Error('HTTP 403 Forbidden')); await tick();
 68:   assert.equal(f.state.mode, 'recovering'); const oldStream = f.voice.stream;
 69:   const next = await f.queue.skip(); await tick();
 70:   assert.equal(next.id, 'BBBBBBBBBBB'); assert.equal(f.queue.songs[0], next);
 71:   assert.notEqual(f.voice.stream, oldStream); assert.equal(f.state.mode, 'preparing');
 72:   assert.equal(f.state.attempt, 0); assert.equal(f.history.list(guildId)[0].result, 'skipped');
 73: });
 74: 
 75: test('a blocked native queue retains its head when a late voice error or finish arrives', async t => {
 76:   const f = await fixture(t); await f.queue.play(); const songs = [...f.queue.songs];
 77:   getPlaybackHealth(f.distube).restoreBlocked(f.queue);
 78:   f.voice.emit('error', new Error('HTTP 403 Forbidden')); f.voice.emit('finish'); await tick();
 79:   assert.deepEqual(f.queue.songs, songs); assert.equal(f.state.blocked, true);
 80:   assert.equal(f.history.list(guildId).length, 0);
 81: });
 82: 
 83: test('a callback from an ended native queue cannot alter a successor using the same voice', async t => {
 84:   const f = await fixture(t); await f.queue.play(); const oldCallback = f.queue._listeners.error;
 85:   await f.queue.stop();
 86:   const successor = await f.distube.queues.create(f.voice.channel); t.after(() => { if (!successor.stopped) successor.remove(); });
 87:   const next = f.song('CCCCCCCCCCC'); successor.songs = [next]; await successor.play();
 88:   oldCallback(new Error('HTTP 403 Forbidden')); await tick();
 89:   assert.equal(f.distube.getQueue(guildId), successor); assert.deepEqual(successor.songs, [next]);
 90:   assert.equal(f.voice.listenerCount('error'), 2, 'one permanent observer and one active queue handler');
 91: });
 92: 
 93: test('repeated native sessions release queue handlers and monitor state while retaining a single late-error observer', async t => {
 94:   const f = await fixture(t); const health = getPlaybackHealth(f.distube);
 95:   let queue = f.queue;
 96:   for (let i = 0; i < 100; i++) {
 97:     await queue.stop();
 98:     assert.equal(f.voice.listenerCount('error'), 1); assert.equal(f.voice.listenerCount('finish'), 0);
 99:     assert.equal(health.queues.size, 0); assert.equal(queue._taskQueue.remaining, 0);
100:     if (i < 99) { queue = await f.distube.queues.create(f.voice.channel); queue.songs = [f.song('AAAAAAAAAAA')]; }
101:   }
102: });
103: 
104: test('the watchdog uses the same bounded recovery in a native queue and advances once after exhaustion', async t => {
105:   const f = await fixture(t); await f.queue.play(); const originalStream = f.voice.stream;
106:   let alternatives = 0; f.plugin.findAlternative = async () => { alternatives++; return null; };
107:   f.advance(2000);
108:   for (let i = 0; i < 4; i++) f.advance(); await tick();
109:   assert.equal(f.state.attempt, 1); assert.notEqual(f.voice.stream, originalStream);
110:   for (let renewal = 0; renewal < 2; renewal++) {
111:     for (let i = 0; i < 6; i++) f.advance();
112:     await tick();
113:   }
114:   assert.equal(alternatives, 1); assert.equal(f.queue.songs.length, 1); assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB');
115:   assert.equal(f.state.attempt, 0); assert.equal(f.history.list(guildId).length, 1);
116:   assert.equal(f.history.list(guildId)[0].result, 'failed'); assert.equal(f.queue._taskQueue.remaining, 0);
117: });
118: 
119: test('native pause and seek reset observation without creating false watchdog recoveries', async t => {
120:   const f = await fixture(t); await f.queue.play(); f.advance(2000); await f.queue.pause();
121:   for (let i = 0; i < 300; i++) f.advance();
122:   assert.equal(f.state.attempt, 0); assert.equal(f.state.mode, 'paused');
123:   await f.queue.resume(); await f.queue.seek(30);
124:   for (let i = 0; i < 5; i++) f.advance();
125:   assert.equal(f.state.attempt, 0); assert.equal(f.history.list(guildId).length, 0);
126:   f.advance(); await tick(); assert.equal(f.state.attempt, 1);
127: });
128: 
129: test('a finish arriving while native skip waits for the task lock cannot skip the new head twice', async t => {
130:   const f = await fixture(t); f.queue.songs.push(f.song('CCCCCCCCCCC')); await f.queue.play();
131:   await f.queue._taskQueue.queuing();
132:   const skipping = f.queue.skip(); await tick(); f.voice.emit('finish');
133:   f.queue._taskQueue.resolve(); await skipping; await tick();
134:   assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB'); assert.equal(f.queue.songs.length, 2);
135:   assert.equal(f.history.list(guildId)[0].result, 'skipped');
136: });
137: 
138: test('a finish from the old resource cannot end a song after native seek installs new audio', async t => {
139:   const f = await fixture(t); await f.queue.play(); const original = f.queue.songs[0];
140:   await f.queue._taskQueue.queuing();
141:   const seeking = f.queue.seek(30); await tick(); f.voice.emit('finish');
142:   f.queue._taskQueue.resolve(); await seeking; await tick();
143:   assert.equal(f.queue.songs[0], original); assert.equal(f.history.list(guildId).length, 0);
144: });
145: 
146: test('duplicate native finish callbacks share one pending transition and advance only once', async t => {
147:   const f = await fixture(t); f.queue.songs.push(f.song('CCCCCCCCCCC')); await f.queue.play();
148:   await f.queue._taskQueue.queuing(); f.voice.emit('finish'); f.voice.emit('finish');
149:   f.queue._taskQueue.resolve(); await tick();
150:   assert.equal(f.queue.songs[0].id, 'BBBBBBBBBBB'); assert.equal(f.queue.songs.length, 2);
151:   assert.equal(f.history.list(guildId).length, 1); assert.equal(f.queue._taskQueue.remaining, 0);
152: });
````

## File: test_mix.js
````javascript
 1: const {json} = require('@distube/yt-dlp');
 2: const videoId = 'pXRviuL6vMY'; // The Strokes - Reptilia
 3: const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
 4: 
 5: json(mixUrl, {
 6:   dumpSingleJson: true,
 7:   noWarnings: true,
 8:   flatPlaylist: true,
 9:   skipDownload: true,
10:   simulate: true,
11: }).then(r => {
12:   console.log('Playlist title:', r.title);
13:   console.log('Entry count:', r.entries?.length);
14:   if (r.entries) {
15:     r.entries.slice(0, 10).forEach((e, i) => {
16:       console.log((i + 1) + '. ' + e.title + ' | ' + (e.url || e.webpage_url));
17:     });
18:   }
19: }).catch(e => console.error('ERROR:', e.message));
````

## File: scripts/logger.cjs
````javascript
 1: 'use strict';
 2: const fs = require('node:fs/promises');
 3: const path = require('node:path');
 4: const { inspect } = require('node:util');
 5: 
 6: function redact(value) {
 7:   return String(value)
 8:     .replace(/https?:\/\/[^\s<>"']+/gi, '[enlace oculto]')
 9:     .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[cabecera oculta]')
10:     .replace(/((?:token|secret|password|client_secret)\s*['"]?\s*[:=]\s*)(?:'[^']*'|"[^"]*"|[^\s,}]+)/gi, '$1[oculto]')
11:     .replace(/\b(?:Bot|Bearer)\s+[\w.\-/+=]{20,}/gi, '[credencial oculta]')
12:     .slice(0, 8_000);
13: }
14: 
15: function createLogger(options = {}) {
16:   const setting = (key, fallback, maximum) => { const value = Number(process.env[key]); return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback; };
17:   const directory = options.directory || path.resolve(__dirname, '../logs');
18:   const name = options.name || 'bot';
19:   const file = path.join(directory, `${name}.jsonl`);
20:   const maxBytes = options.maxBytes ?? setting('LOG_MAX_BYTES', 10 * 1024 * 1024, 100 * 1024 * 1024);
21:   const backups = options.backups ?? setting('LOG_BACKUPS', 5, 20);
22:   const maxPending = options.maxPending ?? 500;
23:   const report = options.report || console.error.bind(console);
24:   const queue = [];
25:   let running, bytes, retryAt = 0, closed = false, dropped = 0;
26:   async function drain() {
27:     try {
28:       await fs.mkdir(directory, { recursive: true });
29:       if (bytes === undefined) bytes = await fs.stat(file).then(s => s.size, e => { if (e.code === 'ENOENT') return 0; throw e; });
30:       while (queue.length) {
31:         const line = queue.shift();
32:         const size = Buffer.byteLength(line);
33:         if (bytes + size > maxBytes) {
34:           for (let i = backups; i >= 1; i--) {
35:             const source = i === 1 ? file : `${file}.${i - 1}`;
36:             await fs.rm(`${file}.${i}`, { force: true });
37:             await fs.rename(source, `${file}.${i}`).catch(e => { if (e.code !== 'ENOENT') throw e; });
38:           }
39:           bytes = 0;
40:         }
41:         await fs.appendFile(file, line, { mode: 0o600 });
42:         bytes += size;
43:       }
44:     } catch (error) {
45:       dropped += queue.length; queue.length = 0; bytes = undefined;
46:       retryAt = Date.now() + 60_000;
47:       report('[Logs] No se pudo escribir; continúa la salida por consola:', redact(error.message));
48:     } finally { running = undefined; }
49:   }
50:   function write(level, args) {
51:     if (closed || Date.now() < retryAt || queue.length >= maxPending) { dropped++; return; }
52:     const message = redact(args.map(value => typeof value === 'string' ? value : inspect(value, { depth: 3, maxArrayLength: 15, maxStringLength: 2000, getters: false })).join(' '));
53:     queue.push(JSON.stringify({ time: new Date().toISOString(), level, message }) + '\n');
54:     if (!running) running = drain();
55:   }
56:   async function flush(timeout = 750) {
57:     if (!running) return;
58:     let timer;
59:     await Promise.race([running, new Promise(resolve => { timer = setTimeout(resolve, timeout); timer.unref(); })]);
60:     clearTimeout(timer);
61:   }
62:   return { write, flush, close: async () => { closed = true; await flush(); }, stats: () => ({ pending: queue.length, dropped }) };
63: }
64: 
65: function installConsole(options) {
66:   const original = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level, console[level]]));
67:   const logger = createLogger({ ...options, report: original.error.bind(console) });
68:   for (const level of Object.keys(original)) console[level] = (...args) => {
69:     const safe = args.map(value => redact(typeof value === 'string' ? value : inspect(value, { depth: 3, maxArrayLength: 15, maxStringLength: 2000, getters: false })));
70:     original[level].apply(console, safe);
71:     logger.write(level, safe);
72:   };
73:   return { ...logger, restore: () => { Object.assign(console, original); } };
74: }
75: module.exports = { createLogger, installConsole, redact };
````

## File: src/commands/recommend.ts
````typescript
  1: import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
  2: import { Song } from 'distube';
  3: import { Command } from './command.types';
  4: import { ensureGuild } from '../utils/guard';
  5: import { BotColors } from '../utils/colors';
  6: import { YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';
  7: import { getPlaybackState } from '../music/playbackState';
  8: 
  9: const MAX_RECOMMENDATIONS = 20;
 10: 
 11: export function selectRecommendations(candidates: Song[], excluded: Song[], amount: number): Song[] {
 12:   const seenIds = new Set(excluded.map((song) => song.id));
 13:   const seenUrls = new Set(excluded.map((song) => song.url).filter((url): url is string => Boolean(url)));
 14:   const selected: Song[] = [];
 15: 
 16:   for (const song of candidates) {
 17:     if (seenIds.has(song.id) || (song.url && seenUrls.has(song.url))) continue;
 18:     selected.push(song);
 19:     seenIds.add(song.id);
 20:     if (song.url) seenUrls.add(song.url);
 21:     if (selected.length >= amount) break;
 22:   }
 23: 
 24:   return selected;
 25: }
 26: 
 27: export const recommend: Command = {
 28:   data: new SlashCommandBuilder()
 29:     .setName('recommend')
 30:     .setDescription('Añade canciones de YouTube Mix basadas en la cola')
 31:     .addIntegerOption((option) => option
 32:       .setName('cantidad')
 33:       .setDescription('Cantidad de canciones a añadir (1 a 20)')
 34:       .setMinValue(1)
 35:       .setMaxValue(MAX_RECOMMENDATIONS)) as SlashCommandBuilder,
 36: 
 37:   async execute(interaction) {
 38:     const guild = await ensureGuild(interaction);
 39:     if (!guild) return;
 40: 
 41:     const queue = interaction.client.distube.getQueue(guild.id);
 42:     const current = queue?.songs[0];
 43:     if (!queue || !current) {
 44:       await interaction.reply({
 45:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Primero reproduce una canción.')],
 46:         flags: MessageFlags.Ephemeral,
 47:       });
 48:       return;
 49:     }
 50: 
 51:     const member = guild.members.cache.get(interaction.user.id);
 52:     if (!member?.voice.channel || member.voice.channel.id !== queue.voiceChannel?.id) {
 53:       await interaction.reply({
 54:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en el mismo canal de voz que el bot.')],
 55:         flags: MessageFlags.Ephemeral,
 56:       });
 57:       return;
 58:     }
 59: 
 60:     const plugin = interaction.client.distube.plugins.find((item): item is YtDlpSearchPlugin => item instanceof YtDlpSearchPlugin);
 61:     if (!plugin) throw new Error('No se encontró el extractor de YouTube.');
 62: 
 63:     const amount = interaction.options.getInteger('cantidad') ?? 5;
 64:     await interaction.deferReply();
 65:     const revision = getPlaybackState(queue)?.revision;
 66: 
 67:     try {
 68:       const seeds = [current, queue.songs[queue.songs.length - 1]]
 69:         .filter((song): song is Song => Boolean(song))
 70:         .filter((song, index, songs) => songs.findIndex((item) => item.id === song.id) === index);
 71:       const candidates: Song[] = [];
 72: 
 73:       for (const seed of seeds) {
 74:         try {
 75:           candidates.push(...await plugin.getRecommendations(seed));
 76:         } catch (error) {
 77:           console.warn(`No se pudo consultar YouTube Mix para ${seed.name ?? seed.id}:`, error);
 78:         }
 79:         if (selectRecommendations(candidates, [...queue.songs, ...queue.previousSongs], amount).length >= amount) break;
 80:       }
 81: 
 82:       if (interaction.client.distube.getQueue(guild.id) !== queue || queue.stopped || getPlaybackState(queue)?.closing ||
 83:         getPlaybackState(queue)?.revision !== revision || member.voice.channel?.id !== queue.voiceChannel?.id) {
 84:         await interaction.editReply({
 85:           embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('La cola terminó o cambió, o cambiaste de canal de voz mientras buscaba recomendaciones.')],
 86:         });
 87:         return;
 88:       }
 89: 
 90:       const selected = selectRecommendations(candidates, [...queue.songs, ...queue.previousSongs], amount);
 91:       if (!selected.length) {
 92:         await interaction.editReply({
 93:           embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('No encontré recomendaciones nuevas para esta cola.')],
 94:         });
 95:         return;
 96:       }
 97: 
 98:       for (const song of selected) song.member = member;
 99:       queue.addToQueue(selected);
100:       await interaction.editReply({
101:         embeds: [new EmbedBuilder().setColor(BotColors.Info)
102:           .setDescription(`🎵 Añadidas **${selected.length}** recomendaciones a la cola.`)],
103:       });
104:     } catch (error) {
105:       console.error('Error en /recommend:', error);
106:       await interaction.editReply({
107:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No pude obtener recomendaciones ahora mismo.')],
108:       });
109:     }
110:   },
111: };
````

## File: src/commands/remove.ts
````typescript
1: export { remove } from './queueManagement';
````

## File: src/commands/shuffle.ts
````typescript
1: export { shuffle } from './queueManagement';
````

## File: src/commands/skip.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: 
 6: export const skip: Command = {
 7:   data: new SlashCommandBuilder()
 8:     .setName('skip')
 9:     .setDescription('Salta a la siguiente canción en la cola'),
10: 
11:   async execute(interaction) {
12:     const guild = await ensureGuild(interaction);
13:     if (!guild) return;
14: 
15:     const distube = interaction.client.distube;
16:     const queue = distube.getQueue(guild.id);
17: 
18:     if (!queue) {
19:       await interaction.reply({
20:         embeds: [
21:           new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.'),
22:         ],
23:         flags: MessageFlags.Ephemeral,
24:       });
25:       return;
26:     }
27: 
28:     try {
29:       const song = await queue.skip();
30:       await interaction.reply({
31:         embeds: [
32:           new EmbedBuilder().setColor(BotColors.Success).setDescription(`⏭️ Saltando a: **${song.name}**`),
33:         ],
34:       });
35:     } catch {
36:       await interaction.reply({
37:         embeds: [
38:           new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay más canciones en la cola.'),
39:         ],
40:         flags: MessageFlags.Ephemeral,
41:       });
42:     }
43:   },
44: };
````

## File: src/commands/volume.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: 
 6: export const volume: Command = {
 7:   data: new SlashCommandBuilder()
 8:     .setName('volume')
 9:     .setDescription('Ajusta el volumen del bot')
10:     .addIntegerOption((opt) =>
11:       opt.setName('valor').setDescription('Volumen del 1 al 100').setRequired(true).setMinValue(1).setMaxValue(100),
12:     ) as SlashCommandBuilder,
13: 
14:   async execute(interaction) {
15:     const guild = await ensureGuild(interaction);
16:     if (!guild) return;
17: 
18:     const distube = interaction.client.distube;
19:     const queue = distube.getQueue(guild.id);
20: 
21:     if (!queue) {
22:       await interaction.reply({
23:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
24:         flags: MessageFlags.Ephemeral,
25:       });
26:       return;
27:     }
28: 
29:     const vol = interaction.options.getInteger('valor', true);
30:     distube.setVolume(guild.id, vol);
31: 
32:     await interaction.reply({
33:       embeds: [new EmbedBuilder().setColor(BotColors.Info).setDescription(`🔊 Volumen ajustado a **${vol}%**`)],
34:     });
35:   },
36: };
````

## File: src/music/history.ts
````typescript
  1: import { randomBytes } from 'node:crypto';
  2: import { existsSync, readFileSync, statSync } from 'node:fs';
  3: import { mkdir, rename, writeFile } from 'node:fs/promises';
  4: import { dirname } from 'node:path';
  5: import { Queue, Song } from 'distube';
  6: 
  7: export interface HistoryEntry {
  8:   id: string; guildId: string; title: string; source: string; time: number;
  9:   result: 'completed' | 'skipped' | 'failed'; code: string; reference: string;
 10:   url: string | undefined; searchSource: 'youtube' | 'soundcloud'; alternative: string | undefined;
 11: }
 12: interface Request { id: string; original: Song; done: boolean; }
 13: const WEEK = 7 * 24 * 60 * 60_000;
 14: export function publicMusicUrl(input: string | undefined): string | undefined {
 15:   if (!input || input.length > 1000) return undefined;
 16:   try {
 17:     const url = new URL(input ?? '');
 18:     if (url.protocol !== 'https:' || url.username || url.password) return undefined;
 19:     const host = url.hostname.toLowerCase();
 20:     if (['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
 21:       const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
 22:       return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined;
 23:     }
 24:     if (['soundcloud.com', 'www.soundcloud.com'].includes(host) && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) return `https://soundcloud.com${url.pathname}`;
 25:     if (host === 'open.spotify.com' && /^\/track\/[a-zA-Z0-9]+$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
 26:     if (host === 'music.apple.com' && url.pathname.includes('/album/') && /^\d+$/.test(url.searchParams.get('i') ?? '')) return `${url.origin}${url.pathname}?i=${url.searchParams.get('i')}`;
 27:   } catch { /* Unusable sources stay visible without a retry button. */ }
 28:   return undefined;
 29: }
 30: 
 31: export class HistoryStore {
 32:   private entries: HistoryEntry[] = [];
 33:   private readonly requests = new WeakMap<Queue, WeakMap<Song, Request>>();
 34:   private readonly claims = new Map<string, number>();
 35:   private pending: Promise<void> | undefined;
 36:   private dirty = false;
 37:   private retryAt = 0;
 38:   private retryTimer: ReturnType<typeof setTimeout> | undefined;
 39:   private closed = false;
 40:   private closing: Promise<void> | undefined;
 41:   constructor(private readonly path?: string) {
 42:     if (!path) return;
 43:     try {
 44:       if (!existsSync(path)) return;
 45:       if (statSync(path).size > 3_000_000) throw new Error('Historial demasiado grande');
 46:       const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
 47:       if (!Array.isArray(input)) throw new Error('Formato de historial inválido');
 48:       this.entries = input.slice(0, 2000).filter((e): e is HistoryEntry => Boolean(e && typeof e === 'object' &&
 49:         /^[a-f0-9]{16}$/.test(e.id) && /^\d{15,22}$/.test(e.guildId) && typeof e.title === 'string' && e.title.length <= 200 &&
 50:         typeof e.source === 'string' && e.source.length <= 60 && Number.isFinite(e.time) && e.time <= Date.now() &&
 51:         ['completed', 'skipped', 'failed'].includes(e.result) && typeof e.code === 'string' && /^[A-Z0-9_]{0,64}$/.test(e.code) &&
 52:         typeof e.reference === 'string' && /^[a-f0-9]{0,16}$/.test(e.reference) &&
 53:         (!e.url || publicMusicUrl(e.url) === e.url) && ['youtube', 'soundcloud'].includes(e.searchSource) &&
 54:         (!e.alternative || typeof e.alternative === 'string' && e.alternative.length <= 200)));
 55:       this.prune();
 56:     } catch (error) { console.error('[Historial] No se pudo leer; el bot continúa:', error); }
 57:   }
 58:   private book(queue: Queue): WeakMap<Song, Request> {
 59:     let book = this.requests.get(queue);
 60:     if (!book) { book = new WeakMap(); this.requests.set(queue, book); }
 61:     return book;
 62:   }
 63:   begin(queue: Queue, song: Song): void {
 64:     const book = this.book(queue), current = book.get(song);
 65:     if (!current || current.done) book.set(song, { id: randomBytes(8).toString('hex'), original: song, done: false });
 66:   }
 67:   alias(queue: Queue, original: Song, alternative: Song): void {
 68:     if (!this.book(queue).has(original)) this.begin(queue, original);
 69:     this.book(queue).set(alternative, this.book(queue).get(original)!);
 70:   }
 71:   finish(queue: Queue, song: Song, result: HistoryEntry['result'], code = '', reference = ''): boolean {
 72:     const book = this.book(queue);
 73:     if (!book.has(song)) this.begin(queue, song);
 74:     const request = book.get(song)!;
 75:     if (request.done) return false;
 76:     request.done = true;
 77:     const original = request.original;
 78:     const source = (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source;
 79:     this.entries.unshift({ id: request.id, guildId: queue.id, title: (original.name ?? 'Canción sin título').slice(0, 200),
 80:       source: source.slice(0, 60), time: Date.now(), result, code: code.slice(0, 64), reference,
 81:       url: publicMusicUrl(original.url), searchSource: source.includes('soundcloud') ? 'soundcloud' : 'youtube',
 82:       alternative: song !== original ? (song.name ?? '').slice(0, 200) : undefined });
 83:     this.prune(); this.save(); return true;
 84:   }
 85:   list(guildId: string): HistoryEntry[] { this.prune(); return this.entries.filter(e => e.guildId === guildId).map(e => ({ ...e })); }
 86:   get(guildId: string, id: string): HistoryEntry | undefined { return this.list(guildId).find(e => e.id === id); }
 87:   claim(guildId: string, id: string): HistoryEntry | undefined {
 88:     const entry = this.get(guildId, id), key = `${guildId}:${id}`, now = Date.now();
 89:     for (const [claim, time] of this.claims) if (now - time >= 30_000) this.claims.delete(claim);
 90:     if (!entry?.url || this.claims.has(key)) return undefined;
 91:     if (this.claims.size >= 2000) this.claims.delete(this.claims.keys().next().value!);
 92:     this.claims.set(key, now); return entry;
 93:   }
 94:   private prune(): void {
 95:     const counts = new Map<string, number>(), now = Date.now();
 96:     let bytes = 2;
 97:     this.entries = this.entries.filter(e => {
 98:       const count = counts.get(e.guildId) ?? 0;
 99:       if (now - e.time > WEEK || count >= 100) return false;
100:       const size = Buffer.byteLength(JSON.stringify(e)) + 1;
101:       if (bytes + size > 2_500_000) return false;
102:       bytes += size;
103:       counts.set(e.guildId, count + 1); return true;
104:     }).slice(0, 2000);
105:   }
106:   private save(): void {
107:     if (!this.path || this.closed) return;
108:     this.dirty = true;
109:     void this.write();
110:   }
111:   private clearRetry(): void {
112:     if (this.retryTimer) clearTimeout(this.retryTimer);
113:     this.retryTimer = undefined;
114:   }
115:   private scheduleRetry(): void {
116:     if (!this.path || this.closed || !this.dirty || this.retryTimer) return;
117:     this.retryTimer = setTimeout(() => {
118:       this.retryTimer = undefined;
119:       void this.write();
120:     }, Math.max(0, this.retryAt - Date.now()));
121:     this.retryTimer.unref();
122:   }
123:   private write(force = false): Promise<void> | undefined {
124:     if (this.pending) return this.pending;
125:     if (!this.path || !this.dirty || this.closed && !force) return undefined;
126:     if (!force && Date.now() < this.retryAt) { this.scheduleRetry(); return undefined; }
127:     this.clearRetry();
128:     this.pending = (async () => {
129:       try {
130:         await mkdir(dirname(this.path!), { recursive: true });
131:         while (this.dirty) {
132:           this.prune();
133:           this.dirty = false;
134:           await writeFile(`${this.path}.tmp`, JSON.stringify(this.entries), { mode: 0o600 });
135:           await rename(`${this.path}.tmp`, this.path!);
136:         }
137:         this.retryAt = 0;
138:       } catch (error) {
139:         this.retryAt = Date.now() + 60_000;
140:         this.dirty = true;
141:         console.error(this.closed ? '[Historial] No se pudo guardar durante el cierre:' :
142:           '[Historial] No se pudo guardar; se reintentará en 60 segundos:', error);
143:       } finally {
144:         this.pending = undefined;
145:         this.scheduleRetry();
146:       }
147:     })();
148:     return this.pending;
149:   }
150:   async flush(): Promise<void> { await this.write(); }
151:   close(): Promise<void> {
152:     if (!this.closing) {
153:       this.closed = true;
154:       this.clearRetry();
155:       this.closing = (async () => {
156:         await this.pending;
157:         // One final attempt may bypass the cooldown; failures never restart it.
158:         await this.write(true);
159:       })();
160:     }
161:     return this.closing;
162:   }
163: }
````

## File: src/music/playbackHealth.ts
````typescript
  1: import { randomBytes } from 'node:crypto';
  2: import { DisTube, Queue, Song } from 'distube';
  3: import { getPlaybackState, initPlaybackState, resetObservation } from './playbackState';
  4: import { HistoryStore } from './history';
  5: import type { RecoveryStatus } from './playbackRecovery';
  6: import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';
  7: 
  8: export interface HealthOptions { monitor?: boolean; breaker?: boolean; clock?: () => number; interval?: number; }
  9: const managers = new WeakMap<DisTube, PlaybackHealth>();
 10: export function getPlaybackHealth(distube: DisTube): PlaybackHealth | undefined { return managers.get(distube); }
 11: 
 12: export class PlaybackHealth {
 13:   private readonly queues = new Set<Queue>();
 14:   private readonly timer: NodeJS.Timeout | undefined;
 15:   readonly now: () => number;
 16:   private disposed = false;
 17:   readonly monitor: boolean;
 18:   readonly breaker: boolean;
 19:   constructor(private readonly distube: DisTube, readonly history = new HistoryStore(),
 20:     private readonly changed: (queue: Queue) => void = () => {}, private readonly stall: (queue: Queue) => Promise<void> = async () => {}, options: HealthOptions = {}) {
 21:     this.now = options.clock ?? Date.now;
 22:     this.monitor = options.monitor ?? process.env['AUDIO_WATCHDOG_ENABLED'] !== 'false';
 23:     this.breaker = options.breaker ?? process.env['AUDIO_BREAKER_ENABLED'] !== 'false';
 24:     managers.set(distube, this);
 25:     if (options.interval !== 0) { this.timer = setInterval(() => this.tick(), options.interval ?? 2000); this.timer.unref(); }
 26:   }
 27:   init(queue: Queue): void { initPlaybackState(queue, this.now()); this.queues.add(queue); }
 28:   beforePlay(queue: Queue, song: Song): void {
 29:     this.init(queue);
 30:     const state = getPlaybackState(queue)!;
 31:     if (state.song !== song && !['recovering', 'alternative'].includes(state.mode)) state.attempt = 0;
 32:     this.history.begin(queue, song);
 33:     state.song = song; state.busy++;
 34:     if (!state.blocked && !['recovering', 'alternative'].includes(state.mode)) state.mode = 'preparing';
 35:     resetObservation(queue, this.now()); this.changed(queue);
 36:   }
 37:   afterPlay(queue: Queue): void { const state = getPlaybackState(queue); if (state) state.busy = Math.max(0, state.busy - 1); }
 38:   started(queue: Queue, song: Song): void {
 39:     this.init(queue); this.history.begin(queue, song);
 40:     const state = getPlaybackState(queue)!;
 41:     if (state.song !== song && !['recovering', 'alternative'].includes(state.mode)) state.attempt = 0;
 42:     state.song = song;
 43:     if (!state.blocked && !['recovering', 'alternative'].includes(state.mode)) state.mode = queue.paused ? 'paused' : 'preparing';
 44:     resetObservation(queue, this.now());
 45:   }
 46:   recovery(status: RecoveryStatus): void {
 47:     const { queue, original, song, stage } = status;
 48:     if (this.disposed || queue.stopped || getPlaybackState(queue)?.closing ||
 49:       (typeof this.distube.getQueue === 'function' && this.distube.getQueue(queue.id) !== queue)) return;
 50:     this.init(queue);
 51:     const state = getPlaybackState(queue)!;
 52:     if (original !== song) this.history.alias(queue, original, song);
 53:     state.attempt = status.attempt;
 54:     if (['renew', 'alternative', 'failed'].includes(stage)) {
 55:       if (!state.lastError || state.lastError.code !== status.code || state.errorSong !== original) {
 56:         state.lastError = { code: status.code, reference: randomBytes(6).toString('hex'), time: this.now() };
 57:         state.errorSong = original;
 58:       }
 59:       console.info('[Incidente]', JSON.stringify({ guildId: queue.id, session: state.session, song: original.name,
 60:         code: status.code, reference: state.lastError.reference, attempt: status.attempt, result: stage }));
 61:     }
 62:     if (stage === 'renew') state.mode = 'recovering';
 63:     if (stage === 'alternative') state.mode = 'alternative';
 64:     if (stage === 'recovered') state.mode = queue.paused ? 'paused' : 'playing';
 65:     if (stage === 'cancelled') { state.mode = queue.paused ? 'paused' : 'preparing'; state.attempt = 0; }
 66:     if (stage === 'failed') this.failed(queue, song, status.code);
 67:     if (state.blocked) state.mode = 'blocked';
 68:     this.changed(queue);
 69:   }
 70:   private failed(queue: Queue, song: Song, code: string): void {
 71:     const state = getPlaybackState(queue)!;
 72:     if (!this.history.finish(queue, song, 'failed', code, state.lastError?.reference)) return;
 73:     state.failures = state.failures.filter(time => this.now() - time < 300_000);
 74:     state.failures.push(this.now());
 75:     if (!state.blocked) state.mode = 'preparing';
 76:     if (this.breaker && (state.failures.length >= 3 || state.probe)) {
 77:       state.blocked = true; state.probe = false; state.mode = 'blocked'; queue.paused = true;
 78:       if (!queue.songs.includes(song)) queue.songs.unshift(song);
 79:       queue.voice.pause?.();
 80:       console.warn('[Cola bloqueada]', JSON.stringify({ guildId: queue.id, session: state.session, failures: state.failures.length, reference: state.lastError?.reference }));
 81:     }
 82:   }
 83:   completed(queue: Queue, song: Song): void {
 84:     this.history.finish(queue, song, 'completed');
 85:     const state = getPlaybackState(queue);
 86:     if (state) { state.failures = []; state.probe = false; state.attempt = 0; }
 87:   }
 88:   async retryBlocked(queue: Queue): Promise<void> {
 89:     const state = getPlaybackState(queue);
 90:     if (!state?.blocked || state.busy || queue.stopped || this.distube.getQueue(queue.id) !== queue) return;
 91:     const original = queue.songs[0];
 92:     if (!original) return;
 93:     const plugin = (original.stream.playFromSource ? original : original.stream.song)?.plugin;
 94:     if (plugin instanceof YtDlpSearchPlugin) plugin.invalidateStream(original, 0);
 95:     const copy = new Song({ plugin: original.plugin, source: original.source, id: original.id, name: original.name ?? original.id,
 96:       duration: original.duration, ...(original.url ? { url: original.url } : {}), isLive: Boolean(original.isLive),
 97:       ...(original.thumbnail ? { thumbnail: original.thumbnail } : {}), uploader: original.uploader,
 98:       ageRestricted: Boolean(original.ageRestricted), playFromSource: original.stream.playFromSource }, { metadata: original.metadata, ...(original.member ? { member: original.member } : {}) });
 99:     state.blocked = false; state.probe = true; state.mode = 'preparing'; queue.paused = false;
100:     queue.songs[0] = copy; queue._beginTime = 0; queue.voice.unpause?.();
101:     resetObservation(queue, this.now()); this.changed(queue);
102:     await queue.play();
103:   }
104:   restoreBlocked(queue: Queue): void { this.init(queue); const state = getPlaybackState(queue)!; state.blocked = true; state.mode = 'blocked'; queue.paused = true; this.changed(queue); }
105:   tick(): void {
106:     if (this.disposed) return;
107:     for (const queue of this.queues) {
108:       try {
109:         if (queue.stopped || this.distube.getQueue(queue.id) !== queue) { this.end(queue); continue; }
110:         const state = getPlaybackState(queue)!, now = this.now();
111:         const elapsed = Math.max(0, Math.min(5000, now - state.observedAt)); state.observedAt = now;
112:         if (state.closing || state.blocked || state.busy || queue.paused || queue.voice.isDisconnected) {
113:           state.continuous = 0;
114:           if (queue.voice.isDisconnected) state.mode = 'disconnected';
115:           else if (!state.blocked && queue.paused) state.mode = 'paused';
116:           continue;
117:         }
118:         const song = queue.songs[0], resource = queue.voice.stream?.audioResource, frames = resource?.playbackDuration ?? 0;
119:         if (!song) continue;
120:         if (resource !== state.resource || song !== state.song) {
121:           state.resource = resource; state.song = song; state.frames = 0; state.waiting = 0; state.continuous = 0; state.stalled = false;
122:         }
123:         if (frames > state.frames) {
124:           state.lastProgress = now; state.waiting = 0; state.continuous += elapsed; state.stalled = false;
125:           if (state.mode !== 'playing') { state.mode = 'playing'; this.changed(queue); }
126:           if (state.continuous >= 30_000) { state.failures = []; state.probe = false; }
127:         } else {
128:           state.continuous = 0; state.waiting += elapsed;
129:           const threshold = frames > 0 ? 8000 : 12_000;
130:           if (this.monitor && state.waiting >= threshold && !state.stalled) {
131:             state.stalled = true; state.mode = 'recovering'; this.changed(queue);
132:             void this.stall(queue).catch(error => { console.error('[Detector de audio]', error); });
133:           }
134:         }
135:         state.frames = frames;
136:       } catch (error) { console.error('[Monitor de reproducción]', error); }
137:     }
138:   }
139:   end(queue: Queue): void { this.queues.delete(queue); const state = getPlaybackState(queue); if (state) state.mode = 'ended'; }
140:   dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); this.queues.clear(); }
141: }
142: 
143: export function stallError(): Error { return Object.assign(new Error('El audio dejó de avanzar'), { errorCode: 'AUDIO_STALLED' }); }
````

## File: src/music/playerPanel.ts
````typescript
  1: import { randomBytes } from 'node:crypto';
  2: import { Message, MessageCreateOptions } from 'discord.js';
  3: import { DisTube, Queue, Song } from 'distube';
  4: import { createNowPlayingEmbed, createPlayerButtons, queueRemaining } from '../utils/embed';
  5: import { getPlaybackState, playbackLabel } from './playbackState';
  6: 
  7: interface Panel {
  8:   queue: Queue;
  9:   song: Song;
 10:   session: string;
 11:   message: Message | undefined;
 12:   channelId: string | undefined;
 13:   timer: NodeJS.Timeout | undefined;
 14:   pending: Promise<void>;
 15:   running: boolean;
 16:   dirty: boolean;
 17:   ended: string | undefined;
 18:   lastPayload: string;
 19:   retryAt: number;
 20: }
 21: 
 22: const managers = new WeakMap<DisTube, PlayerPanels>();
 23: 
 24: export function getPlayerPanels(distube: DisTube): PlayerPanels | undefined {
 25:   return managers.get(distube);
 26: }
 27: 
 28: /** Discord failures belong to the display layer and must never stop audio playback. */
 29: export class PlayerPanels {
 30:   private readonly panels = new Map<string, Panel>();
 31:   private disposed = false;
 32: 
 33:   constructor(distube: DisTube, private readonly intervalMs = 20_000) {
 34:     managers.set(distube, this);
 35:   }
 36: 
 37:   show(queue: Queue, song = queue.songs[0], force = false): Promise<void> {
 38:     if (this.disposed || queue.stopped || !song) return Promise.resolve();
 39:     let panel = this.panels.get(queue.id);
 40:     if (panel?.queue !== queue) {
 41:       // Wait for an in-flight send and its final disabled edit before replacing a session.
 42:       const previous = panel ? this.close(panel.queue) : Promise.resolve();
 43:       panel = { queue, song, session: randomBytes(8).toString('hex'), message: undefined,
 44:         channelId: undefined, timer: undefined, pending: previous, running: false, dirty: false,
 45:         ended: undefined, lastPayload: '', retryAt: 0 };
 46:       this.panels.set(queue.id, panel);
 47:       if (this.intervalMs > 0) {
 48:         panel.timer = setInterval(() => { void this.refresh(queue); }, this.intervalMs);
 49:         panel.timer.unref();
 50:       }
 51:     }
 52:     panel.song = song;
 53:     if (force) panel.lastPayload = '';
 54:     return this.schedule(panel);
 55:   }
 56: 
 57:   refresh(queue: Queue): Promise<void> {
 58:     const panel = this.panels.get(queue.id);
 59:     if (!panel || panel.queue !== queue || this.disposed) return Promise.resolve();
 60:     if (queue.stopped) return this.close(queue);
 61:     if (queue.songs[0]) panel.song = queue.songs[0];
 62:     return this.schedule(panel);
 63:   }
 64: 
 65:   close(queue: Queue, reason = '⏹ Reproducción finalizada'): Promise<void> {
 66:     const panel = this.panels.get(queue.id);
 67:     if (!panel || panel.queue !== queue) return Promise.resolve();
 68:     this.panels.delete(queue.id);
 69:     panel.ended = reason;
 70:     panel.retryAt = 0;
 71:     if (panel.timer) clearInterval(panel.timer);
 72:     return this.schedule(panel);
 73:   }
 74: 
 75:   owns(queue: Queue, messageId: string): boolean {
 76:     const panel = this.panels.get(queue.id);
 77:     return !this.disposed && !queue.stopped && panel?.queue === queue && panel.message?.id === messageId;
 78:   }
 79: 
 80:   session(queue: Queue): string | undefined {
 81:     const panel = this.panels.get(queue.id);
 82:     return panel?.queue === queue && !queue.stopped ? panel.session : undefined;
 83:   }
 84: 
 85:   url(queue: Queue): string | undefined {
 86:     const panel = this.panels.get(queue.id);
 87:     return panel?.queue === queue ? panel.message?.url : undefined;
 88:   }
 89: 
 90:   dispose(): void {
 91:     this.disposed = true;
 92:     for (const panel of this.panels.values()) {
 93:       if (panel.timer) clearInterval(panel.timer);
 94:     }
 95:     this.panels.clear();
 96:   }
 97: 
 98:   private schedule(panel: Panel): Promise<void> {
 99:     panel.dirty = true;
100:     if (panel.running) return panel.pending;
101:     panel.running = true;
102:     panel.pending = panel.pending.then(async () => {
103:       try {
104:         // Coalesce updates while a Discord request is pending; never overlap message writes.
105:         while (panel.dirty && !this.disposed) {
106:           panel.dirty = false;
107:           try {
108:             await this.write(panel);
109:           } catch (error) {
110:             panel.retryAt = Date.now() + 60_000;
111:             console.error('[Panel de reproducción]', error);
112:           }
113:         }
114:       } finally { panel.running = false; }
115:     });
116:     return panel.pending;
117:   }
118: 
119:   private async write(panel: Panel): Promise<void> {
120:     if (Date.now() < panel.retryAt) return;
121:     const { queue } = panel;
122:     const channel = queue.textChannel;
123:     if (!channel) return;
124:     const ended = panel.ended;
125:     const payload = {
126:       embeds: [createNowPlayingEmbed(panel.song, ended ? 0 : (queue.currentTime || 0) * 1000, {
127:         paused: queue.paused, volume: queue.volume, nextSong: queue.songs[1],
128:         status: playbackLabel(queue), remaining: queueRemaining(queue),
129:         queued: Math.max(0, queue.songs.length - 1), autoplay: queue.autoplay, repeatMode: queue.repeatMode, ended,
130:       })],
131:       components: [createPlayerButtons(queue.paused, Boolean(ended), queue.songs.length < 2 && !queue.autoplay, Boolean(getPlaybackState(queue)?.blocked))],
132:       allowedMentions: { parse: [] },
133:     } satisfies MessageCreateOptions;
134:     const fingerprint = JSON.stringify(payload);
135:     if (panel.message && panel.channelId !== channel.id && !ended) {
136:       // A new request may choose another text channel. Old controls must become inert.
137:       try { await panel.message.edit({ components: [createPlayerButtons(false, true)] }); }
138:       catch (error) { console.error('[Desactivar panel anterior]', error); }
139:       panel.message = undefined;
140:       panel.lastPayload = '';
141:     }
142:     if (panel.message) {
143:       if (fingerprint === panel.lastPayload) return;
144:       try {
145:         await panel.message.edit({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } });
146:         panel.lastPayload = fingerprint;
147:         return;
148:       } catch (error) {
149:         // Only a known deleted message permits replacement. Network/permission failures
150:         // must not cause a fresh public message every time the progress timer fires.
151:         if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 10008) throw error;
152:         panel.message = undefined;
153:         panel.lastPayload = '';
154:       }
155:     }
156:     // A queue may finish while its initial send is still pending. The drain above
157:     // will disable that message, but never send a new player after the session ends.
158:     if (panel.ended || this.disposed) return;
159:     panel.message = await channel.send(payload);
160:     panel.channelId = channel.id;
161:     panel.lastPayload = fingerprint;
162:   }
163: }
````

## File: src/music/recoveryNotices.ts
````typescript
 1: import { EmbedBuilder, Message, escapeMarkdown } from 'discord.js';
 2: import { Queue, Song } from 'distube';
 3: import { RecoveryStatus } from './playbackRecovery';
 4: import { musicErrorTitle } from './errors';
 5: import { getPlaybackState } from './playbackState';
 6: 
 7: interface Notice {
 8:   latest: RecoveryStatus;
 9:   message: Message | undefined;
10:   pending: Promise<void>;
11:   running: boolean;
12:   dirty: boolean;
13:   failedWrite: boolean;
14: }
15: 
16: export function createRecoveryNotice(status: RecoveryStatus): EmbedBuilder {
17:   const title = escapeMarkdown((status.original.name || 'Canción sin título').slice(0, 160));
18:   const rawSource = (status.song.stream.playFromSource ? status.song.source : status.song.stream.song?.source) ?? status.song.source;
19:   const source = rawSource.includes('soundcloud') ? 'SoundCloud' : rawSource.includes('youtube') ? 'YouTube' : rawSource;
20:   let color = '#F0B232';
21:   let text: string;
22:   switch (status.stage) {
23:     case 'renew': text = `🔄 **Reintentando audio**\n${title}\nRenovando el enlace (${status.attempt}/2).`; break;
24:     case 'alternative': text = `🔎 **Buscando otra versión o fuente**\n${title}`; break;
25:     case 'recovered': color = '#3BA55D'; text = `✅ **Audio recuperado en ${escapeMarkdown(source)}**\n${title}`; break;
26:     case 'unconfirmed': text = `⏳ **Todavía no se ha confirmado el audio**\n${title}`; break;
27:     case 'cancelled': color = '#949BA4'; text = `⏹ **Recuperación cancelada**\n${title}\nLa sesión terminó o se cambió de canción.`; break;
28:     case 'failed': color = '#ED4245'; text = `⏭ **No pude reproducir esta canción**\n${title}\n${musicErrorTitle({ errorCode: status.code })}.\n${status.queue.songs.length ? 'Continuaré con la siguiente.' : 'No quedan canciones. Añade otra con /play.'}`; break;
29:   }
30:   const state = getPlaybackState(status.queue);
31:   if (stageBlocked(status)) text = `🛑 **Cola pausada por fallos**\n${title}\n${musicErrorTitle({ errorCode: status.code })}.\nUsa Reintentar en el reproductor o /resume. Las canciones pendientes se conservan.`;
32:   return new EmbedBuilder().setColor(color as `#${string}`).setDescription(text).setFooter({ text: `${status.code} · ${source}${state?.lastError ? ` · Ref. ${state.lastError.reference}` : ''}`.slice(0, 2048) });
33: }
34: 
35: function stageBlocked(status: RecoveryStatus): boolean { return status.stage === 'failed' && Boolean(getPlaybackState(status.queue)?.blocked); }
36: 
37: /** One small, serialized message per recovery; Discord failures do not affect audio. */
38: export class RecoveryNotices {
39:   private readonly queues = new WeakMap<Queue, WeakMap<Song, Notice>>();
40:   private disposed = false;
41: 
42:   update(status: RecoveryStatus): Promise<void> {
43:     if (this.disposed) return Promise.resolve();
44:     let songs = this.queues.get(status.queue);
45:     if (!songs) { songs = new WeakMap(); this.queues.set(status.queue, songs); }
46:     let notice = songs.get(status.original);
47:     if (!notice) {
48:       notice = { latest: status, message: undefined, pending: Promise.resolve(), running: false, dirty: false, failedWrite: false };
49:       songs.set(status.original, notice);
50:     }
51:     notice.latest = status;
52:     notice.dirty = true;
53:     if (notice.running) return notice.pending;
54:     notice.running = true;
55:     const state = notice;
56:     state.pending = state.pending.then(async () => {
57:       try {
58:         while (state.dirty && !this.disposed) {
59:           state.dirty = false;
60:           if (state.failedWrite) continue;
61:           try {
62:             const payload = { embeds: [createRecoveryNotice(state.latest)], allowedMentions: { parse: [] as const } };
63:             if (state.message) await state.message.edit(payload);
64:             else if (state.latest.stage !== 'cancelled') state.message = await state.latest.queue.textChannel?.send(payload);
65:           } catch (error) {
66:             // Do not spam replacement messages after permissions, network or deletion errors.
67:             state.failedWrite = true;
68:             console.error('[Aviso de recuperación]', error);
69:           }
70:         }
71:       } finally {
72:         // Release inside the drain, without a later Promise.finally microtask
73:         // that could strand a status arriving just after the loop finishes.
74:         state.running = false;
75:       }
76:     });
77:     return state.pending;
78:   }
79: 
80:   dispose(): void { this.disposed = true; }
81: }
````

## File: src/runtime/logger.ts
````typescript
1: interface Logger { flush(timeout?: number): Promise<void>; close(): Promise<void>; restore(): void; }
2: const { installConsole } = require('../../scripts/logger.cjs') as { installConsole(options: { name: string; maxBytes: number; backups: number }): Logger };
3: export function installLogs(name: 'bot' | 'deploy' = 'bot'): Logger {
4:   const number = (key: string, fallback: number, maximum: number) => {
5:     const value = Number(process.env[key]);
6:     return Number.isInteger(value) && value > 0 && value <= maximum ? value : fallback;
7:   };
8:   return installConsole({ name, maxBytes: number('LOG_MAX_BYTES', 10 * 1024 * 1024, 100 * 1024 * 1024), backups: number('LOG_BACKUPS', 5, 20) });
9: }
````

## File: src/utils/guard.ts
````typescript
 1: import { ButtonInteraction, ChatInputCommandInteraction, Guild, MessageFlags } from 'discord.js';
 2: import { Queue } from 'distube';
 3: 
 4: /**
 5:  * Ensures the interaction was invoked from within a guild.
 6:  * Replies with an ephemeral error and returns `null` when the guild is missing.
 7:  */
 8: export async function ensureGuild(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<Guild | null> {
 9:   if (interaction.guild) return interaction.guild;
10: 
11:   await interaction.reply({
12:     content: '❌ Este comando solo funciona dentro de un servidor.',
13:     flags: MessageFlags.Ephemeral,
14:   });
15:   return null;
16: }
17: 
18: export async function ensureControlChannel(interaction: ChatInputCommandInteraction | ButtonInteraction, queue: Queue): Promise<boolean> {
19:   const member = interaction.guild?.members.cache.get(interaction.user.id);
20:   if (member?.voice.channel?.id && member.voice.channel.id === queue.voiceChannel?.id) return true;
21:   const content = '❌ Debes estar en el mismo canal de voz que el bot.';
22:   if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
23:   else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
24:   return false;
25: }
````

## File: src/deploy-commands.ts
````typescript
 1: import 'dotenv/config';
 2: import './types';
 3: import { createHash } from 'node:crypto';
 4: import { REST, Routes } from 'discord.js';
 5: import { commands } from './commands';
 6: import { installLogs } from './runtime/logger';
 7: 
 8: async function main(): Promise<void> {
 9:   const args = process.argv.slice(2);
10:   if (args.some(arg => arg !== '--dry-run')) throw new Error('Opción no válida. Usa --dry-run para comprobar los comandos sin registrarlos.');
11:   const body = commands.map(command => command.data.toJSON());
12:   const names = body.map(command => command.name);
13:   if (new Set(names).size !== names.length) throw new Error('Hay nombres de comandos duplicados; no se registró ningún comando.');
14:   const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
15:   console.log(`Comprobados ${body.length} comandos: ${names.join(', ')}.`);
16:   console.log(`SHA-256 del registro: ${digest}`);
17:   if (args.includes('--dry-run')) {
18:     console.log('✅ Comprobación local correcta. No se contactó con Discord ni se inició el bot.');
19:     return;
20:   }
21: 
22:   // Configuration is intentionally loaded only for a real registration.
23:   const { config } = await import('./config');
24:   if (![config.clientId, config.guildId].every(id => /^\d{15,22}$/.test(id))) throw new Error('CLIENT_ID y GUILD_ID deben ser identificadores válidos de Discord.');
25:   const rest = new REST({ version: '10', timeout: 15_000, retries: 2, rejectOnRateLimit: () => true }).setToken(config.token);
26:   console.log(`Registrando ${body.length} comandos slash...`);
27:   const result = await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
28:   if (!Array.isArray(result) || result.length !== body.length || names.some(name => !result.some(command => command?.name === name))) {
29:     throw new Error('Discord devolvió un registro distinto del esperado. Revisa los comandos antes de iniciar la versión nueva.');
30:   }
31:   console.log('✅ Comandos registrados correctamente.');
32: }
33: 
34: if (require.main === module) {
35:   const logs = installLogs('deploy');
36:   void main().catch((error: unknown) => {
37:     console.error('❌ Error registrando comandos:', error);
38:     process.exitCode = 1;
39:   }).finally(() => logs.close());
40: }
````

## File: test/play-errors.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const { Song, DisTubeError } = require('distube');
 4: const { play } = require('../dist/commands/play');
 5: const { search } = require('../dist/commands/search');
 6: const searchHelper = require('../dist/utils/searchHelper');
 7: const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
 8: 
 9: function makeInteraction(plugin, query = 'la mafia del amor multiorgasmica', missingPermission) {
10:   const edits = [];
11:   const replies = [];
12:   const played = [];
13:   const member = { voice: { channel: { permissionsFor: () => ({ has: (flag) => flag !== missingPermission }) } } };
14:   const interaction = {
15:     guild: { id: 'guild-1', members: { cache: new Map([['user-1', member]]) } },
16:     user: { id: 'user-1' },
17:     client: { user: { id: 'bot-1' }, distube: { getQueue: () => undefined, plugins: [plugin], play: async (...args) => { played.push(args); } } },
18:     options: { getString: (key) => key === 'query' ? query : 'youtube' },
19:     deferred: false,
20:     deferReply: async () => { interaction.deferred = true; },
21:     editReply: async (message) => { edits.push(message); },
22:     reply: async (message) => { replies.push(message); },
23:   };
24:   return { interaction, edits, replies, played };
25: }
26: 
27: test('/play preserves the real platform error instead of reporting no results', async (t) => {
28:   t.mock.method(console, 'error', () => {});
29:   const plugin = new YtDlpSearchPlugin();
30:   plugin.searchSong = async () => { throw new Error("Sign in to confirm you're not a bot"); };
31:   const { interaction, edits, played } = makeInteraction(plugin);
32:   await play.execute(interaction);
33:   assert.match(edits.at(-1).embeds[0].data.description, /Código: `SOURCE_BLOCKED`/);
34:   assert.equal(played.length, 0);
35: });
36: 
37: test('/play reports genuinely empty results separately', async (t) => {
38:   t.mock.method(console, 'error', () => {});
39:   const plugin = new YtDlpSearchPlugin();
40:   plugin.searchSong = async () => null;
41:   const { interaction, edits, played } = makeInteraction(plugin);
42:   await play.execute(interaction);
43:   assert.match(edits.at(-1).embeds[0].data.description, /Código: `CANNOT_RESOLVE_SONG`/);
44:   assert.equal(played.length, 0);
45: });
46: 
47: test('/play passes a resolved song and its playback metadata to DisTube', async () => {
48:   const plugin = new YtDlpSearchPlugin();
49:   plugin.searchSong = async (query, options) => {
50:     assert.equal(query, 'la mafia del amor multiorgasmica');
51:     assert.equal(options.metadata.searchSource, 'youtube');
52:     return new Song({ plugin, source: 'youtube', playFromSource: true, id: 'wM6UVv8DB68', name: 'Multiorgásmica' }, options);
53:   };
54:   const { interaction, played } = makeInteraction(plugin);
55:   await play.execute(interaction);
56:   assert.ok(played[0][1] instanceof Song);
57:   assert.equal(played[0][2].metadata.searchSource, 'youtube');
58: });
59: 
60: test('/play keeps URL handling in DisTube and explains voice failures', async (t) => {
61:   t.mock.method(console, 'error', () => {});
62:   const plugin = new YtDlpSearchPlugin();
63:   plugin.searchSong = async () => assert.fail('URLs should not be searched');
64:   const url = 'https://open.spotify.com/track/test';
65:   const { interaction, edits } = makeInteraction(plugin, url);
66:   interaction.client.distube.play = async (_channel, input) => {
67:     assert.equal(input, url);
68:     throw new DisTubeError('VOICE_FULL');
69:   };
70:   await play.execute(interaction);
71:   assert.match(edits.at(-1).embeds[0].data.description, /Código: `VOICE_FULL`/);
72: });
73: 
74: test('/play and /search list only the missing voice permissions', async () => {
75:   for (const command of [play, search]) {
76:     const { interaction, replies } = makeInteraction(new YtDlpSearchPlugin(), 'query', 'Speak');
77:     await command.execute(interaction);
78:     assert.match(replies[0].embeds[0].data.description, /permisos en el canal de voz:\*\* Hablar/);
79:     assert.doesNotMatch(replies[0].embeds[0].data.description, /Conectar/);
80:     assert.equal(interaction.deferred, false);
81:   }
82: });
83: 
84: test('/search reports a failed lookup as a network error, not an empty result', async (t) => {
85:   t.mock.method(console, 'error', () => {});
86:   t.mock.method(searchHelper, 'searchSongs', async () => { throw Object.assign(new Error('network'), { code: 'ETIMEDOUT' }); });
87:   const { interaction, edits } = makeInteraction(new YtDlpSearchPlugin());
88:   await search.execute(interaction);
89:   assert.match(edits.at(-1).embeds[0].data.description, /Código: `NETWORK_TIMEOUT`/);
90: });
````

## File: test/playerPanel.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const { EventEmitter } = require('node:events');
  3: const test = require('node:test');
  4: const { MessageFlags } = require('discord.js');
  5: const { Song } = require('distube');
  6: const { PlayerPanels } = require('../dist/music/playerPanel');
  7: const { createNowPlayingEmbed, createProgressBar, createQueueEmbed, createQueueButtons } = require('../dist/utils/embed');
  8: const { handleButton } = require('../dist/events/buttonHandler');
  9: const { handleInteraction } = require('../dist/events/interactionCreate');
 10: const { nowplaying } = require('../dist/commands/nowplaying');
 11: const { queue: queueCommand } = require('../dist/commands/queue');
 12: 
 13: const tick = () => new Promise(resolve => setImmediate(resolve));
 14: const snapshot = payload => JSON.parse(JSON.stringify(payload));
 15: function song(name = 'Que Te Vas') {
 16:   return new Song({ plugin: null, source: 'youtube', playFromSource: true, id: name, name, duration: 206,
 17:     url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', thumbnail: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg' });
 18: }
 19: function fixture(t, interval = 0) {
 20:   const sends = [], edits = [], messages = [];
 21:   let editFailure;
 22:   let sendHook = async () => {};
 23:   const queue = { id: 'guild-1', songs: [song(), song('Mente Positiva')], currentTime: 78,
 24:     paused: false, volume: 80, autoplay: false, repeatMode: 0, stopped: false, voiceChannel: { id: 'voice-1' },
 25:     textChannel: { id: 'text-1', send: async payload => {
 26:       sends.push(snapshot(payload)); await sendHook();
 27:       const message = { id: `message-${messages.length + 1}`, url: `https://discord.com/channels/guild-1/text-1/${messages.length + 1}`,
 28:         edit: async payload => { edits.push({ id: message.id, payload: snapshot(payload) }); if (editFailure) throw editFailure; return message; } };
 29:       messages.push(message); return message;
 30:     } },
 31:     pause: async () => { queue.paused = true; }, resume: async () => { queue.paused = false; },
 32:   };
 33:   const distube = new EventEmitter(); distube.getQueue = () => queue;
 34:   const panels = new PlayerPanels(distube, interval);
 35:   t.after(() => panels.dispose());
 36:   return { queue, distube, panels, sends, edits, messages, setEditFailure: value => { editFailure = value; }, setSendHook: value => { sendHook = value; } };
 37: }
 38: function interaction(f, customId = 'btn_pause_resume', message = f.messages[0]) {
 39:   const replies=[], deferred=[], edits=[];
 40:   const value={ guild: { id:'guild-1', members: { cache:new Map([['user-1',{voice:{channel:{id:'voice-1'}}}]]) } },
 41:     guildId:'guild-1', client:{distube:f.distube}, user:{id:'user-1'}, member:{voice:{}}, message, customId,
 42:     reply:async payload=>{replies.push(payload);value.replied=true;},
 43:     deferReply:async payload=>{deferred.push(payload);value.deferred=true;}, deferUpdate:async()=>{value.deferred=true;},
 44:     editReply:async payload=>{edits.push(snapshot(payload));},
 45:     isRepliable:()=>true, isButton:()=>true, replied:false, deferred:false,
 46:   };
 47:   return {value,replies,deferred,edits};
 48: }
 49: 
 50: test('the player uses a large cover, progress, next track, volume and actual audio source', () => {
 51:   const current = song();
 52:   current.stream.playFromSource = false;
 53:   current.stream.song = song('audio'); current.stream.song.source = 'soundcloud';
 54:   const embed = createNowPlayingEmbed(current, 78_000, { volume:80, nextSong:song('Mente Positiva'), queued:2, autoplay:true }).toJSON();
 55:   assert.equal(embed.title, 'Que Te Vas');
 56:   assert.equal(embed.author.name, '▶ Reproduciendo');
 57:   assert.equal(embed.image.url, current.thumbnail);
 58:   assert.equal(embed.thumbnail, undefined);
 59:   assert.match(embed.description, /01:18.*03:26/);
 60:   assert.equal(embed.fields.find(field=>field.name==='Volumen').value, '80 %');
 61:   assert.match(embed.fields.find(field=>field.name==='A continuación').value, /Mente Positiva/);
 62:   assert.match(embed.footer.text, /SoundCloud · 2 en espera · Radio activada/);
 63: });
 64: 
 65: test('live streams and invalid progress values render without exceptions or negative bars', () => {
 66:   assert.match(createProgressBar(10, 0), /En vivo/);
 67:   assert.match(createProgressBar(-20, 206_000), /00:00/);
 68:   assert.match(createProgressBar(Infinity, 206_000, NaN), /00:00/);
 69:   assert.match(createProgressBar(999_000, 206_000, -1), /03:26.*03:26/);
 70:   const current=song();current.thumbnail='not-a-url';current.url='javascript:alert(1)';
 71:   const embed=createNowPlayingEmbed(current).toJSON();
 72:   assert.equal(embed.url,undefined);assert.equal(embed.image,undefined);
 73: });
 74: 
 75: test('legacy restored YouTube tracks retain a large cover without an extra lookup', () => {
 76:   const current = song(); current.thumbnail = undefined; current.id = 'AAAAAAAAAAA';
 77:   assert.equal(createNowPlayingEmbed(current).toJSON().image.url, 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg');
 78:   current.source = 'soundcloud';
 79:   assert.equal(createNowPlayingEmbed(current).toJSON().image, undefined);
 80: });
 81: 
 82: test('a metadata track without saved artwork uses the resolved audio cover', () => {
 83:   const current = song(); current.source = 'spotify'; current.thumbnail = undefined; current.stream.playFromSource = false;
 84:   const audio = song(); audio.id = 'BBBBBBBBBBB'; audio.thumbnail = undefined; current.stream.song = audio;
 85:   assert.equal(createNowPlayingEmbed(current).toJSON().image.url, 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg');
 86:   current.thumbnail = 'https://i.scdn.co/image/original-cover';
 87:   assert.equal(createNowPlayingEmbed(current).toJSON().image.url, current.thumbnail);
 88: });
 89: 
 90: test('song changes edit one player and unchanged or paused progress does not generate writes', async t => {
 91:   const f=fixture(t);await f.panels.show(f.queue);
 92:   await f.panels.refresh(f.queue);assert.equal(f.edits.length,0);
 93:   f.queue.songs.shift();f.queue.currentTime=0;await f.panels.show(f.queue);
 94:   assert.equal(f.sends.length,1);assert.equal(f.edits[0].payload.embeds[0].title,'Mente Positiva');
 95:   f.queue.paused=true;await f.panels.refresh(f.queue);await f.panels.refresh(f.queue);
 96:   assert.equal(f.edits.length,2);assert.equal(f.edits[1].payload.embeds[0].author.name,'⏸ En pausa');
 97:   assert.equal(f.edits[1].payload.components[0].components[0].label,'Reanudar');
 98:   assert.equal(f.edits[1].payload.components[0].components[1].disabled,true);
 99: });
100: 
101: test('concurrent events coalesce while the first Discord send is pending', async t => {
102:   const f=fixture(t);let release;f.setSendHook(()=>new Promise(resolve=>{release=resolve;}));
103:   const first=f.panels.show(f.queue);await tick();
104:   f.queue.songs[0]=song('Nuevo tema');
105:   const second=f.panels.show(f.queue);const third=f.panels.refresh(f.queue);
106:   release();await Promise.all([first,second,third]);
107:   assert.equal(f.sends.length,1);assert.equal(f.edits.length,1);
108:   assert.equal(f.edits[0].payload.embeds[0].title,'Nuevo tema');
109: });
110: 
111: test('ending during the first send disables the arriving message and rejects its controls', async t => {
112:   const f=fixture(t);let release;f.setSendHook(()=>new Promise(resolve=>{release=resolve;}));
113:   const first=f.panels.show(f.queue);await tick();
114:   f.queue.stopped=true;f.queue.songs=[];
115:   const closed=f.panels.close(f.queue,'✓ Cola terminada');release();await Promise.all([first,closed]);
116:   assert.equal(f.sends.length,1);
117:   assert.equal(f.edits.at(-1).payload.embeds[0].author.name,'✓ Cola terminada');
118:   assert.ok(f.edits.at(-1).payload.components[0].components.every(button=>button.disabled));
119:   assert.equal(f.panels.owns(f.queue,f.messages[0].id),false);
120: });
121: 
122: test('a replacement queue waits for old controls to be disabled and ignores late old events', async t => {
123:   const f=fixture(t);let release;f.setSendHook(()=>new Promise(resolve=>{release=resolve;}));
124:   const old=f.panels.show(f.queue);await tick();
125:   const replacement={...f.queue,songs:[song('Sesión nueva')]};
126:   const started=f.panels.show(replacement);f.setSendHook(async()=>{});release();
127:   await Promise.all([old,started]);
128:   assert.equal(f.sends.length,2);assert.ok(f.edits[0].payload.components[0].components.every(button=>button.disabled));
129:   await f.panels.close(f.queue);assert.equal(f.panels.owns(replacement,f.messages[1].id),true);
130:   assert.equal(f.panels.owns(replacement,f.messages[0].id),false);
131: });
132: 
133: test('a deleted player is replaced once and its old message loses ownership', async t => {
134:   const f=fixture(t);await f.panels.show(f.queue);const old=f.messages[0].id;
135:   f.setEditFailure({code:10008});f.queue.currentTime=99;await f.panels.refresh(f.queue);
136:   f.setEditFailure(undefined);await f.panels.refresh(f.queue);
137:   assert.equal(f.sends.length,2);assert.equal(f.panels.owns(f.queue,old),false);
138:   assert.equal(f.panels.owns(f.queue,f.messages[1].id),true);
139: });
140: 
141: test('Discord edit failures are contained, back off and never create duplicate players', async t => {
142:   t.mock.method(console,'error',()=>{});const f=fixture(t);await f.panels.show(f.queue);
143:   f.setEditFailure({code:50013});f.queue.currentTime=100;
144:   await assert.doesNotReject(f.panels.refresh(f.queue));await f.panels.refresh(f.queue);
145:   assert.equal(f.edits.length,1);assert.equal(f.sends.length,1);assert.equal(f.queue.stopped,false);
146:   await assert.doesNotReject(f.panels.close(f.queue));assert.equal(f.edits.length,2,'Closing attempts to disable controls despite the cooldown');
147: });
148: 
149: test('a failed initial send backs off instead of flooding Discord on every event', async t => {
150:   t.mock.method(console,'error',()=>{});const f=fixture(t);f.setSendHook(async()=>{throw new Error('network error');});
151:   await f.panels.show(f.queue);await f.panels.show(f.queue);await f.panels.refresh(f.queue);
152:   assert.equal(f.sends.length,1);assert.equal(f.queue.stopped,false);
153: });
154: 
155: test('the progress timer updates active players and is removed when a queue ends', async t => {
156:   const f=fixture(t,10);await f.panels.show(f.queue);f.queue.currentTime=90;
157:   for(let tries=0;tries<50 && f.edits.length===0;tries++)await new Promise(resolve=>setTimeout(resolve,10));
158:   assert.equal(f.edits.length,1);assert.match(f.edits[0].payload.embeds[0].description,/01:30/);
159:   await f.panels.close(f.queue);const count=f.edits.length;f.queue.currentTime=100;
160:   await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.edits.length,count);
161: });
162: 
163: test('obsolete buttons cannot pause the current queue and their controls are removed', async t => {
164:   const f=fixture(t);await f.panels.show(f.queue);
165:   const stale={id:'old-message',edit:async payload=>{assert.deepEqual(payload.components,[]);}};
166:   const i=interaction(f,'btn_pause_resume',stale);await handleButton(i.value);
167:   assert.equal(f.queue.paused,false);assert.match(i.replies[0].content,/sesión anterior/);
168:   assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);assert.equal(i.deferred.length,0);
169: });
170: 
171: test('current buttons acknowledge before audio work and update the same panel privately', async t => {
172:   const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
173:   f.queue.pause=async()=>{assert.equal(i.value.deferred,true);f.queue.paused=true;};
174:   await handleButton(i.value);assert.equal(i.deferred[0].flags,MessageFlags.Ephemeral);
175:   assert.equal(i.replies.length,0);assert.match(i.edits[0].content,/pausada/);
176:   assert.equal(f.edits.at(-1).payload.embeds[0].author.name,'⏸ En pausa');assert.equal(f.sends.length,1);
177: });
178: 
179: test('another voice channel cannot use the active player', async t => {
180:   const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
181:   i.value.guild.members.cache.get('user-1').voice.channel.id='voice-2';await handleButton(i.value);
182:   assert.equal(f.queue.paused,false);assert.match(i.replies[0].content,/mismo canal/);
183: });
184: 
185: test('a session replaced during interaction acknowledgement cannot stop or pause its successor', async t => {
186:   const f=fixture(t);await f.panels.show(f.queue);const old=f.queue;
187:   let mutations=0;old.stop=async()=>{mutations++;};old.pause=async()=>{mutations++;};
188:   for(const button of ['btn_stop','btn_pause_resume','btn_skip']) {
189:     f.distube.getQueue=()=>old;await f.panels.show(old);
190:     const i=interaction(f,button,f.messages.at(-1));
191:     i.value.deferReply=async()=>{
192:       i.value.deferred=true;
193:       const replacement={...old,songs:[song('Nueva sesión')]};
194:       f.distube.getQueue=()=>replacement;await f.panels.show(replacement);
195:     };
196:     await handleButton(i.value);assert.match(i.edits[0].content,/sesión terminó/);
197:   }
198:   assert.equal(mutations,0);
199: });
200: 
201: test('queue pagination respects Discord text limits and clamps after songs are removed', () => {
202:   const queue={songs:[song('Actual'),...Array.from({length:25},(_,index)=>song(`${index+1} ${'x'.repeat(500)}`))],paused:false};
203:   const embed=createQueueEmbed(queue,1).toJSON();
204:   assert.match(embed.description,/\n\n11\./);assert.ok(embed.description.length<4096);
205:   assert.match(embed.footer.text,/Página 2\/3/);
206:   const row=createQueueButtons(queue,'aaaaaaaaaaaaaaaa',1)[0].toJSON();
207:   assert.equal(row.components[0].custom_id,'queue_page:aaaaaaaaaaaaaaaa:0');
208:   queue.songs.forEach(song=>{song.name='*_[]~`'.repeat(100);});
209:   assert.ok(createQueueEmbed(queue).toJSON().description.length<4096,'Escaping Markdown must also fit the embed limit');
210:   queue.songs.length=3;
211:   assert.match(createQueueEmbed(queue,999).toJSON().footer.text,/Página 1\/1/);
212:   assert.deepEqual(createQueueButtons(queue,'aaaaaaaaaaaaaaaa',999),[]);
213: });
214: 
215: function assertUniqueComponentIds(payload) {
216:   const ids=(payload.components??[]).flatMap(row=>row.components.map(button=>button.custom_id));
217:   assert.equal(new Set(ids).size,ids.length,'Discord requires unique custom_id values, including disabled buttons');
218:   assert.ok(ids.every(id=>id.length<=100));
219: }
220: 
221: test('queue buttons have unique IDs on first, middle and last pages, even at page boundaries', () => {
222:   for(const waiting of [0,1,10,11,20,21,500]) {
223:     const queue={songs:[song(),...Array.from({length:waiting},(_,index)=>song(String(index)))]};
224:     const pages=Math.max(1,Math.ceil(waiting/10));
225:     for(const requested of [-1,0,1,pages-1,999,NaN]) {
226:       const components=createQueueButtons(queue,'aaaaaaaaaaaaaaaa',requested).map(row=>row.toJSON());
227:       assertUniqueComponentIds({components});
228:       if(pages===1) {assert.deepEqual(components,[]);continue;}
229:       const page=Number.isFinite(requested)?Math.max(0,Math.min(pages-1,requested)):0;
230:       assert.equal(components[0].components[0].disabled,page===0);
231:       assert.equal(components[0].components[1].disabled,true);
232:       assert.equal(components[0].components[2].disabled,page===pages-1);
233:     }
234:   }
235: });
236: 
237: test('opening the queue and navigating from first to last page produces Discord-valid components', async t => {
238:   const f=fixture(t);f.queue.songs.push(...Array.from({length:20},(_,index)=>song(String(index))));
239:   await f.panels.show(f.queue);
240:   const open=interaction(f,'btn_queue');
241:   open.value.editReply=async payload=>{const json=snapshot(payload);assertUniqueComponentIds(json);open.edits.push(json);};
242:   await handleButton(open.value);assert.equal(open.deferred[0].flags,MessageFlags.Ephemeral);
243:   assert.match(open.edits[0].embeds[0].footer.text,/Página 1\/3/);
244:   let payload=open.edits[0];
245:   for(const expected of [2,3]) {
246:     const next=interaction(f,payload.components[0].components[2].custom_id);
247:     next.value.editReply=async reply=>{payload=snapshot(reply);assertUniqueComponentIds(payload);};
248:     await handleButton(next.value);assert.match(payload.embeds[0].footer.text,new RegExp(`Página ${expected}/3`));
249:   }
250:   assert.equal(payload.components[0].components[2].disabled,true);
251:   f.queue.songs.length=3;
252:   const previous=interaction(f,payload.components[0].components[0].custom_id);
253:   previous.value.editReply=async reply=>{payload=snapshot(reply);assertUniqueComponentIds(payload);};
254:   await handleButton(previous.value);assert.match(payload.embeds[0].footer.text,/Página 1\/1/);
255:   assert.deepEqual(payload.components,[]);
256: });
257: 
258: test('/queue sends valid component IDs using the same pagination as the player button', async t => {
259:   const f=fixture(t);f.queue.songs.push(...Array.from({length:19},(_,index)=>song(String(index))));
260:   await f.panels.show(f.queue);const i=interaction(f);
261:   i.value.reply=async payload=>{const json=snapshot(payload);assertUniqueComponentIds(json);i.replies.push(json);};
262:   await queueCommand.execute(i.value);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);
263:   assert.match(i.replies[0].embeds[0].footer.text,/Página 1\/2/);
264: });
265: 
266: test('queue page buttons belong to their queue session and expire when that session changes', async t => {
267:   const f=fixture(t);f.queue.songs.push(...Array.from({length:20},(_,index)=>song(String(index))));await f.panels.show(f.queue);
268:   const session=f.panels.session(f.queue);
269:   const i=interaction(f,`queue_page:${session}:1`);await handleButton(i.value);
270:   assert.equal(i.value.deferred,true);assert.match(i.edits[0].embeds[0].footer.text,/Página 2\/3/);
271:   await f.panels.close(f.queue);await f.panels.show(f.queue);
272:   const stale=interaction(f,`queue_page:${session}:1`,{id:'queue-message',edit:async()=>{}});
273:   await handleButton(stale.value);assert.match(stale.replies[0].content,/sesión anterior/);
274: });
275: 
276: test('/nowplaying links to the existing player without publishing a second card', async t => {
277:   const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
278:   await nowplaying.execute(i.value);assert.equal(f.sends.length,1);
279:   assert.equal(i.deferred[0].flags,MessageFlags.Ephemeral);assert.match(i.edits[0].content,/Abrir el reproductor/);
280:   assert.equal(i.edits[0].components,undefined);
281: });
282: 
283: test('/nowplaying replaces a deleted paused player even when its progress has not changed', async t => {
284:   const f=fixture(t);f.queue.paused=true;await f.panels.show(f.queue);
285:   f.setEditFailure({code:10008});const i=interaction(f);await nowplaying.execute(i.value);
286:   assert.equal(f.sends.length,2);assert.match(i.edits[0].content,/\/2\)/);
287: });
288: 
289: test('/nowplaying handles a session ending during Discord acknowledgement', async t => {
290:   const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
291:   i.value.deferReply=async()=>{f.queue.stopped=true;f.queue.songs=[];await f.panels.close(f.queue);};
292:   await nowplaying.execute(i.value);assert.match(i.edits[0].content,/sesión terminó/);
293: });
294: 
295: test('slash pause awaits the operation and synchronizes the panel immediately', async t => {
296:   const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
297:   i.value.isButton=()=>false;i.value.isAutocomplete=()=>false;i.value.isChatInputCommand=()=>true;i.value.commandName='pause';
298:   f.queue.pause=async()=>{await tick();f.queue.paused=true;};
299:   await handleInteraction(i.value);assert.equal(f.queue.paused,true);
300:   assert.equal(f.edits.at(-1).payload.embeds[0].author.name,'⏸ En pausa');
301: });
````

## File: test/recommend.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const { Song } = require('distube');
 4: const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
 5: const { selectRecommendations } = require('../dist/commands/recommend');
 6: 
 7: function makeSong(id, source = 'youtube', url = `https://www.youtube.com/watch?v=${id}`) {
 8:   return new Song({ plugin: null, source, playFromSource: true, id, name: id, url });
 9: }
10: 
11: test('a YouTube Mix omits its seed and caches the playlist result', async () => {
12:   const plugin = new YtDlpSearchPlugin();
13:   const seed = makeSong('AAAAAAAAAAA');
14:   let calls = 0;
15:   plugin.fetchInfo = async (input, flags) => {
16:     calls += 1;
17:     assert.match(input, /list=RDAAAAAAAAAAA/);
18:     assert.equal(flags.flatPlaylist, true);
19:     assert.equal(flags.playlistEnd, 60);
20:     return { entries: [
21:       { id: seed.id, title: 'Seed' },
22:       { id: 'BBBBBBBBBBB', title: 'Another song', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB' },
23:       { id: 'BBBBBBBBBBB', title: 'Duplicate' },
24:     ] };
25:   };
26: 
27:   const [first, second] = await Promise.all([plugin.getRelatedSongs(seed), plugin.getRelatedSongs(seed)]);
28:   const third = await plugin.getRelatedSongs(seed);
29: 
30:   assert.equal(calls, 1);
31:   assert.deepEqual(first.map((song) => song.id), ['BBBBBBBBBBB']);
32:   assert.deepEqual(second.map((song) => song.id), ['BBBBBBBBBBB']);
33:   assert.deepEqual(third.map((song) => song.id), ['BBBBBBBBBBB']);
34:   assert.equal(first[0].url, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
35:   assert.equal(first[0].metadata.searchSource, 'youtube');
36: });
37: 
38: test('a non-YouTube seed is resolved before requesting a Mix', async () => {
39:   const plugin = new YtDlpSearchPlugin();
40:   const seed = makeSong('soundcloud-track', 'soundcloud', 'https://soundcloud.com/artist/track');
41:   seed.name = 'Artist Track';
42:   seed.uploader.name = 'Artist';
43:   const inputs = [];
44:   plugin.fetchInfo = async (input) => {
45:     inputs.push(input);
46:     if (input.startsWith('ytsearch5:')) {
47:       return { entries: [{ id: 'AAAAAAAAAAA', title: 'Artist Track', webpage_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' }] };
48:     }
49:     return { entries: [{ id: 'BBBBBBBBBBB', title: 'Recommended' }] };
50:   };
51: 
52:   const related = await plugin.getRelatedSongs(seed);
53:   assert.deepEqual(inputs, [
54:     'ytsearch5:Artist Track Artist',
55:     'https://www.youtube.com/watch?v=AAAAAAAAAAA&list=RDAAAAAAAAAAA',
56:   ]);
57:   assert.deepEqual(related.map((song) => song.id), ['BBBBBBBBBBB']);
58: });
59: 
60: test('manual recommendations exclude queue and history and respect amount', () => {
61:   const existing = makeSong('AAAAAAAAAAA');
62:   const byUrl = makeSong('CCCCCCCCCCC', 'youtube', 'https://www.youtube.com/watch?v=DDDDDDDDDDD');
63:   const candidates = [
64:     makeSong('AAAAAAAAAAA'),
65:     makeSong('DDDDDDDDDDD', 'youtube', byUrl.url),
66:     makeSong('BBBBBBBBBBB'),
67:     makeSong('BBBBBBBBBBB'),
68:     makeSong('EEEEEEEEEEE'),
69:   ];
70: 
71:   assert.deepEqual(
72:     selectRecommendations(candidates, [existing, byUrl], 2).map((song) => song.id),
73:     ['BBBBBBBBBBB', 'EEEEEEEEEEE'],
74:   );
75: });
````

## File: test/search.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const test = require('node:test');
  3: const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
  4: 
  5: const query = 'la mafia del amor multiorgasmica';
  6: const track = {
  7:   id: 'wM6UVv8DB68',
  8:   title: 'Multiorgásmica',
  9:   duration: 219,
 10:   extractor: 'youtube',
 11:   webpage_url: 'https://www.youtube.com/watch?v=wM6UVv8DB68',
 12: };
 13: 
 14: test('a normal YouTube result does not need a music catalog search', async () => {
 15:   const plugin = new YtDlpSearchPlugin();
 16:   const inputs = [];
 17:   plugin.fetchInfo = async (input) => {
 18:     inputs.push(input);
 19:     return { entries: [track] };
 20:   };
 21: 
 22:   const song = await plugin.searchSong(query, {});
 23:   assert.equal(song.id, track.id);
 24:   assert.deepEqual(inputs, [`ytsearch5:${query}`]);
 25: });
 26: 
 27: test('an empty YouTube search resolves through Music with metadata and shares its cache', async () => {
 28:   const plugin = new YtDlpSearchPlugin();
 29:   const inputs = [];
 30:   const metadata = { searchSource: 'youtube' };
 31:   plugin.fetchInfo = async (input, flags) => {
 32:     inputs.push(input);
 33:     if (input.startsWith('ytsearch')) return { entries: [] };
 34:     const url = new URL(input);
 35:     assert.equal(url.origin, 'https://music.youtube.com');
 36:     assert.equal(url.searchParams.get('q'), query);
 37:     assert.equal(url.hash, '#songs');
 38:     assert.equal(flags.playlistEnd, 5);
 39:     return { entries: [track] };
 40:   };
 41: 
 42:   const songs = await Promise.all([
 43:     plugin.searchSong(query, { metadata }),
 44:     plugin.searchSong(query, { metadata }),
 45:   ]);
 46:   songs.push(await plugin.searchSong(query.toUpperCase(), { metadata }));
 47: 
 48:   assert.equal(inputs.length, 2);
 49:   for (const song of songs) {
 50:     assert.equal(song.id, track.id);
 51:     assert.equal(song.name, track.title);
 52:     assert.equal(song.duration, 219);
 53:     assert.equal(song.url, track.webpage_url);
 54:     assert.equal(song.source, 'youtube');
 55:     assert.equal(song.metadata, metadata);
 56:     assert.equal(song.stream.playFromSource, true);
 57:   }
 58: });
 59: 
 60: test('Music fallback preserves special characters and explicit YouTube search prefixes', async () => {
 61:   const plugin = new YtDlpSearchPlugin();
 62:   const text = 'artista & canción #1 + remix';
 63:   plugin.fetchInfo = async (input) => {
 64:     if (input.startsWith('ytsearch')) return { entries: [] };
 65:     assert.equal(new URL(input).searchParams.get('q'), text);
 66:     return { entries: [track] };
 67:   };
 68: 
 69:   const song = await plugin.searchSong(`ytsearch1:${text}`, { metadata: { searchSource: 'soundcloud' } });
 70:   assert.equal(song.id, track.id);
 71: });
 72: 
 73: test('an empty SoundCloud search tries YouTube and Music after the preferred source', async () => {
 74:   const plugin = new YtDlpSearchPlugin();
 75:   const inputs = [];
 76:   plugin.fetchInfo = async (input) => {
 77:     inputs.push(input);
 78:     return { entries: [] };
 79:   };
 80: 
 81:   assert.equal(await plugin.searchSong(query, { metadata: { searchSource: 'soundcloud' } }), null);
 82:   assert.deepEqual(inputs, [`scsearch5:${query}`, `ytsearch5:${query}`, `https://music.youtube.com/search?q=la+mafia+del+amor+multiorgasmica#songs`]);
 83: });
 84: 
 85: test('empty results are not cached and can be retried', async () => {
 86:   const plugin = new YtDlpSearchPlugin();
 87:   let calls = 0;
 88:   plugin.fetchInfo = async () => {
 89:     calls += 1;
 90:     return { entries: [] };
 91:   };
 92: 
 93:   assert.equal(await plugin.searchSong(query, {}), null);
 94:   assert.equal(await plugin.searchSong(query, {}), null);
 95:   assert.equal(calls, 6);
 96: });
 97: 
 98: test('a failed Music lookup propagates the error and allows a later retry', async () => {
 99:   const plugin = new YtDlpSearchPlugin();
100:   const failure = new Error('yt-dlp extraction failed');
101:   plugin.fetchInfo = async (input) => {
102:     if (input.startsWith('ytsearch')) return { entries: [] };
103:     throw failure;
104:   };
105:   await assert.rejects(plugin.searchSong(query, {}), (error) => error === failure);
106: 
107:   plugin.fetchInfo = async () => ({ entries: [track] });
108:   assert.equal((await plugin.searchSong(query, {})).id, track.id);
109: });
````

## File: test/streamErrors.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const { EventEmitter } = require('node:events');
 3: const test = require('node:test');
 4: const { observeStreamErrors, getStreamDiagnostics } = require('../dist/music/streamErrors');
 5: 
 6: test('a closed stream keeps an error listener after DisTube removes its own', () => {
 7:   const stream = new EventEmitter();
 8:   const distubeListener = () => {};
 9:   stream.on('error', distubeListener);
10: 
11:   observeStreamErrors(stream);
12:   observeStreamErrors(stream);
13:   assert.equal(stream.listenerCount('error'), 2);
14: 
15:   stream.off('error', distubeListener);
16:   const error = new Error('Premature close');
17:   error.code = 'ERR_STREAM_PREMATURE_CLOSE';
18:   assert.doesNotThrow(() => stream.emit('error', error));
19:   assert.equal(stream.listenerCount('error'), 1);
20: });
21: 
22: test('an active stream error is handled once by DisTube and is not logged as late', t => {
23:   const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
24:   const stream=new EventEmitter();observeStreamErrors(stream);
25:   let handled=0;stream.on('error',()=>{handled++;});
26:   stream.emit('debug','[ffmpeg] log: HTTP error 403 Forbidden');
27:   const error=new Error('ffmpeg exited with code 3436169992');
28:   stream.emit('error',error);
29:   assert.equal(handled,1);assert.equal(logs.length,0);
30:   assert.deepEqual(getStreamDiagnostics(error),['HTTP error 403 Forbidden']);
31: });
32: 
33: test('late errors keep bounded diagnostics without signed URLs, cookies or authorization', t => {
34:   const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
35:   const stream=new EventEmitter();observeStreamErrors(stream);observeStreamErrors(stream);
36:   assert.equal(stream.listenerCount('debug'),1);
37:   stream.emit('debug','[process] spawn: ffmpeg -i https://audio.test/?token=spawn-secret');
38:   for(let index=0;index<20;index++)stream.emit('debug',`[ffmpeg] log: line ${index}`);
39:   stream.emit('debug','[ffmpeg] log: Opening https://audio.test/file?token=url-secret for reading');
40:   stream.emit('debug','[ffmpeg] log: Cookie: cookie-secret');
41:   stream.emit('debug','[ffmpeg] log: Authorization: Bearer auth-secret');
42:   stream.emit('debug',`[ffmpeg] log: ${'x'.repeat(2000)}`);
43:   const error=new Error('failed');stream.emit('error',error);
44:   const tail=getStreamDiagnostics(error);
45:   assert.equal(tail.length,12);assert.ok(tail.every(line=>line.length<=500));
46:   assert.doesNotMatch(JSON.stringify(logs),/spawn-secret|url-secret|cookie-secret|auth-secret|audio\.test/);
47:   assert.match(logs[0][0],/Error tardío/);
48:   assert.doesNotThrow(()=>stream.emit('error','non-Error payload'));
49: });
````

## File: test/supervisor.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const { execFile } = require('node:child_process');
 4: const { promisify } = require('node:util');
 5: const fs = require('node:fs');
 6: const path = require('node:path');
 7: const os = require('node:os');
 8: 
 9: function fixture(t, mode) {
10:   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-supervisor-test-'));
11:   t.after(() => {
12:     assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
13:     fs.rmSync(directory, { recursive: true, force: true });
14:   });
15:   const counter = path.join(directory, 'starts');
16:   const child = path.join(directory, 'child.cjs');
17:   const runner = path.join(directory, 'runner.cjs');
18:   const safety = require.resolve('../dist/runtime/safety');
19:   const supervisor = require.resolve('../scripts/supervise.cjs');
20:   fs.writeFileSync(child, `
21:     const fs = require('node:fs');
22:     const counter = ${JSON.stringify(counter)};
23:     const starts = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
24:     fs.writeFileSync(counter, String(starts));
25:     require(${JSON.stringify(safety)}).installProcessHandlers(code => process.exit(code));
26:     process.on('message', message => { if (message.type === 'shutdown') process.exit(0); });
27:     if (${JSON.stringify(mode)} === 'config') process.exit(78);
28:     if (${JSON.stringify(mode)} === 'duplicate') process.exit(79);
29:     if (${JSON.stringify(mode)} === 'crash' && starts === 1) setImmediate(() => { throw new Error('supervisor-fatal-marker'); });
30:     if (${JSON.stringify(mode)} !== 'hang' || starts > 1) setInterval(() => process.send?.({type:'heartbeat'}, () => {}), 20);
31:     setInterval(() => {}, 1000);
32:   `);
33:   fs.writeFileSync(runner, `
34:     const fs = require('node:fs');
35:     const controller = require(${JSON.stringify(supervisor)}).supervise({entry:${JSON.stringify(child)}, minimumDelay:20, maximumDelay:50, heartbeatTimeout:500});
36:     if (!['config','duplicate'].includes(${JSON.stringify(mode)})) {
37:       const check = setInterval(() => {
38:         const starts = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
39:         if (starts >= ${mode === 'normal' ? 1 : 2}) { clearInterval(check); controller.stop(); }
40:       }, 25);
41:     }
42:   `);
43:   return { runner, counter };
44: }
45: 
46: test('the production supervisor restarts after a real fatal exception and stops cleanly', async (t) => {
47:   const { runner, counter } = fixture(t, 'crash');
48:   const result = await promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true });
49:   assert.match(result.stderr, /supervisor-fatal-marker/);
50:   assert.match(result.stderr, /reinicio en/);
51:   assert.equal(fs.readFileSync(counter, 'utf8'), '2');
52: });
53: 
54: test('the watchdog restarts a child that stops sending heartbeats', async (t) => {
55:   const { runner, counter } = fixture(t, 'hang');
56:   const result = await promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true });
57:   assert.match(result.stderr, /dejó de responder/);
58:   assert.equal(fs.readFileSync(counter, 'utf8'), '2');
59: });
60: 
61: test('an intentional supervisor shutdown never restarts the bot', async (t) => {
62:   const { runner, counter } = fixture(t, 'normal');
63:   const result = await promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true });
64:   assert.doesNotMatch(result.stderr, /reinicio en/);
65:   assert.equal(fs.readFileSync(counter, 'utf8'), '1');
66: });
67: 
68: test('invalid configuration exits with a diagnostic instead of a restart loop', async (t) => {
69:   const { runner, counter } = fixture(t, 'config');
70:   await assert.rejects(promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true }), (error) => {
71:     assert.equal(error.code, 78);
72:     assert.match(error.stderr, /Configuración inválida/);
73:     return true;
74:   });
75:   assert.equal(fs.readFileSync(counter, 'utf8'), '1');
76: });
77: 
78: test('a duplicate instance exits without entering a supervisor restart loop', async t => {
79:   const { runner, counter } = fixture(t, 'duplicate');
80:   await assert.rejects(promisify(execFile)(process.execPath, [runner], { timeout: 10000, windowsHide: true }), error => {
81:     assert.equal(error.code, 79); assert.match(error.stderr, /otra instancia activa/);
82:     assert.doesNotMatch(error.stderr, /reinicio en/); return true;
83:   });
84:   assert.equal(fs.readFileSync(counter, 'utf8'), '1');
85: });
````

## File: tsconfig.json
````json
 1: {
 2:   "compilerOptions": {
 3:     "target": "ES2022",
 4:     "module": "commonjs",
 5:     "lib": ["ES2022"],
 6:     "outDir": "./dist",
 7:     "rootDir": "./src",
 8:     "strict": true,
 9:     "exactOptionalPropertyTypes": true,
10:     "noFallthroughCasesInSwitch": true,
11:     "noImplicitOverride": true,
12:     "noImplicitReturns": true,
13:     "noPropertyAccessFromIndexSignature": true,
14:     "noUncheckedIndexedAccess": true,
15:     "noUnusedLocals": true,
16:     "noUnusedParameters": true,
17:     "esModuleInterop": true,
18:     "skipLibCheck": true,
19:     "forceConsistentCasingInFileNames": true,
20:     "resolveJsonModule": true,
21:     "declaration": true,
22:     "declarationMap": true,
23:     "sourceMap": true
24:   },
25:   "include": ["src/**/*"],
26:   "exclude": ["node_modules", "dist"]
27: }
````

## File: scripts/supervise.cjs
````javascript
 1: 'use strict';
 2: const { fork } = require('node:child_process');
 3: const path = require('node:path');
 4: 
 5: function supervise(options = {}) {
 6:   const entry = options.entry || path.resolve(__dirname, '../dist/bootstrap.js');
 7:   const minimumDelay = options.minimumDelay ?? 1000;
 8:   const maximumDelay = options.maximumDelay ?? 30000;
 9:   const heartbeatTimeout = options.heartbeatTimeout ?? 60000;
10:   let child;
11:   let timer;
12:   let stopping = false;
13:   let failures = 0;
14:   let lastHeartbeat = Date.now();
15:   let lastStart = 0;
16: 
17:   const finish = (code) => {
18:     clearInterval(watchdog);
19:     clearTimeout(timer);
20:     process.exitCode = code;
21:   };
22: 
23:   function start() {
24:     if (stopping) return;
25:     lastHeartbeat = lastStart = Date.now();
26:     child = fork(entry, options.args || [], { execArgv: ['--no-deprecation'], windowsHide: true, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
27:     child.on('message', (message) => {
28:       if (message && message.type === 'heartbeat') lastHeartbeat = Date.now();
29:     });
30:     child.on('error', (error) => console.error('[Supervisor] No se pudo ejecutar el bot:', error));
31:     child.on('close', (code, signal) => {
32:       child = undefined;
33:       if (stopping || code === 78 || code === 79) {
34:         if (code === 78) console.error('[Supervisor] Configuración inválida; corrige el error y vuelve a iniciar.');
35:         if (code === 79) console.error('[Supervisor] Ya hay otra instancia activa; salida sin reinicio.');
36:         finish(stopping ? 0 : code);
37:         return;
38:       }
39:       if (Date.now() - lastStart > 60000) failures = 0;
40:       const wait = Math.min(maximumDelay, minimumDelay * 2 ** Math.min(failures++, 10));
41:       console.error(`[Supervisor] El bot terminó (${code ?? signal}); reinicio en ${wait} ms.`);
42:       timer = setTimeout(start, wait);
43:     });
44:   }
45: 
46:   const watchdog = setInterval(() => {
47:     if (!stopping && child && Date.now() - lastHeartbeat > heartbeatTimeout) {
48:       console.error('[Supervisor] El bot dejó de responder; reiniciando.');
49:       child.kill('SIGKILL');
50:     }
51:   }, Math.min(10000, heartbeatTimeout / 2));
52: 
53:   function stop() {
54:     if (stopping) return;
55:     stopping = true;
56:     clearTimeout(timer);
57:     if (!child) { finish(0); return; }
58:     if (child.connected) child.send({ type: 'shutdown' }, () => {});
59:     timer = setTimeout(() => child?.kill('SIGKILL'), 6000);
60:     timer.unref();
61:   }
62:   process.once('SIGINT', stop);
63:   process.once('SIGTERM', stop);
64:   start();
65:   return { stop };
66: }
67: 
68: module.exports = { supervise };
69: if (require.main === module) {
70:   require('dotenv/config');
71:   const logs = require('./logger.cjs').installConsole({ name: 'supervisor' });
72:   process.once('beforeExit', () => { void logs.close(); });
73:   supervise();
74: }
````

## File: src/commands/command.types.ts
````typescript
1: import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
2: 
3: export interface Command {
4:   data: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
5:   execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
6:   autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
7: }
````

## File: src/commands/pause.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: 
 6: export const pause: Command = {
 7:   data: new SlashCommandBuilder()
 8:     .setName('pause')
 9:     .setDescription('Pausa la canción actual') as SlashCommandBuilder,
10: 
11:   async execute(interaction) {
12:     const guild = await ensureGuild(interaction);
13:     if (!guild) return;
14: 
15:     const distube = interaction.client.distube;
16:     const queue = distube.getQueue(guild.id);
17: 
18:     if (!queue) {
19:       await interaction.reply({
20:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
21:         flags: MessageFlags.Ephemeral,
22:       });
23:       return;
24:     }
25: 
26:     if (queue.paused) {
27:       await interaction.reply({
28:         embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('⏸️ La música ya está pausada.')],
29:         flags: MessageFlags.Ephemeral,
30:       });
31:       return;
32:     }
33: 
34:     await queue.pause();
35:     await interaction.reply({
36:       embeds: [new EmbedBuilder().setColor(BotColors.Warning).setDescription('⏸️ Música pausada. Usa `/resume` para reanudar.')],
37:     });
38:   },
39: };
````

## File: src/commands/resume.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: 
 6: export const resume: Command = {
 7:   data: new SlashCommandBuilder()
 8:     .setName('resume')
 9:     .setDescription('Reanuda la canción pausada') as SlashCommandBuilder,
10: 
11:   async execute(interaction) {
12:     const guild = await ensureGuild(interaction);
13:     if (!guild) return;
14: 
15:     const distube = interaction.client.distube;
16:     const queue = distube.getQueue(guild.id);
17: 
18:     if (!queue) {
19:       await interaction.reply({
20:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
21:         flags: MessageFlags.Ephemeral,
22:       });
23:       return;
24:     }
25: 
26:     if (!queue.paused) {
27:       await interaction.reply({
28:         embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription('▶️ La música ya se está reproduciendo.')],
29:         flags: MessageFlags.Ephemeral,
30:       });
31:       return;
32:     }
33: 
34:     await queue.resume();
35:     await interaction.reply({
36:       embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription('▶️ Música reanudada.')],
37:     });
38:   },
39: };
````

## File: src/commands/search.ts
````typescript
  1: import {
  2:   ActionRowBuilder,
  3:   ComponentType,
  4:   EmbedBuilder,
  5:   GuildTextBasedChannel,
  6:   MessageFlags,
  7:   SlashCommandBuilder,
  8:   StringSelectMenuBuilder,
  9:   StringSelectMenuOptionBuilder,
 10: } from 'discord.js';
 11: import { PlayOptions } from 'distube';
 12: import { Command } from './command.types';
 13: import { PlaybackMetadata, SearchSource } from '../music/ytDlpSearchPlugin';
 14: import { ensureControlChannel, ensureGuild } from '../utils/guard';
 15: import { getPlaybackState } from '../music/playbackState';
 16: import { BotColors } from '../utils/colors';
 17: import { formatDuration } from '../utils/embed';
 18: import { searchSongs } from '../utils/searchHelper';
 19: import { fetchSearchSuggestions } from '../utils/suggestions';
 20: import { describeMusicError } from '../music/errors';
 21: 
 22: function isGuildTextChannel(channel: unknown): channel is GuildTextBasedChannel {
 23:   if (typeof channel !== 'object' || channel === null) return false;
 24:   const candidate = channel as { guild?: unknown; send?: unknown };
 25:   return candidate.guild !== undefined && typeof candidate.send === 'function';
 26: }
 27: 
 28: function parseSearchSource(value: string | null): SearchSource {
 29:   return value === 'soundcloud' ? 'soundcloud' : 'youtube';
 30: }
 31: 
 32: export const search: Command = {
 33:   data: new SlashCommandBuilder()
 34:     .setName('search')
 35:     .setDescription('Busca y selecciona entre los mejores resultados de YouTube o SoundCloud')
 36:     .addStringOption((opt) =>
 37:       opt
 38:         .setName('query')
 39:         .setDescription('Nombre de la canción o término de búsqueda')
 40:         .setRequired(true)
 41:         .setAutocomplete(true),
 42:     )
 43:     .addStringOption((opt) =>
 44:       opt
 45:         .setName('fuente')
 46:         .setDescription('Plataforma donde realizar la búsqueda')
 47:         .addChoices(
 48:           { name: 'YouTube', value: 'youtube' },
 49:           { name: 'SoundCloud', value: 'soundcloud' },
 50:         ),
 51:     ) as SlashCommandBuilder,
 52: 
 53:   async autocomplete(interaction) {
 54:     const focusedValue = interaction.options.getFocused();
 55:     if (!focusedValue || focusedValue.trim().length < 2) {
 56:       await interaction.respond([]);
 57:       return;
 58:     }
 59: 
 60:     const suggestions = await fetchSearchSuggestions(focusedValue);
 61:     await interaction.respond(
 62:       suggestions.map((s) => ({
 63:         name: s.slice(0, 100),
 64:         value: s.slice(0, 100),
 65:       })),
 66:     );
 67:   },
 68: 
 69:   async execute(interaction) {
 70:     const guild = await ensureGuild(interaction);
 71:     if (!guild) return;
 72: 
 73:     const member = guild.members.cache.get(interaction.user.id);
 74:     const voiceChannel = member?.voice.channel;
 75: 
 76:     if (!voiceChannel) {
 77:       await interaction.reply({
 78:         embeds: [
 79:           new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en un canal de voz.'),
 80:         ],
 81:         flags: MessageFlags.Ephemeral,
 82:       });
 83:       return;
 84:     }
 85: 
 86:     const permissions = voiceChannel.permissionsFor(interaction.client.user!.id);
 87:     const missingPermissions = [
 88:       { flag: 'ViewChannel', label: 'Ver canal' },
 89:       { flag: 'Connect', label: 'Conectar' },
 90:       { flag: 'Speak', label: 'Hablar' },
 91:     ] as const;
 92:     const missing = missingPermissions.filter(({ flag }) => !permissions?.has(flag));
 93:     if (missing.length > 0) {
 94:       await interaction.reply({
 95:         embeds: [
 96:           new EmbedBuilder()
 97:             .setColor(BotColors.Error)
 98:             .setDescription(`❌ **Faltan permisos en el canal de voz:** ${missing.map(({ label }) => label).join(', ')}.\n💡 Revisa el rol del bot y las excepciones de ese canal.`),
 99:         ],
100:         flags: MessageFlags.Ephemeral,
101:       });
102:       return;
103:     }
104: 
105:     const initialQueue = interaction.client.distube.getQueue?.(guild.id);
106:     if (initialQueue && !await ensureControlChannel(interaction, initialQueue)) return;
107:     const revision = initialQueue ? getPlaybackState(initialQueue)?.revision : undefined;
108:     await interaction.deferReply();
109: 
110:     const query = interaction.options.getString('query', true);
111:     const source = parseSearchSource(interaction.options.getString('fuente'));
112: 
113:     await interaction.editReply({
114:       embeds: [
115:         new EmbedBuilder()
116:           .setColor(BotColors.Gold)
117:           .setDescription(`🔍 Buscando opciones para: **${query}** en **${source === 'soundcloud' ? 'SoundCloud' : 'YouTube'}**...`),
118:       ],
119:     });
120: 
121:     let results: Awaited<ReturnType<typeof searchSongs>>;
122:     try {
123:       results = await searchSongs(query, 5, source);
124:     } catch (error) {
125:       console.error('Error buscando canciones en /search:', error);
126:       await interaction.editReply({
127:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(describeMusicError(error, { source }))],
128:       });
129:       return;
130:     }
131: 
132:     if (results.length === 0) {
133:       await interaction.editReply({
134:         embeds: [
135:           new EmbedBuilder()
136:             .setColor(BotColors.Error)
137:             .setDescription(describeMusicError({ errorCode: 'CANNOT_RESOLVE_SONG' }, { source })),
138:         ],
139:       });
140:       return;
141:     }
142: 
143:     const resultsDescription = results
144:       .map((item, index) => {
145:         const duration = item.duration ? formatDuration(item.duration * 1000) : 'Desconocida';
146:         const uploader = item.uploader ? ` • *${item.uploader}*` : '';
147:         return `**${index + 1}.** [${item.title}](${item.url})\n⏱️ \`${duration}\`${uploader}`;
148:       })
149:       .join('\n\n');
150: 
151:     const embed = new EmbedBuilder()
152:       .setColor(BotColors.Info)
153:       .setTitle(`🎵 Resultados de búsqueda: "${query}"`)
154:       .setDescription(resultsDescription)
155:       .setFooter({ text: 'Selecciona una canción del menú desplegable abajo en menos de 60 segundos.' })
156:       .setTimestamp();
157: 
158:     const selectMenu = new StringSelectMenuBuilder()
159:       .setCustomId(`search_select_${interaction.id}`)
160:       .setPlaceholder('Elige una canción para reproducir...')
161:       .addOptions(
162:         results.map((item, index) => {
163:           const duration = item.duration ? ` [${formatDuration(item.duration * 1000)}]` : '';
164:           const desc = `${item.uploader ?? 'Canción'}${duration}`.slice(0, 100);
165: 
166:           return new StringSelectMenuOptionBuilder()
167:             .setLabel(`${index + 1}. ${item.title}`.slice(0, 100))
168:             .setDescription(desc)
169:             .setValue(String(index));
170:         }),
171:       );
172: 
173:     const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
174: 
175:     const response = await interaction.editReply({
176:       embeds: [embed],
177:       components: [row],
178:     });
179: 
180:     try {
181:       const selectInteraction = await response.awaitMessageComponent({
182:         filter: (i) => i.user.id === interaction.user.id,
183:         componentType: ComponentType.StringSelect,
184:         time: 60_000,
185:       });
186: 
187:       const selectedIndex = parseInt(selectInteraction.values[0] ?? '0', 10);
188:       const selectedItem = results[selectedIndex] ?? results[0];
189: 
190:       if (!selectedItem) return;
191:       if (interaction.client.distube.getQueue?.(guild.id) !== initialQueue || initialQueue?.stopped ||
192:         (initialQueue && (getPlaybackState(initialQueue)?.revision !== revision || getPlaybackState(initialQueue)?.closing)) || member?.voice.channel?.id !== voiceChannel.id) {
193:         await selectInteraction.update({ content: 'La cola o tu canal cambió. Vuelve a buscar para elegir una canción.', embeds: [], components: [] });
194:         return;
195:       }
196: 
197:       await selectInteraction.update({
198:         embeds: [
199:           new EmbedBuilder()
200:             .setColor(BotColors.Success)
201:             .setDescription(`🎵 Seleccionaste: [**${selectedItem.title}**](${selectedItem.url})`),
202:         ],
203:         components: [],
204:       });
205: 
206:       const distube = interaction.client.distube;
207:       const playOptions: PlayOptions<PlaybackMetadata> = {
208:         member: member!,
209:         metadata: { searchSource: source },
210:       };
211:       const textChannel = isGuildTextChannel(interaction.channel) ? interaction.channel : undefined;
212:       if (textChannel) {
213:         playOptions.textChannel = textChannel;
214:       }
215: 
216:       try {
217:         await distube.play<PlaybackMetadata>(voiceChannel, selectedItem.url, playOptions);
218:       } catch (playError: unknown) {
219:         console.error('Error reproduciendo selección en /search:', playError);
220:         await interaction.followUp({
221:           embeds: [
222:             new EmbedBuilder()
223:               .setColor(BotColors.Error)
224:               .setDescription(describeMusicError(playError, { source, songName: selectedItem.title })),
225:           ],
226:           flags: MessageFlags.Ephemeral,
227:         }).catch(() => {});
228:       }
229:     } catch {
230:       // Si pasan los 60s sin interacción, quitamos el menú de selección
231:       await interaction
232:         .editReply({
233:           components: [],
234:         })
235:         .catch(() => {});
236:     }
237:   },
238: };
````

## File: src/commands/stop.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: 
 6: export const stop: Command = {
 7:   data: new SlashCommandBuilder()
 8:     .setName('stop')
 9:     .setDescription('Detiene la música y desconecta al bot del canal'),
10: 
11:   async execute(interaction) {
12:     const guild = await ensureGuild(interaction);
13:     if (!guild) return;
14: 
15:     const distube = interaction.client.distube;
16:     const queue = distube.getQueue(guild.id);
17: 
18:     if (!queue) {
19:       await interaction.reply({
20:         embeds: [
21:           new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.'),
22:         ],
23:         flags: MessageFlags.Ephemeral,
24:       });
25:       return;
26:     }
27: 
28:     await queue.stop();
29:     await interaction.reply({
30:       embeds: [
31:         new EmbedBuilder().setColor(BotColors.Error).setDescription('⏹️ Música detenida. ¡Hasta luego!'),
32:       ],
33:     });
34:   },
35: };
````

## File: src/music/distube.ts
````typescript
 1: import { DisTube, DisTubeOptions } from 'distube';
 2: import { SpotifyPlugin } from '@distube/spotify';
 3: import { Client } from 'discord.js';
 4: import ffmpeg from 'ffmpeg-static';
 5: import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';
 6: 
 7: export function createDisTube(client: Client): DisTube {
 8:   const clientId = process.env['SPOTIFY_CLIENT_ID'];
 9:   const clientSecret = process.env['SPOTIFY_CLIENT_SECRET'];
10:   const options: DisTubeOptions = {
11:     plugins: [new SpotifyPlugin(clientId && clientSecret ? { api: { clientId, clientSecret } } : {}), new YtDlpSearchPlugin()],
12:     emitNewSongOnly: true,
13:   };
14: 
15:   if (ffmpeg) {
16:     options.ffmpeg = { path: ffmpeg };
17:   }
18: 
19:   const distube = new DisTube(client, options);
20:   // DisTube defaults to one listener, but playback, persistence and empty-channel
21:   // cleanup each observe some of the same events. Keep a finite leak warning limit.
22:   distube.setMaxListeners(10);
23:   return distube;
24: }
````

## File: src/music/playbackRecovery.ts
````typescript
  1: import { Queue, Song } from 'distube';
  2: import { classifyMusicError } from './errors';
  3: import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';
  4: 
  5: const RECOVERABLE = new Set(['AUDIO_STALLED', 'FFMPEG_EXITED', 'ERR_STREAM_PREMATURE_CLOSE', 'NETWORK_ERROR', 'NETWORK_TIMEOUT', 'SOURCE_UNAVAILABLE', 'SOURCE_BLOCKED']);
  6: export type RecoveryStage = 'renew' | 'alternative' | 'recovered' | 'failed' | 'cancelled' | 'unconfirmed';
  7: export interface RecoveryStatus {
  8:   queue: Queue;
  9:   original: Song;
 10:   song: Song;
 11:   stage: RecoveryStage;
 12:   attempt: number;
 13:   code: string;
 14: }
 15: interface RecoveryState {
 16:   queue: Queue;
 17:   original: Song;
 18:   song: Song;
 19:   attempt: number;
 20:   code: string;
 21:   stage: RecoveryStage;
 22:   controller: AbortController;
 23:   timer: NodeJS.Timeout | undefined;
 24:   preparation: Promise<boolean> | undefined;
 25: }
 26: 
 27: export class PlaybackRecovery {
 28:   private readonly states = new WeakMap<Song, RecoveryState>();
 29:   private readonly started = new WeakMap<Queue, Song>();
 30:   private readonly active = new Set<RecoveryState>();
 31:   private disposed = false;
 32: 
 33:   constructor(private readonly onStatus: (status: RecoveryStatus) => void = () => {}, private readonly confirmMs = 1_000) {}
 34: 
 35:   markStarted(queue: Queue, song: Song): void {
 36:     this.started.set(queue, song);
 37:     for (const state of this.active) if (state.queue === queue && state.song !== song) this.cancel(state);
 38:     const state = this.states.get(song);
 39:     if (!state || state.queue !== queue || !['renew', 'alternative'].includes(state.stage)) return;
 40:     this.clearTimer(state);
 41:     let waiting = 0;
 42:     // playSong fires before FFmpeg's HTTP request succeeds. Confirm consumed audio.
 43:     state.timer = setInterval(() => {
 44:       if (queue.stopped || queue.songs[0] !== song || this.disposed) { this.cancel(state); return; }
 45:       if ((queue.voice?.stream?.audioResource?.playbackDuration ?? 0) > 0) {
 46:         this.clearTimer(state); this.active.delete(state); this.publish(state, 'recovered');
 47:       } else if (!queue.paused && ++waiting * this.confirmMs >= 30_000) {
 48:         this.clearTimer(state); this.publish(state, 'unconfirmed');
 49:       }
 50:     }, this.confirmMs);
 51:     state.timer.unref();
 52:   }
 53: 
 54:   retry(queue: Queue, song: Song | undefined, error: unknown, plugin: YtDlpSearchPlugin | undefined): number {
 55:     if (!song || queue.stopped || this.disposed) return 0;
 56:     const code = classifyMusicError(error);
 57:     let state = this.states.get(song);
 58:     if (!state || state.queue !== queue) {
 59:       state = { queue, original: song, song, attempt: 0, code, stage: 'renew', controller: new AbortController(), timer: undefined, preparation: undefined };
 60:       this.states.set(song, state);
 61:     }
 62:     this.clearTimer(state); state.code = code;
 63:     const playable = song.stream.playFromSource ? song : song.stream.song;
 64:     if (!plugin || !playable || playable.plugin !== plugin || !RECOVERABLE.has(code) || state.attempt >= 3 || state.controller.signal.aborted) {
 65:       this.active.delete(state); this.publish(state, 'failed'); return 0;
 66:     }
 67:     state.attempt += 1;
 68:     const position = queue.currentTime;
 69:     if (this.started.get(queue) === song && Number.isFinite(position) && position > 1 && position < song.duration - 2) queue._beginTime = Math.max(0, position - 1);
 70:     if (state.attempt <= 2) plugin.invalidateStream(song, state.attempt * 1_000);
 71:     this.active.add(state);
 72:     // DisTube shifts the failed song before emitting; reinsert before emit returns.
 73:     if (!queue.songs.includes(song)) queue.songs.unshift(song);
 74:     this.publish(state, state.attempt <= 2 ? 'renew' : 'alternative');
 75:     return state.attempt;
 76:   }
 77: 
 78:   needsAlternative(queue: Queue, song: Song): boolean {
 79:     const state = this.states.get(song);
 80:     return state?.queue === queue && state.stage === 'alternative' && state.song === state.original;
 81:   }
 82: 
 83:   alternativeFailed(queue: Queue, song: Song): boolean {
 84:     const state = this.states.get(song);
 85:     return state?.queue === queue && state.stage === 'failed';
 86:   }
 87: 
 88:   abandonCancelled(queue: Queue, song: Song): boolean {
 89:     const state = this.states.get(song);
 90:     if (!state || state.queue !== queue || state.stage !== 'cancelled' || queue.stopped || queue.songs[0] !== song) return false;
 91:     this.failAlternative(state);
 92:     return true;
 93:   }
 94: 
 95:   async prepareAlternative(queue: Queue, song: Song, plugin: YtDlpSearchPlugin): Promise<boolean> {
 96:     const state = this.states.get(song);
 97:     if (!state || !this.needsAlternative(queue, song)) return true;
 98:     if (!state.preparation) state.preparation = this.prepare(state, plugin);
 99:     return state.preparation;
100:   }
101: 
102:   private async prepare(state: RecoveryState, plugin: YtDlpSearchPlugin): Promise<boolean> {
103:     const { queue, song } = state;
104:     try {
105:       const alternative = await plugin.findAlternative(song, state.controller.signal);
106:       if (this.disposed || state.controller.signal.aborted || queue.stopped || queue.songs[0] !== song) { this.cancel(state); return false; }
107:       if (!alternative) { this.failAlternative(state); return false; }
108:       queue.songs[0] = alternative;
109:       queue._beginTime = 0;
110:       state.song = alternative;
111:       this.states.set(alternative, state);
112:       this.publish(state, 'alternative');
113:       return true;
114:     } catch (error) {
115:       if (this.disposed || state.controller.signal.aborted || queue.stopped || queue.songs[0] !== song) { this.cancel(state); return false; }
116:       console.error('[Búsqueda de alternativa]', { guildId: queue.id, code: classifyMusicError(error) });
117:       this.failAlternative(state); return false;
118:     }
119:   }
120: 
121:   private failAlternative(state: RecoveryState): void {
122:     if (state.queue.songs[0] === state.song) state.queue.songs.shift();
123:     state.queue._beginTime = 0;
124:     this.active.delete(state); this.publish(state, 'failed');
125:   }
126: 
127:   cancelQueue(queue: Queue): void {
128:     for (const state of this.active) if (state.queue === queue) this.cancel(state);
129:   }
130: 
131:   dispose(): void {
132:     this.disposed = true;
133:     for (const state of this.active) this.cancel(state);
134:   }
135: 
136:   private clearTimer(state: RecoveryState): void {
137:     if (state.timer) clearInterval(state.timer);
138:     state.timer = undefined;
139:   }
140: 
141:   private cancel(state: RecoveryState): void {
142:     if (state.stage === 'cancelled' || state.stage === 'failed') return;
143:     this.clearTimer(state); state.controller.abort(); this.active.delete(state);
144:     this.publish(state, 'cancelled');
145:   }
146: 
147:   private publish(state: RecoveryState, stage: RecoveryStage): void {
148:     state.stage = stage;
149:     const source = (state.song.stream.playFromSource ? state.song.source : state.song.stream.song?.source) ?? state.song.source;
150:     console.info('[Recuperación]', JSON.stringify({ guildId: state.queue.id, song: state.original.name, songId: state.original.id,
151:       source, attempt: state.attempt, maxAttempts: 3, code: state.code, result: stage, alternative: state.song !== state.original,
152:       ...(state.song !== state.original ? { alternativeId: state.song.id, alternativeName: state.song.name } : {}) }));
153:     try { this.onStatus({ queue: state.queue, original: state.original, song: state.song, stage, attempt: state.attempt, code: state.code }); }
154:     catch (error) { console.error('[Aviso de recuperación]', error); }
155:   }
156: }
````

## File: src/music/streamErrors.ts
````typescript
 1: import { DisTubeStream, DisTubeVoice } from 'distube';
 2: 
 3: const observedStreams = new WeakSet<DisTubeStream>();
 4: const diagnostics = new WeakMap<object, string[]>();
 5: const observedVoices = new WeakSet<DisTubeVoice>();
 6: 
 7: /** Queue.remove detaches its error listener while the voice can still receive callbacks. */
 8: export function observeVoiceErrors(voice: DisTubeVoice): void {
 9:   if (observedVoices.has(voice) || typeof voice.on !== 'function') return;
10:   observedVoices.add(voice);
11:   voice.on('error', error => {
12:     if (voice.listenerCount('error') === 1) console.error('Error tardío de voz:', error);
13:   });
14: }
15: 
16: function sanitizeAudioLog(line: string): string {
17:   return line.replace(/\b(?:authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, '[credencial omitida]')
18:     .replace(/https?:\/\/[^\s"'<>]+/gi, '[enlace de audio]')
19:     .slice(0, 500);
20: }
21: 
22: export function getStreamDiagnostics(error: unknown): readonly string[] {
23:   return typeof error === 'object' && error !== null ? diagnostics.get(error) ?? [] : [];
24: }
25: 
26: export function observeStreamErrors(stream: DisTubeStream): void {
27:   if (observedStreams.has(stream)) return;
28:   observedStreams.add(stream);
29:   const lines: string[] = [];
30:   stream.on('debug', (message: string) => {
31:     // Exclude spawn commands: they contain signed audio URLs. Keep only a small
32:     // sanitized tail of FFmpeg stderr, rather than logging every progress line.
33:     const prefix = '[ffmpeg] log: ';
34:     if (!message.startsWith(prefix)) return;
35:     lines.push(sanitizeAudioLog(message.slice(prefix.length)));
36:     if (lines.length > 12) lines.shift();
37:   });
38: 
39:   // DisTube removes its listener before killing the previous stream; pipeline errors can arrive later.
40:   stream.on('error', (error: unknown) => {
41:     if (error && typeof error === 'object') {
42:       if ('code' in error && error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
43:       diagnostics.set(error, [...lines]);
44:     }
45:     // The active stream has DisTube's own handler, which reports the same error.
46:     // This permanent listener reports only errors arriving after it was removed.
47:     if (stream.listenerCount('error') > 1) return;
48:     console.error('Error tardío del stream de audio:', error);
49:     if (lines.length) console.error('[FFmpeg]', lines.join('\n'));
50:   });
51: }
````

## File: src/utils/searchHelper.ts
````typescript
 1: import { SearchSource, YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';
 2: 
 3: export interface SearchResultItem {
 4:   title: string;
 5:   url: string;
 6:   duration?: number;
 7:   uploader?: string;
 8: }
 9: 
10: const searchPlugin = new YtDlpSearchPlugin();
11: 
12: export async function searchSongs(query: string, limit = 5, source: SearchSource = 'youtube'): Promise<SearchResultItem[]> {
13:   if (!query.trim()) return [];
14:   const songs = await searchPlugin.searchCandidates(query.trim(), limit, source);
15:   return songs.filter((song) => song.url && song.name).map((song) => ({
16:     title: song.name!, url: song.url!, duration: song.duration,
17:     ...(song.uploader.name ? { uploader: song.uploader.name } : {}),
18:   }));
19: }
````

## File: src/config.ts
````typescript
 1: import dotenv from 'dotenv';
 2: dotenv.config();
 3: 
 4: function requireEnv(key: string): string {
 5:   const value = process.env[key];
 6:   if (!value) {
 7:     throw new Error(`❌ Variable de entorno requerida no encontrada: ${key}`);
 8:   }
 9:   return value;
10: }
11: 
12: export const config = {
13:   token: requireEnv('DISCORD_TOKEN'),
14:   guildId: requireEnv('GUILD_ID'),
15:   clientId: requireEnv('CLIENT_ID'),
16: };
````

## File: test/logger.test.js
````javascript
 1: const assert = require('node:assert/strict');
 2: const test = require('node:test');
 3: const fs = require('node:fs');
 4: const os = require('node:os');
 5: const path = require('node:path');
 6: const { createLogger, redact } = require('../scripts/logger.cjs');
 7: function temporary(t) {
 8:   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-logs-'));
 9:   t.after(() => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
10:   return directory;
11: }
12: test('log rotation retains bounded valid JSON records and masks credentials', async t => {
13:   const directory = temporary(t), logger = createLogger({ directory, maxBytes: 500, backups: 2 });
14:   for (let i = 0; i < 20; i++) logger.write('error', [`${i} https://discord.com/api/webhooks/123/webhook-secret`, { token: 'token-secret', message: 'x'.repeat(100) }]);
15:   // Production close is bounded. Wait for this fixture's actual disk work before
16:   // inspecting and removing its directory, even on a busy test machine.
17:   await logger.flush(10000);
18:   await logger.close();
19:   const files = fs.readdirSync(directory); assert.ok(files.length <= 3); assert.ok(files.length > 1);
20:   for (const file of files) {
21:     const text = fs.readFileSync(path.join(directory, file), 'utf8'); assert.doesNotMatch(text, /token-secret|webhook-secret/);
22:     assert.ok(fs.statSync(path.join(directory, file)).size <= 500);
23:     for (const line of text.trim().split('\n')) assert.equal(JSON.parse(line).level, 'error');
24:   }
25: });
26: test('unwritable logging falls back once to console and keeps a bounded queue', async t => {
27:   const directory = temporary(t), file = path.join(directory, 'file'); fs.writeFileSync(file, 'occupied');
28:   const errors = [], logger = createLogger({ directory: file, maxPending: 2, report: (...args) => errors.push(args) });
29:   for (let i = 0; i < 100; i++) logger.write('error', ['test']);
30:   await logger.flush(10000); logger.write('error', ['later']); await logger.close();
31:   assert.equal(errors.length, 1); assert.ok(logger.stats().dropped >= 98); assert.equal(logger.stats().pending, 0);
32: });
33: test('sensitive headers, signed URLs and named secrets are redacted and capped', () => {
34:   for (const input of ['Cookie: session-secret', 'Authorization: Bearer auth-secret', 'https://audio.test/a?token=url-secret', 'DISCORD_TOKEN: "bot-secret"', 'client_secret=client-secret']) {
35:     assert.doesNotMatch(redact(input), /session-secret|auth-secret|url-secret|bot-secret|client-secret/);
36:   }
37:   assert.ok(redact('x'.repeat(10000)).length <= 8000);
38: });
39: 
40: test('redaction preserves ordinary bot diagnostics while hiding standalone credentials', () => {
41:   for (const input of ['[Bot Voice State] Canal: Lounge', '✅ Bot conectado como Musica#0338',
42:     'El bot todavía no puede identificar este error.', 'El bot sigue disponible.']) assert.equal(redact(input), input);
43:   for (const prefix of ['Bot', 'Bearer', 'bOt']) {
44:     assert.doesNotMatch(redact(`${prefix} real-looking.secret.token-value`), /real-looking/);
45:   }
46: });
````

## File: .gitignore
````
1: node_modules/
2: dist/
3: .env
4: cookies.json
5: data/
6: logs/
````

## File: src/commands/nowplaying.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { createNowPlayingEmbed } from '../utils/embed';
 4: import { ensureGuild } from '../utils/guard';
 5: import { BotColors } from '../utils/colors';
 6: import { getPlayerPanels } from '../music/playerPanel';
 7: 
 8: export const nowplaying: Command = {
 9:   data: new SlashCommandBuilder()
10:     .setName('nowplaying')
11:     .setDescription('Muestra la canción actual con progreso') as SlashCommandBuilder,
12: 
13:   async execute(interaction) {
14:     const guild = await ensureGuild(interaction);
15:     if (!guild) return;
16: 
17:     const distube = interaction.client.distube;
18:     const queue = distube.getQueue(guild.id);
19: 
20:     if (!queue || !queue.songs[0]) {
21:       await interaction.reply({
22:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay música reproduciéndose.')],
23:         flags: MessageFlags.Ephemeral,
24:       });
25:       return;
26:     }
27: 
28:     await interaction.deferReply({ flags: MessageFlags.Ephemeral });
29:     const panels = getPlayerPanels(distube);
30:     await panels?.show(queue, queue.songs[0], true);
31:     if (distube.getQueue(guild.id) !== queue || queue.stopped || !queue.songs[0]) {
32:       await interaction.editReply({ content: '⌛ La sesión terminó. Usa `/nowplaying` para consultar la cola actual.' });
33:       return;
34:     }
35:     const url = panels?.url(queue);
36:     await interaction.editReply(url
37:       ? { content: `🎵 [Abrir el reproductor actual](${url})` }
38:       : { embeds: [createNowPlayingEmbed(queue.songs[0], queue.currentTime * 1000, {
39:         paused: queue.paused, volume: queue.volume, nextSong: queue.songs[1], queued: queue.songs.length - 1,
40:         autoplay: queue.autoplay, repeatMode: queue.repeatMode,
41:       })] });
42:   },
43: };
````

## File: src/commands/queue.ts
````typescript
 1: import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
 2: import { Command } from './command.types';
 3: import { ensureGuild } from '../utils/guard';
 4: import { BotColors } from '../utils/colors';
 5: import { createQueueButtons, createQueueEmbed } from '../utils/embed';
 6: import { getPlayerPanels } from '../music/playerPanel';
 7: 
 8: export const queue: Command = {
 9:   data: new SlashCommandBuilder()
10:     .setName('queue')
11:     .setDescription('Muestra la lista de reproducción actual'),
12: 
13:   async execute(interaction) {
14:     const guild = await ensureGuild(interaction);
15:     if (!guild) return;
16: 
17:     const distube = interaction.client.distube;
18:     const queue = distube.getQueue(guild.id);
19: 
20:     if (!queue) {
21:       await interaction.reply({
22:         embeds: [
23:           new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay cola de reproducción.'),
24:         ],
25:         flags: MessageFlags.Ephemeral,
26:       });
27:       return;
28:     }
29: 
30:     const session = getPlayerPanels(distube)?.session(queue);
31:     await interaction.reply({ embeds: [createQueueEmbed(queue)], components: session ? createQueueButtons(queue, session) : [],
32:       flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
33:   },
34: };
````

## File: src/music/queueRecovery.ts
````typescript
  1: import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
  2: import { dirname, resolve } from 'node:path';
  3: import { Client, ChannelType } from 'discord.js';
  4: import { DisTube, Events, Playlist, Queue, Song, SongInfo } from 'distube';
  5: import { guardedEvent } from '../runtime/safety';
  6: import { getPlaybackState } from './playbackState';
  7: import { getPlaybackHealth } from './playbackHealth';
  8: import { registerCheckpoint } from './queueChanges';
  9: 
 10: interface SavedSong {
 11:   id: string;
 12:   source: string;
 13:   url: string;
 14:   name: string;
 15:   thumbnail?: string;
 16:   uploader: string;
 17:   duration: number;
 18:   ageRestricted: boolean;
 19:   playFromSource: boolean;
 20:   searchSource: 'youtube' | 'soundcloud';
 21: }
 22: 
 23: interface SavedQueue {
 24:   blocked?: boolean;
 25:   guildId: string;
 26:   voiceChannelId: string;
 27:   textChannelId?: string;
 28:   songs: SavedSong[];
 29:   position: number;
 30:   volume: number;
 31:   paused: boolean;
 32:   autoplay: boolean;
 33:   repeatMode: 0 | 1 | 2;
 34:   updatedAt: number;
 35: }
 36: 
 37: interface RestoreAttempt {
 38:   snapshot: SavedQueue;
 39:   initializing: boolean;
 40:   cancelled: boolean;
 41:   queue?: Queue;
 42: }
 43: 
 44: function publicThumbnail(value: unknown): string | undefined {
 45:   if (typeof value !== 'string' || value.length > 2_000) return undefined;
 46:   try {
 47:     const url = new URL(value);
 48:     if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url.href;
 49:   } catch { /* Artwork is optional; never persist a signed or unusable image URL. */ }
 50:   return undefined;
 51: }
 52: 
 53: function isSavedQueue(value: unknown): value is SavedQueue {
 54:   if (typeof value !== 'object' || value === null) return false;
 55:   const queue = value as SavedQueue;
 56:   const id = (value: unknown) => typeof value === 'string' && /^\d{15,22}$/.test(value);
 57:   return id(queue.guildId) && id(queue.voiceChannelId) && (queue.textChannelId === undefined || id(queue.textChannelId)) &&
 58:     (queue.blocked === undefined || typeof queue.blocked === 'boolean') &&
 59:     Number.isFinite(queue.position) && queue.position >= 0 && Number.isFinite(queue.volume) && queue.volume >= 0 && queue.volume <= 200 &&
 60:     typeof queue.paused === 'boolean' && typeof queue.autoplay === 'boolean' && [0, 1, 2].includes(queue.repeatMode) &&
 61:     Number.isFinite(queue.updatedAt) && Array.isArray(queue.songs) && queue.songs.length > 0 && queue.songs.length <= 500 &&
 62:     queue.songs.every((song) => song && typeof song.id === 'string' && typeof song.source === 'string' &&
 63:       (song.thumbnail === undefined || publicThumbnail(song.thumbnail) === song.thumbnail) &&
 64:       typeof song.name === 'string' && song.name.length <= 500 && typeof song.uploader === 'string' && song.uploader.length <= 500 &&
 65:       typeof song.url === 'string' && /^https?:\/\//i.test(song.url) &&
 66:       song.url.length <= 2_000 && Number.isFinite(song.duration) && song.duration >= 0 &&
 67:       typeof song.ageRestricted === 'boolean' && typeof song.playFromSource === 'boolean' &&
 68:       ['youtube', 'soundcloud'].includes(song.searchSource));
 69: }
 70: 
 71: export class QueueRecovery {
 72:   private readonly saved = new Map<string, SavedQueue>();
 73:   private readonly restoring = new Map<string, RestoreAttempt>();
 74:   private pendingRestore: Promise<void> | undefined;
 75:   private suspended = false;
 76:   private readonly detach: (() => void)[] = [];
 77:   private readonly unregister: () => void;
 78:   private readonly timer: ReturnType<typeof setInterval>;
 79: 
 80:   constructor(private readonly client: Client, private readonly distube: DisTube, private readonly path = resolve('data/queues.json')) {
 81:     this.unregister = registerCheckpoint(distube, queue => this.capture(queue));
 82:     this.load();
 83:     const on = (event: Events.INIT_QUEUE | Events.PLAY_SONG | Events.ADD_SONG | Events.ADD_LIST | Events.FINISH_SONG | Events.DELETE_QUEUE,
 84:       context: string, handler: (queue: Queue) => void) => {
 85:       const listener = guardedEvent(context, handler);
 86:       distube.on(event, listener);
 87:       this.detach.push(() => distube.off(event, listener));
 88:     };
 89:     on(Events.INIT_QUEUE, 'Restaurar ajustes de la cola', (queue) => {
 90:       const attempt = this.restoring.get(queue.id);
 91:       if (this.suspended || !attempt) return;
 92:       if (!attempt.initializing || attempt.queue) {
 93:         if (queue !== attempt.queue) attempt.cancelled = true;
 94:         return;
 95:       }
 96:       attempt.queue = queue;
 97:       attempt.initializing = false;
 98:       const { snapshot } = attempt;
 99:       if (snapshot.blocked) getPlaybackHealth(distube)?.restoreBlocked(queue);
100:       queue.setVolume(snapshot.volume);
101:       if (queue.repeatMode !== snapshot.repeatMode) queue.setRepeatMode(snapshot.repeatMode);
102:       if (snapshot.autoplay !== queue.autoplay) queue.toggleAutoplay();
103:     });
104:     for (const event of [Events.PLAY_SONG, Events.ADD_SONG, Events.ADD_LIST, Events.FINISH_SONG] as const) {
105:       on(event, `Guardar cola ${event}`, queue => this.capture(queue));
106:     }
107:     on(Events.DELETE_QUEUE, 'Eliminar cola guardada', (queue) => {
108:       if (this.suspended || this.restoring.get(queue.id)?.queue === queue) return;
109:       const current = distube.getQueue(queue.id);
110:       if (current && current !== queue) return;
111:       this.saved.delete(queue.id);
112:       this.write();
113:     });
114:     this.timer = setInterval(guardedEvent('Guardar progreso de colas', () => this.captureAll()), 10_000);
115:     this.timer.unref();
116:   }
117: 
118:   private load(): void {
119:     try {
120:       if (!existsSync(this.path)) return;
121:       if (statSync(this.path).size > 5_000_000) throw new Error('El archivo de colas supera el tamaño máximo');
122:       const data: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
123:       if (!Array.isArray(data)) throw new Error('Formato de colas inválido');
124:       for (const item of data.slice(0, 100)) {
125:         if (isSavedQueue(item) && Date.now() - item.updatedAt < 24 * 60 * 60 * 1_000) this.saved.set(item.guildId, item);
126:       }
127:     } catch (error) {
128:       console.error('No se pudieron leer las colas guardadas; el bot seguirá disponible:', error);
129:     }
130:   }
131: 
132:   private write(): void {
133:     if (this.suspended) return;
134:     try {
135:       mkdirSync(dirname(this.path), { recursive: true });
136:       writeFileSync(`${this.path}.tmp`, JSON.stringify([...this.saved.values()]), { mode: 0o600 });
137:       renameSync(`${this.path}.tmp`, this.path);
138:     } catch (error) {
139:       console.error('No se pudo guardar la cola; la reproducción continúa:', error);
140:     }
141:   }
142: 
143:   private capture(queue: Queue): void {
144:     if (this.suspended || this.restoring.get(queue.id)?.queue === queue || queue.stopped || !queue.voiceChannel || !queue.songs.length) return;
145:     if (this.distube.getQueue(queue.id) !== queue) return;
146:     const songs = queue.songs.slice(0, 500).flatMap((song): SavedSong[] => {
147:       if (!song.url) return [];
148:       const metadata = song.metadata as { searchSource?: unknown } | null;
149:       const thumbnail = publicThumbnail(song.thumbnail);
150:       return [{ id: song.id, source: song.source, url: song.url, name: (song.name ?? song.id).slice(0, 500),
151:         ...(thumbnail ? { thumbnail } : {}),
152:         uploader: (song.uploader.name ?? '').slice(0, 500),
153:         duration: song.duration, ageRestricted: Boolean(song.ageRestricted), playFromSource: song.stream.playFromSource,
154:         searchSource: metadata?.searchSource === 'soundcloud' ? 'soundcloud' : 'youtube' }];
155:     });
156:     if (!songs.length) return;
157:     this.saved.set(queue.id, {
158:       guildId: queue.id, voiceChannelId: queue.voiceChannel.id,
159:       blocked: Boolean(getPlaybackState(queue)?.blocked),
160:       ...(queue.textChannel ? { textChannelId: queue.textChannel.id } : {}),
161:       songs, position: queue.currentTime, volume: queue.volume, paused: queue.paused,
162:       autoplay: queue.autoplay, repeatMode: queue.repeatMode, updatedAt: Date.now(),
163:     });
164:     this.write();
165:   }
166: 
167:   private captureAll(): void {
168:     for (const queue of this.distube.queues.collection.values()) this.capture(queue);
169:   }
170: 
171:   stop(): void {
172:     if (this.suspended) return;
173:     this.unregister();
174:     clearInterval(this.timer);
175:     this.captureAll();
176:     // Discord teardown emits DELETE_QUEUE. Keep the checkpoint for the next boot.
177:     this.suspended = true;
178:     for (const detach of this.detach.splice(0)) detach();
179:   }
180: 
181:   restore(): Promise<void> {
182:     if (!this.pendingRestore) this.pendingRestore = this.restoreSaved().finally(() => { this.pendingRestore = undefined; });
183:     return this.pendingRestore;
184:   }
185: 
186:   private async restoreSaved(): Promise<void> {
187:     for (const snapshot of [...this.saved.values()]) {
188:       if (this.suspended || this.distube.getQueue(snapshot.guildId)) continue;
189:       const attempt: RestoreAttempt = { snapshot, initializing: false, cancelled: false };
190:       this.restoring.set(snapshot.guildId, attempt);
191:       const cancelled = () => this.suspended || attempt.cancelled || Boolean(this.distube.getQueue(snapshot.guildId));
192:       try {
193:         const voice = await this.client.channels.fetch(snapshot.voiceChannelId);
194:         if (cancelled()) continue;
195:         if (!voice || voice.type !== ChannelType.GuildVoice || voice.guildId !== snapshot.guildId ||
196:           !voice.members.some((member) => !member.user.bot) || !voice.joinable || !voice.speakable) {
197:           this.saved.delete(snapshot.guildId);
198:           continue;
199:         }
200:         const text = snapshot.textChannelId ? await this.client.channels.fetch(snapshot.textChannelId).catch(() => null) : null;
201:         if (cancelled()) continue;
202:         const songs: Song[] = [];
203:         for (const saved of snapshot.songs) {
204:           const plugin = await this.distube.handler._getPluginFromURL(saved.url);
205:           if (cancelled()) break;
206:           if (!plugin) continue;
207:           // Metadata-only platforms must retain their info-extractor semantics.
208:           if (!saved.playFromSource && plugin.type !== 'info-extractor') continue;
209:           const info: SongInfo = { plugin, source: saved.source, id: saved.id, name: saved.name,
210:             ...(saved.thumbnail ? { thumbnail: saved.thumbnail } : {}),
211:             url: saved.url, uploader: { name: saved.uploader }, duration: saved.duration, ageRestricted: saved.ageRestricted, playFromSource: saved.playFromSource };
212:           songs.push(new Song(info, { metadata: { searchSource: saved.searchSource } }));
213:         }
214:         if (cancelled()) continue;
215:         const first = songs[0];
216:         if (!first) {
217:           this.saved.delete(snapshot.guildId);
218:           continue;
219:         }
220:         // Add all songs before starting so an unavailable first track can be skipped.
221:         const playlist = new Playlist({ source: 'recovery', songs });
222:         attempt.initializing = true;
223:         await this.distube.play(voice, playlist, {
224:           metadata: { searchSource: snapshot.songs[0]?.searchSource ?? 'youtube' },
225:           ...(text?.isTextBased() && 'guildId' in text && text.guildId === snapshot.guildId ? { textChannel: text } : {}),
226:         });
227:         attempt.initializing = false;
228:         const queue = this.distube.getQueue(snapshot.guildId);
229:         if (this.suspended || attempt.cancelled || !queue || queue.stopped || queue !== attempt.queue) continue;
230:         queue.setVolume(snapshot.volume);
231:         // DisTube toggles an explicitly repeated mode back to Disabled.
232:         if (queue.repeatMode !== snapshot.repeatMode) queue.setRepeatMode(snapshot.repeatMode);
233:         if (snapshot.autoplay !== queue.autoplay) queue.toggleAutoplay();
234:         if (!snapshot.blocked && queue.songs[0] === first && snapshot.position > 0 && first.duration > snapshot.position + 5) await queue.seek(snapshot.position);
235:         if (this.suspended || queue.stopped || this.distube.getQueue(snapshot.guildId) !== queue) continue;
236:         if (snapshot.paused && !queue.paused) await queue.pause();
237:         console.log(`✅ Cola recuperada para ${snapshot.guildId}: ${queue.songs.length} canciones`);
238:       } catch (error) {
239:         console.error(`No se pudo recuperar la cola de ${snapshot.guildId}; el bot sigue disponible:`, error);
240:       } finally {
241:         this.restoring.delete(snapshot.guildId);
242:       }
243:     }
244:     this.captureAll();
245:     this.write();
246:   }
247: }
````

## File: src/utils/appleMusic.ts
````typescript
 1: const APPLE_MUSIC_REGEX = /^https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song|playlist)\//;
 2: 
 3: export interface AppleMusicResult {
 4:   isAppleMusic: boolean;
 5:   query: string;
 6:   title?: string;
 7:   artist?: string;
 8: }
 9: 
10: interface ITunesLookupResponse {
11:   results: ITunesTrack[];
12: }
13: 
14: interface ITunesTrack {
15:   wrapperType?: string;
16:   artistName?: string;
17:   trackName?: string;
18:   collectionName?: string;
19: }
20: 
21: function isLookupResponse(value: unknown): value is ITunesLookupResponse {
22:   return typeof value === 'object' && value !== null && Array.isArray((value as ITunesLookupResponse).results);
23: }
24: 
25: function getAppleMusicId(query: string): string | undefined {
26:   try {
27:     const url = new URL(query);
28:     const songId = url.searchParams.get('i');
29:     if (songId && /^\d{5,}$/.test(songId)) return songId;
30: 
31:     return url.pathname
32:       .split('/')
33:       .reverse()
34:       .find((segment) => /^(?:id)?\d{5,}$/.test(segment))
35:       ?.replace(/^id/, '');
36:   } catch {
37:     return undefined;
38:   }
39: }
40: 
41: export async function resolveAppleMusic(query: string): Promise<AppleMusicResult> {
42:   if (!APPLE_MUSIC_REGEX.test(query)) {
43:     return { isAppleMusic: false, query };
44:   }
45: 
46:   const id = getAppleMusicId(query);
47:   if (!id) {
48:     return { isAppleMusic: false, query };
49:   }
50: 
51:   return lookupAppleMusic(id, query);
52: }
53: 
54: async function lookupAppleMusic(id: string, originalQuery: string): Promise<AppleMusicResult> {
55:   try {
56:     const response = await fetch(`https://itunes.apple.com/lookup?id=${id}`, { signal: AbortSignal.timeout(8_000) });
57:     if (!response.ok) throw new Error(`Apple Music devolvió HTTP ${response.status}`);
58:     const data: unknown = await response.json();
59: 
60:     if (!isLookupResponse(data) || data.results.length === 0) {
61:       return { isAppleMusic: true, query: originalQuery };
62:     }
63: 
64:     const track = data.results.find((result) => result.wrapperType === 'track') ?? data.results[0];
65:     if (!track) {
66:       return { isAppleMusic: true, query: originalQuery };
67:     }
68: 
69:     const artist = track.artistName ?? '';
70:     const title = track.trackName ?? track.collectionName ?? '';
71:     const searchTerm = `${artist} ${title}`.trim();
72: 
73:     if (!searchTerm) {
74:       return { isAppleMusic: true, query: originalQuery, title, artist };
75:     }
76: 
77:     return {
78:       isAppleMusic: true,
79:       query: searchTerm,
80:       title,
81:       artist,
82:     };
83:   } catch (error) {
84:     console.error('Error resolviendo Apple Music:', error);
85:     return { isAppleMusic: true, query: originalQuery };
86:   }
87: }
````

## File: test/musicErrors.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const { EventEmitter } = require('node:events');
  3: const test = require('node:test');
  4: const { Song } = require('distube');
  5: const { describeMusicError, classifyMusicError } = require('../dist/music/errors');
  6: const { registerDisTubeEvents } = require('../dist/music/events');
  7: 
  8: test('known errors explain the cause and suggest a next step', () => {
  9:   for (const [code, text] of [
 10:     ['CANNOT_RESOLVE_SONG', /No se encontraron canciones/],
 11:     ['NO_RESULT', /La plataforma también puede haber fallado/],
 12:     ['VOICE_CONNECT_FAILED', /Anulación de región/],
 13:     ['VOICE_FULL', /límite de usuarios/],
 14:     ['VOICE_MISSING_PERMS', /Ver canal, Conectar y Hablar/],
 15:     ['VOICE_RECONNECT_FAILED', /Se perdió la conexión/],
 16:     ['NOT_SUPPORTED_URL', /Enlace no compatible/],
 17:     ['EMPTY_PLAYLIST', /playlist.*pública/],
 18:     ['EMPTY_FILTERED_PLAYLIST', /fueron filtradas/],
 19:     ['NON_NSFW', /restricción de edad/],
 20:     ['UNAVAILABLE_VIDEO', /Contenido no disponible/],
 21:     ['CANNOT_GET_STREAM_URL', /Se encontró la canción/],
 22:     ['UNPLAYABLE_FORMATS', /formato de audio compatible/],
 23:     ['FFMPEG_NOT_INSTALLED', /FFmpeg/],
 24:     ['FFMPEG_EXITED', /motor de audio se detuvo/],
 25:     ['DISCORD_INVALID_PAYLOAD', /Discord rechazó el formato/],
 26:     ['ERR_STREAM_PREMATURE_CLOSE', /audio se interrumpió/],
 27:     ['NO_EXTRACTOR_PLUGIN', /buscador de música no está configurado/],
 28:     ['NO_QUEUE', /Usa \/play/],
 29:     ['NO_UP_NEXT', /siguiente canción/],
 30:   ]) {
 31:     const result = describeMusicError({ errorCode: code });
 32:     assert.match(result, text, code);
 33:     assert.ok(result.includes(`Código: \`${code}\``), code);
 34:     assert.match(result, /💡/);
 35:   }
 36: });
 37: 
 38: test('yt-dlp messages distinguish restrictions, outages and extraction failures', () => {
 39:   for (const [message, code] of [
 40:     ["Sign in to confirm you're not a bot", 'SOURCE_BLOCKED'],
 41:     ['HTTP Error 403: Forbidden', 'SOURCE_BLOCKED'],
 42:     ['HTTP Error 429: Too Many Requests', 'SOURCE_RATE_LIMITED'],
 43:     ['Sign in to confirm your age', 'AGE_RESTRICTED'],
 44:     ['This video is private', 'PRIVATE_CONTENT'],
 45:     ['The uploader has not made this video available in your country', 'GEO_RESTRICTED'],
 46:     ['Video unavailable. This video has been removed', 'UNAVAILABLE_VIDEO'],
 47:     ['Requested format is not available', 'UNPLAYABLE_FORMATS'],
 48:     ['Unable to download API page: timed out', 'NETWORK_TIMEOUT'],
 49:     ['HTTP Error 503: Service Unavailable', 'SOURCE_UNAVAILABLE'],
 50:     ['spawn C:\\bot\\yt-dlp.exe ENOENT', 'YTDLP_NOT_FOUND'],
 51:     ['yt-dlp did not return a playable stream URL', 'CANNOT_GET_STREAM_URL'],
 52:   ]) {
 53:     assert.ok(describeMusicError(new Error(message)).includes(`Código: \`${code}\``), message);
 54:   }
 55: });
 56: 
 57: test('network and Discord codes work through nested causes', () => {
 58:   for (const [code, expected] of [
 59:     ['ETIMEDOUT', 'NETWORK_TIMEOUT'],
 60:     ['ENOTFOUND', 'NETWORK_ERROR'],
 61:     ['ECONNRESET', 'NETWORK_ERROR'],
 62:     [50013, 'DISCORD_MISSING_PERMS'],
 63:     [50035, 'DISCORD_INVALID_PAYLOAD'],
 64:   ]) {
 65:     const cause = Object.assign(new Error('Connection failed'), { code });
 66:     assert.ok(describeMusicError(new Error('fetch failed', { cause })).includes(`Código: \`${expected}\``));
 67:   }
 68: });
 69: 
 70: test('a known DisTube code is not reclassified by text in the query', () => {
 71:   const message = describeMusicError({ errorCode: 'NO_RESULT', message: 'Cannot find any song (Sign in HTTP Error 403)' });
 72:   assert.match(message, /Código: `NO_RESULT`/);
 73: });
 74: 
 75: test('FFmpeg HTTP exit tags are recognized in Windows unsigned and signed form', () => {
 76:   for(const [tag,expected] of [
 77:     [0x333034f8,'SOURCE_BLOCKED'],[0x313034f8,'PRIVATE_CONTENT'],[0x343034f8,'UNAVAILABLE_VIDEO'],
 78:     [0x393234f8,'SOURCE_RATE_LIMITED'],[0x585835f8,'SOURCE_UNAVAILABLE'],
 79:   ]) {
 80:     for(const exit of [-tag,(-tag)>>>0]) {
 81:       assert.equal(classifyMusicError({errorCode:'FFMPEG_EXITED',message:`ffmpeg exited with code ${exit}`}),expected);
 82:     }
 83:   }
 84:   assert.match(describeMusicError({errorCode:'FFMPEG_EXITED',message:'ffmpeg exited with code 3436169992'}),/HTTP 403/);
 85:   for(const message of ['ffmpeg exited with code 1','ffmpeg exited with code 9999999999999999','song ffmpeg exited with code 3436169992']) {
 86:     assert.equal(classifyMusicError({errorCode:'FFMPEG_EXITED',message}),'FFMPEG_EXITED');
 87:   }
 88:   assert.equal(classifyMusicError({errorCode:'NO_RESULT',message:'ffmpeg exited with code 3436169992'}),'NO_RESULT');
 89: });
 90: 
 91: test('unknown errors keep raw URLs, credentials and stack traces out of Discord', () => {
 92:   const error = Object.assign(new Error('https://secret.test/audio?token=hidden-token C:\\private\\file'), { errorCode: 'CUSTOM_FAILURE' });
 93:   const message = describeMusicError(error, { songName: '**song**' });
 94:   assert.match(message, /Código: `CUSTOM_FAILURE`/);
 95:   assert.ok(message.includes('\\*\\*song\\*\\*'));
 96:   assert.doesNotMatch(message, /hidden-token|secret\.test|private|at /);
 97:   assert.ok(message.length < 4096);
 98: });
 99: 
100: test('unexpected values and circular causes still get a readable error', () => {
101:   const circular = new Error('Unexpected');
102:   circular.cause = circular;
103:   for (const error of [null, undefined, 123, {}, circular, { code: '__proto__' }, { code: 'toString' }, { code: '`unsafe`' }]) {
104:     assert.match(describeMusicError(error), /Código: `UNKNOWN`/);
105:   }
106: });
107: 
108: test('empty results identify the selected search source', () => {
109:   const error = { errorCode: 'CANNOT_RESOLVE_SONG' };
110:   assert.match(describeMusicError(error, { source: 'youtube' }), /YouTube y YouTube Music/);
111:   assert.match(describeMusicError(error, { source: 'soundcloud' }), /empezando por SoundCloud/);
112: });
113: 
114: test('playback events send a classified error and identify the affected song', async (t) => {
115:   t.mock.method(console, 'error', () => {});
116:   t.mock.method(console, 'info', () => {});
117:   const distube = new EventEmitter();
118:   t.after(registerDisTubeEvents(distube));
119:   const messages = [];
120:   const queue = { songs: [], textChannel: { send: async (message) => { messages.push(message); } } };
121:   const song = new Song({ plugin: null, source: 'youtube', playFromSource: true, id: 'test', name: 'Multiorgásmica' });
122:   distube.emit('error', Object.assign(new Error('audio failed'), { errorCode: 'FFMPEG_EXITED' }), queue, song);
123:   await new Promise((resolve) => setImmediate(resolve));
124:   assert.match(messages[0].embeds[0].data.description, /Multiorgásmica/);
125:   assert.match(messages[0].embeds[0].data.footer.text, /FFMPEG_EXITED/);
126:   distube.emit('error', new Error('unknown'), {});
127: 
128:   const rejectedQueue = { textChannel: { send: async () => { throw new Error('Missing Permissions'); } } };
129:   distube.emit('error', new Error('unknown'), rejectedQueue);
130:   await new Promise((resolve) => setImmediate(resolve));
131: });
````

## File: test/queueRecovery.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const test = require('node:test');
  3: const { EventEmitter } = require('node:events');
  4: const fs = require('node:fs');
  5: const path = require('node:path');
  6: const os = require('node:os');
  7: const { Collection, ChannelType } = require('discord.js');
  8: const { Song, Queue } = require('distube');
  9: const { QueueRecovery } = require('../dist/music/queueRecovery');
 10: const { registerDisTubeEvents } = require('../dist/music/events');
 11: const { getPlaybackState } = require('../dist/music/playbackState');
 12: 
 13: const guildId = '1082065100111872170';
 14: const voiceId = '1082065100569059471';
 15: const textId = '1082065100569059472';
 16: 
 17: function workspace(t) {
 18:   const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-queue-test-'));
 19:   t.after(() => {
 20:     assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
 21:     fs.rmSync(directory, { recursive: true, force: true });
 22:   });
 23:   return path.join(directory, 'queues.json');
 24: }
 25: 
 26: function makeSong(id) {
 27:   return new Song({ plugin: null, source: 'youtube', playFromSource: true, id, name: `Song ${id}`, duration: 200,
 28:     url: `https://www.youtube.com/watch?v=${id}` }, { metadata: { searchSource: 'youtube' } });
 29: }
 30: 
 31: function distubeMock() {
 32:   const distube = new EventEmitter();
 33:   distube.queues = { collection: new Map() };
 34:   distube.getQueue = (id) => distube.queues.collection.get(id);
 35:   distube.handler = { _getPluginFromURL: async () => ({ type: 'extractor' }) };
 36:   return distube;
 37: }
 38: 
 39: function makeQueue() {
 40:   return {
 41:     id: guildId, stopped: false, voiceChannel: { id: voiceId }, textChannel: { id: textId },
 42:     songs: [makeSong('AAAAAAAAAAA'), makeSong('BBBBBBBBBBB')],
 43:     currentTime: 75, volume: 80, paused: true, autoplay: true, repeatMode: 2,
 44:     setVolume(value) { this.volume = value; },
 45:     setRepeatMode: Queue.prototype.setRepeatMode,
 46:     toggleAutoplay() { this.autoplay = !this.autoplay; },
 47:     addToQueue(songs) { this.songs.push(...songs); },
 48:     async seek(position) { this.currentTime = position; },
 49:     pause() { this.paused = true; },
 50:   };
 51: }
 52: 
 53: test('queue checkpoints preserve order and playback settings without saving stream credentials', (t) => {
 54:   const file = workspace(t);
 55:   const distube = distubeMock();
 56:   const queue = makeQueue();
 57:   queue.songs[0].stream.url = 'https://audio.test/?token=secret-stream-token';
 58:   distube.queues.collection.set(guildId, queue);
 59:   const store = new QueueRecovery({}, distube, file);
 60:   t.after(() => store.stop());
 61:   distube.queues.collection.set(guildId, queue);
 62:   distube.emit('playSong', queue, queue.songs[0]);
 63:   const data = fs.readFileSync(file, 'utf8');
 64:   const [saved] = JSON.parse(data);
 65:   assert.deepEqual(saved.songs.map((song) => song.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
 66:   assert.equal(saved.position, 75);
 67:   assert.equal(saved.volume, 80);
 68:   assert.equal(saved.paused, true);
 69:   assert.equal(saved.autoplay, true);
 70:   assert.doesNotMatch(data, /secret-stream-token/);
 71:   store.stop();
 72:   distube.emit('deleteQueue', queue);
 73:   assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
 74: });
 75: 
 76: test('manually stopped queues are removed from the recovery file', (t) => {
 77:   const file = workspace(t);
 78:   const distube = distubeMock();
 79:   const queue = makeQueue();
 80:   const store = new QueueRecovery({}, distube, file);
 81:   t.after(() => store.stop());
 82:   distube.emit('playSong', queue, queue.songs[0]);
 83:   distube.emit('deleteQueue', queue);
 84:   assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
 85: });
 86: 
 87: test('blocked checkpoints restore pending songs without requesting a stream or starting radio', async t => {
 88:   t.mock.method(console, 'log', () => {});
 89:   const file = workspace(t), original = distubeMock(), queue = makeQueue();
 90:   original.queues.collection.set(guildId, queue);
 91:   const store = new QueueRecovery({}, original, file); store.stop();
 92:   const data = JSON.parse(fs.readFileSync(file, 'utf8')); data[0].blocked = true;
 93:   fs.writeFileSync(file, JSON.stringify(data));
 94:   const distube = distubeMock(); let started = 0;
 95:   distube.queues.playSong = async () => { started++; };
 96:   const dispose = registerDisTubeEvents(distube, undefined, { interval: 0 }); t.after(dispose);
 97:   const voice = { id: voiceId, guildId, type: ChannelType.GuildVoice, joinable: true, speakable: true,
 98:     members: new Collection([['user', { user: { bot: false } }]]) };
 99:   distube.play = async (_voice, playlist) => {
100:     const restored = { ...makeQueue(), songs: playlist.songs, paused: false, voice: { play: async () => {}, pause() {} },
101:       textChannel: { id: textId, send: async () => ({ id: 'panel', edit: async () => {} }) } };
102:     restored.play = () => distube.queues.playSong(restored);
103:     distube.queues.collection.set(guildId, restored);
104:     distube.emit('initQueue', restored);
105:     await restored.play();
106:   };
107:   const restoredStore = new QueueRecovery({ channels: { fetch: async id => id === voiceId ? voice : null } }, distube, file);
108:   t.after(() => restoredStore.stop()); await restoredStore.restore();
109:   const restored = distube.getQueue(guildId);
110:   assert.equal(started, 0); assert.equal(getPlaybackState(restored).blocked, true); assert.equal(restored.paused, true);
111:   assert.deepEqual(restored.songs.map(song => song.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
112:   assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].blocked, true);
113: });
114: 
115: test('late deletion of an old queue cannot erase its successor checkpoint', t => {
116:   const file = workspace(t), distube = distubeMock(), old = makeQueue(), current = makeQueue();
117:   current.songs = [makeSong('CCCCCCCCCCC')]; distube.queues.collection.set(guildId, current);
118:   const store = new QueueRecovery({}, distube, file); t.after(() => store.stop());
119:   distube.emit('playSong', current, current.songs[0]); distube.emit('deleteQueue', old);
120:   assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
121: });
122: 
123: test('a new process restores the queue, position, pause, repeat and volume', async (t) => {
124:   const file = workspace(t);
125:   const original = distubeMock();
126:   const queue = makeQueue();
127:   original.queues.collection.set(guildId, queue);
128:   queue.songs[0].thumbnail = 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg';
129:   queue.songs[1].thumbnail = 'https://images.test/cover.jpg?token=temporary-image-secret';
130:   const oldStore = new QueueRecovery({}, original, file);
131:   oldStore.stop();
132:   const checkpoint = fs.readFileSync(file, 'utf8');
133:   assert.doesNotMatch(checkpoint, /temporary-image-secret/);
134:   assert.equal(JSON.parse(checkpoint)[0].songs[0].thumbnail, queue.songs[0].thumbnail);
135: 
136:   const distube = distubeMock();
137:   const voice = { id: voiceId, type: ChannelType.GuildVoice, guildId, joinable: true, speakable: true,
138:     members: new Collection([['user', { user: { bot: false } }]]) };
139:   const text = { id: textId, guildId, isTextBased: () => true };
140:   const client = { channels: { fetch: async (id) => id === voiceId ? voice : text } };
141:   distube.play = async (_voice, playlist, options) => {
142:     assert.equal(options.textChannel, text);
143:     const restored = { ...makeQueue(), songs: playlist.songs, volume: 50, paused: false, autoplay: false, repeatMode: 0, currentTime: 0 };
144:     distube.queues.collection.set(guildId, restored);
145:     distube.emit('initQueue', restored);
146:     assert.equal(restored.volume, 80, 'Saved volume applies before playback starts');
147:     distube.emit('playSong', restored, playlist.songs[0]);
148:   };
149:   const store = new QueueRecovery(client, distube, file);
150:   t.after(() => store.stop());
151:   await store.restore();
152:   const restored = distube.getQueue(guildId);
153:   assert.deepEqual(restored.songs.map((song) => song.id), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
154:   assert.equal(restored.currentTime, 75);
155:   assert.equal(restored.paused, true);
156:   assert.equal(restored.autoplay, true);
157:   assert.equal(restored.repeatMode, 2);
158:   assert.equal(restored.songs[0].thumbnail, queue.songs[0].thumbnail);
159:   assert.equal(restored.songs[1].thumbnail, undefined);
160:   store.stop();
161: });
162: 
163: test('restoration does not join an empty channel or replay an old checkpoint', async (t) => {
164:   const file = workspace(t);
165:   const original = distubeMock();
166:   original.queues.collection.set(guildId, makeQueue());
167:   new QueueRecovery({}, original, file).stop();
168:   const distube = distubeMock();
169:   distube.play = async () => assert.fail('An empty channel must not be joined');
170:   const client = { channels: { fetch: async () => ({ type: ChannelType.GuildVoice, guildId, members: new Collection(), joinable: true, speakable: true }) } };
171:   const store = new QueueRecovery(client, distube, file);
172:   await store.restore();
173:   store.stop();
174:   assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
175: });
176: 
177: test('corrupt checkpoints and disk write failures do not crash playback', (t) => {
178:   const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
179:   const file = workspace(t);
180:   fs.writeFileSync(file, '{invalid-json');
181:   const distube = distubeMock();
182:   const store = new QueueRecovery({}, distube, file);
183:   assert.doesNotThrow(() => store.stop());
184:   const unwritable = new QueueRecovery({}, distube, path.dirname(file));
185:   const queue = makeQueue(); distube.queues.collection.set(guildId, queue);
186:   assert.doesNotThrow(() => distube.emit('playSong', queue, queue.songs[0]));
187:   assert.doesNotThrow(() => unwritable.stop());
188:   assert.ok(errors.some(args => String(args[0]).includes('No se pudieron leer')));
189:   assert.ok(errors.some(args => String(args[0]).includes('No se pudo guardar')));
190: });
191: 
192: test('an unavailable first track does not discard the remaining restored queue', async (t) => {
193:   t.mock.method(console, 'log', () => {});
194:   const file = workspace(t);
195:   const original = distubeMock();
196:   original.queues.collection.set(guildId, makeQueue());
197:   new QueueRecovery({}, original, file).stop();
198:   const distube = distubeMock();
199:   const voice = { type: ChannelType.GuildVoice, guildId, joinable: true, speakable: true,
200:     members: new Collection([['user', { user: { bot: false } }]]) };
201:   distube.play = async (_voice, playlist) => {
202:     assert.equal(playlist.songs.length, 2, 'All saved tracks must be enqueued before playback starts');
203:     const restored = { ...makeQueue(), songs: playlist.songs.slice(1), currentTime: 0,
204:       seek: async () => assert.fail('The position of the failed first track must not be applied to its successor') };
205:     distube.queues.collection.set(guildId, restored);
206:     distube.emit('initQueue', restored);
207:   };
208:   const client = { channels: { fetch: async (id) => id === voiceId ? voice : null } };
209:   const store = new QueueRecovery(client, distube, file);
210:   await store.restore();
211:   assert.deepEqual(distube.getQueue(guildId).songs.map((song) => song.id), ['BBBBBBBBBBB']);
212:   store.stop();
213: });
214: 
215: function deferred() {
216:   let resolve;
217:   const promise = new Promise(r => { resolve = r; });
218:   return { promise, resolve };
219: }
220: 
221: function savedFixture(t) {
222:   const file = workspace(t), original = distubeMock();
223:   original.queues.collection.set(guildId, makeQueue());
224:   new QueueRecovery({}, original, file).stop();
225:   const distube = distubeMock();
226:   const voice = { id: voiceId, guildId, type: ChannelType.GuildVoice, joinable: true, speakable: true,
227:     members: new Collection([['user', { user: { bot: false } }]]) };
228:   const client = { channels: { fetch: async id => id === voiceId ? voice : null } };
229:   return { file, distube, voice, client };
230: }
231: 
232: test('late playback events cannot overwrite a successor checkpoint', t => {
233:   const file = workspace(t), distube = distubeMock(), old = makeQueue(), current = makeQueue();
234:   current.songs = [makeSong('CCCCCCCCCCC')]; distube.queues.collection.set(guildId, current);
235:   const store = new QueueRecovery({}, distube, file); t.after(() => store.stop());
236:   distube.emit('playSong', current, current.songs[0]);
237:   for (const event of ['playSong', 'addSong', 'addList', 'finishSong']) distube.emit(event, old, old.songs[0]);
238:   assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
239: });
240: 
241: test('shutdown cancels restoration waiting for a channel without deleting its checkpoint', async t => {
242:   const f = savedFixture(t), gate = deferred();
243:   f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
244:   let starts = 0; f.distube.play = async () => { starts++; };
245:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
246:   const restore = store.restore(); store.stop(); gate.resolve(f.voice); await restore;
247:   assert.equal(starts, 0);
248:   assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).length, 1);
249: });
250: 
251: test('shutdown cancels restoration waiting for a plugin', async t => {
252:   const f = savedFixture(t), entered = deferred(), gate = deferred();
253:   f.distube.handler._getPluginFromURL = async () => { entered.resolve(); return gate.promise; };
254:   let starts = 0; f.distube.play = async () => { starts++; };
255:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
256:   const restore = store.restore(); await entered.promise; store.stop(); gate.resolve({ type: 'extractor' }); await restore;
257:   assert.equal(starts, 0);
258: });
259: 
260: test('a manual session created during channel lookup keeps its own settings and songs', async t => {
261:   const f = savedFixture(t), gate = deferred();
262:   f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
263:   let starts = 0; f.distube.play = async () => { starts++; };
264:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
265:   const restore = store.restore(), current = makeQueue();
266:   current.volume = 35; current.repeatMode = 0; current.autoplay = false;
267:   current.songs = [makeSong('CCCCCCCCCCC')];
268:   f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
269:   gate.resolve(f.voice); await restore;
270:   assert.equal(starts, 0); assert.equal(current.volume, 35); assert.equal(current.repeatMode, 0);
271:   assert.equal(current.autoplay, false); assert.equal(current.songs.length, 1);
272:   assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
273: });
274: 
275: test('a successor created while restored playback finishes keeps its own settings', async t => {
276:   const f = savedFixture(t), current = makeQueue();
277:   current.volume = 35; current.repeatMode = 0; current.paused = false; current.autoplay = false;
278:   current.songs = [makeSong('CCCCCCCCCCC')];
279:   f.distube.play = async (_voice, playlist) => {
280:     const restored = { ...makeQueue(), songs: playlist.songs };
281:     f.distube.queues.collection.set(guildId, restored); f.distube.emit('initQueue', restored);
282:     restored.stopped = true;
283:     f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
284:   };
285:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop()); await store.restore();
286:   assert.equal(current.volume, 35); assert.equal(current.repeatMode, 0);
287:   assert.equal(current.paused, false); assert.equal(current.autoplay, false);
288: });
289: 
290: test('stopping recovery removes all event listeners and is idempotent', t => {
291:   const file = workspace(t), distube = distubeMock();
292:   for (let i = 0; i < 25; i++) {
293:     const store = new QueueRecovery({}, distube, file); store.stop(); store.stop();
294:     assert.equal(distube.eventNames().length, 0);
295:   }
296: });
297: 
298: test('concurrent restore requests share one startup operation', async t => {
299:   const f = savedFixture(t), gate = deferred();
300:   let lookups = 0, starts = 0;
301:   f.client.channels.fetch = async id => { if (id !== voiceId) return null; lookups++; return gate.promise; };
302:   f.distube.play = async (_voice, playlist) => {
303:     starts++;
304:     const restored = { ...makeQueue(), songs: playlist.songs };
305:     f.distube.queues.collection.set(guildId, restored); f.distube.emit('initQueue', restored);
306:   };
307:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
308:   const first = store.restore(), second = store.restore(); gate.resolve(f.voice); await Promise.all([first, second]);
309:   assert.equal(lookups, 1); assert.equal(starts, 1);
310: });
311: 
312: test('a manual session stopped during lookup is not revived by the old checkpoint', async t => {
313:   const f = savedFixture(t), gate = deferred();
314:   f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
315:   let starts = 0; f.distube.play = async () => { starts++; };
316:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
317:   const restore = store.restore(), current = makeQueue();
318:   f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
319:   f.distube.emit('playSong', current, current.songs[0]);
320:   current.stopped = true; f.distube.queues.collection.delete(guildId); f.distube.emit('deleteQueue', current);
321:   gate.resolve(f.voice); await restore;
322:   assert.equal(starts, 0); assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), []);
323: });
324: 
325: test('shutdown checkpoints a manual session even while old restoration is pending', async t => {
326:   const f = savedFixture(t), gate = deferred();
327:   f.client.channels.fetch = async id => id === voiceId ? gate.promise : null;
328:   let starts = 0; f.distube.play = async () => { starts++; };
329:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
330:   const restore = store.restore(), current = makeQueue(); current.songs = [makeSong('CCCCCCCCCCC')];
331:   f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
332:   store.stop(); gate.resolve(f.voice); await restore;
333:   assert.equal(starts, 0); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8'))[0].songs[0].id, 'CCCCCCCCCCC');
334: });
335: 
336: test('a successor created during restored seek is not paused by the old restoration', async t => {
337:   const f = savedFixture(t), entered = deferred(), gate = deferred();
338:   const current = makeQueue(); current.paused = false; current.songs = [makeSong('CCCCCCCCCCC')];
339:   let pauses = 0;
340:   f.distube.play = async (_voice, playlist) => {
341:     const restored = { ...makeQueue(), songs: playlist.songs, paused: false,
342:       seek: async () => { entered.resolve(restored); await gate.promise; }, pause: () => { pauses++; } };
343:     f.distube.queues.collection.set(guildId, restored); f.distube.emit('initQueue', restored);
344:   };
345:   const store = new QueueRecovery(f.client, f.distube, f.file); t.after(() => store.stop());
346:   const restore = store.restore(), old = await entered.promise;
347:   old.stopped = true; f.distube.queues.collection.set(guildId, current); f.distube.emit('initQueue', current);
348:   gate.resolve(); await restore;
349:   assert.equal(pauses, 0); assert.equal(current.paused, false);
350: });
````

## File: test/resilience.test.js
````javascript
  1: const assert = require('node:assert/strict');
  2: const { EventEmitter } = require('node:events');
  3: const { execFile } = require('node:child_process');
  4: const { promisify } = require('node:util');
  5: const test = require('node:test');
  6: const { Song } = require('distube');
  7: const { guardedEvent } = require('../dist/runtime/safety');
  8: const { handleInteraction } = require('../dist/events/interactionCreate');
  9: const { registerDisTubeEvents } = require('../dist/music/events');
 10: const { YtDlpSearchPlugin, rankSearchCandidates } = require('../dist/music/ytDlpSearchPlugin');
 11: const { PlaybackRecovery } = require('../dist/music/playbackRecovery');
 12: const { ExtractionPool, retryTransient, runYtDlp } = require('../dist/music/ytDlpRunner');
 13: const { registerEmptyVoice } = require('../dist/music/emptyVoice');
 14: const { PlayerPanels } = require('../dist/music/playerPanel');
 15: 
 16: const tick = () => new Promise((resolve) => setImmediate(resolve));
 17: function song(plugin, id = 'AAAAAAAAAAA') {
 18:   return new Song({ plugin, source: 'youtube', playFromSource: true, id, name: 'Artist Song', url: `https://www.youtube.com/watch?v=${id}` });
 19: }
 20: 
 21: test('event boundaries absorb synchronous throws and rejected async handlers', async (t) => {
 22:   const messages = [];
 23:   t.mock.method(console, 'error', (...args) => messages.push(args));
 24:   guardedEvent('sync', () => { throw new Error('sync error'); })();
 25:   guardedEvent('async', async () => { throw new Error('async error'); })();
 26:   await tick();
 27:   assert.equal(messages.length, 2);
 28: });
 29: 
 30: test('a failed button and a failed error reply never escape the interaction boundary', async (t) => {
 31:   t.mock.method(console, 'error', () => {});
 32:   let replies = 0;
 33:   const message = { id: 'player-1', edit: async () => {} };
 34:   const queue = { id: 'guild-1', songs: [song(null)], currentTime: 0, paused: false, voiceChannel: { id: 'voice-1' },
 35:     textChannel: { id: 'text-1', send: async () => message }, pause: async () => { throw new Error('pause failed'); } };
 36:   const distube = { getQueue: () => queue };
 37:   const panels = new PlayerPanels(distube, 0);
 38:   t.after(() => panels.dispose());
 39:   await panels.show(queue);
 40:   const interaction = {
 41:     isButton: () => true, isRepliable: () => true,
 42:     guild: { id: 'guild-1', members: { cache: new Map([['user-1', { voice: { channel: { id: 'voice-1' } } }]]) } },
 43:     client: { distube }, member: { voice: {} }, user: { id: 'user-1' }, customId: 'btn_pause_resume', message,
 44:     replied: false, deferred: false,
 45:     reply: async () => { replies += 1; throw new Error('Missing Permissions'); },
 46:     deferReply: async () => { interaction.deferred = true; },
 47:     editReply: async () => { replies += 1; throw new Error('Missing Permissions'); },
 48:   };
 49:   await assert.doesNotReject(handleInteraction(interaction));
 50:   assert.equal(replies, 1);
 51: });
 52: 
 53: for (const code of [10062, 40060]) {
 54:   for (const kind of ['button', 'command']) {
 55:     test(`an unavailable ${kind} interaction ${code} is not acknowledged a second time`, async t => {
 56:       const warnings = []; t.mock.method(console, 'warn', value => warnings.push(value));
 57:       t.mock.method(console, 'error', () => {});
 58:       let replies = 0, edits = 0;
 59:       const value = { guild: { id: 'guild-1' }, guildId: 'guild-1', client: { distube: { getQueue: () => undefined } },
 60:         customId: 'btn_queue', commandName: 'nowplaying', message: { id: 'obsolete', edit: async () => { edits++; } },
 61:         isButton: () => kind === 'button', isAutocomplete: () => false, isChatInputCommand: () => kind === 'command',
 62:         isRepliable: () => true, deferred: false, replied: false,
 63:         reply: async () => { replies++; throw Object.assign(new Error('unavailable'), { code }); } };
 64:       await assert.doesNotReject(handleInteraction(value));
 65:       assert.equal(replies, 1); assert.equal(edits, 0); assert.equal(warnings.length, 1);
 66:       assert.match(warnings[0], new RegExp(String(code)));
 67:     });
 68:   }
 69: }
 70: 
 71: test('every playback notification handles missing Discord permissions', async (t) => {
 72:   const errors = [];
 73:   t.mock.method(console, 'error', (...args) => errors.push(args));
 74:   const distube = new EventEmitter();
 75:   distube.plugins = [];
 76:   const dispose = registerDisTubeEvents(distube);
 77:   t.after(dispose);
 78:   const current = song(null);
 79:   const queue = { id: 'guild-1', voice: {}, songs: [current], textChannel: { id: 'text-1', send: async () => { throw new Error('Missing Permissions'); } } };
 80:   for (const [event, args] of [
 81:     ['playSong', [queue, current]], ['addSong', [queue, current]],
 82:     ['addList', [queue, { songs: [], name: 'List' }]], ['disconnect', [queue]],
 83:     ['noRelated', [queue]], ['error', [new Error('audio failed'), queue, current]],
 84:   ]) {
 85:     distube.emit(event, ...args);
 86:     await tick();
 87:   }
 88:   assert.equal(errors.filter(([label]) => String(label).startsWith('[DisTube') || ['[Panel de reproducción]', '[Aviso de recuperación]'].includes(label)).length, 6);
 89: });
 90: 
 91: test('streams get a permanent error observer before voice playback can fail', async (t) => {
 92:   t.mock.method(console, 'error', () => {});
 93:   const distube = new EventEmitter();
 94:   registerDisTubeEvents(distube);
 95:   const stream = new EventEmitter();
 96:   const queue = { voice: { play: async (input) => {
 97:     assert.equal(input.listenerCount('error'), 1);
 98:     throw new Error('voice startup failed');
 99:   } } };
100:   distube.emit('initQueue', queue);
101:   const protectedPlay = queue.voice.play;
102:   distube.emit('initQueue', queue);
103:   assert.equal(queue.voice.play, protectedPlay, 'Reusing a voice connection must not accumulate wrappers');
104:   await assert.rejects(queue.voice.play(stream), /voice startup failed/);
105:   assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })));
106: });
107: 
108: test('audio recovery resumes only a song that actually started playing', () => {
109:   const plugin = new YtDlpSearchPlugin();
110:   const current = song(plugin);
111:   current.duration = 200;
112:   const queue = { songs: [], stopped: false, currentTime: 120, _beginTime: 0 };
113:   const recovery = new PlaybackRecovery();
114:   recovery.retry(queue, current, { code: 'ECONNRESET' }, plugin);
115:   assert.equal(queue._beginTime, 0, 'A previous track playback time must not seek a new track');
116:   queue.songs.shift();
117:   recovery.markStarted(queue, current);
118:   recovery.retry(queue, current, { code: 'ECONNRESET' }, plugin);
119:   assert.equal(queue._beginTime, 119);
120: });
121: 
122: test('a different song by the requested artist is rejected in favor of the Music match', async () => {
123:   const plugin = new YtDlpSearchPlugin();
124:   plugin.fetchInfo = async (input) => {
125:     if (input.startsWith('ytsearch')) return { entries: [{ _type: 'url', title: 'Es de la Mafia', url: 'https://youtube.com/wrong' }] };
126:     if (input.endsWith('wrong')) return { id: 'wrong', title: 'Es de la Mafia', uploader: 'La Mafia del Amor', webpage_url: input };
127:     if (input.startsWith('https://music')) return { entries: [{ _type: 'url', title: 'Multiorgásmica', url: 'https://youtube.com/correct' }] };
128:     return { id: 'correct', title: 'Multiorgásmica', uploader: 'La Mafia del Amor', webpage_url: input };
129:   };
130:   assert.equal((await plugin.searchSong('la mafia del amor multiorgasmica', {})).id, 'correct');
131: });
132: 
133: test('an empty channel disconnect timer is cancelled when a person returns', async (t) => {
134:   const client = new EventEmitter();
135:   const distube = new EventEmitter();
136:   let humans = false;
137:   let stopped = 0;
138:   const queue = { id: 'guild', voiceChannel: { members: { some: () => humans } }, stop: async () => { stopped += 1; } };
139:   distube.getQueue = () => queue;
140:   const dispose = registerEmptyVoice(client, distube, 15);
141:   t.after(dispose);
142:   client.emit('voiceStateUpdate', {}, { guild: { id: 'guild' } });
143:   humans = true;
144:   client.emit('voiceStateUpdate', {}, { guild: { id: 'guild' } });
145:   await new Promise((resolve) => setTimeout(resolve, 30));
146:   assert.equal(stopped, 0);
147:   humans = false;
148:   client.emit('voiceStateUpdate', {}, { guild: { id: 'guild' } });
149:   await new Promise((resolve) => setTimeout(resolve, 30));
150:   assert.equal(stopped, 1);
151: });
152: 
153: test('audio recovery renews twice and offers one alternative attempt without losing the next song', () => {
154:   const plugin = new YtDlpSearchPlugin();
155:   const failed = song(plugin);
156:   const next = song(plugin, 'BBBBBBBBBBB');
157:   const queue = { stopped: false, songs: [next] };
158:   const recovery = new PlaybackRecovery();
159:   const error = { errorCode: 'FFMPEG_EXITED' };
160:   failed.stream.url = 'expired-audio';
161:   assert.equal(recovery.retry(queue, failed, error, plugin), 1);
162:   assert.equal(failed.stream.url, undefined);
163:   assert.deepEqual(queue.songs, [failed, next]);
164:   queue.songs.shift();
165:   assert.equal(recovery.retry(queue, failed, error, plugin), 2);
166:   queue.songs.shift();
167:   assert.equal(recovery.retry(queue, failed, error, plugin), 3);
168:   assert.equal(recovery.needsAlternative(queue, failed), true);
169:   queue.songs.shift();
170:   assert.equal(recovery.retry(queue, failed, error, plugin), 0);
171:   assert.deepEqual(queue.songs, [next]);
172:   recovery.dispose();
173: });
174: 
175: test('permanent failures and stopped queues are never reinserted', () => {
176:   const plugin = new YtDlpSearchPlugin();
177:   const current = song(plugin);
178:   const recovery = new PlaybackRecovery();
179:   const queue = { stopped: false, songs: [] };
180:   for (const code of ['PRIVATE_CONTENT', 'SOURCE_RATE_LIMITED', 'VOICE_MISSING_PERMS', 'FFMPEG_NOT_INSTALLED']) {
181:     assert.equal(recovery.retry(queue, current, { errorCode: code }, plugin), 0);
182:   }
183:   queue.stopped = true;
184:   assert.equal(recovery.retry(queue, current, { errorCode: 'FFMPEG_EXITED' }, plugin), 0);
185:   assert.equal(queue.songs.length, 0);
186: });
187: 
188: test('renewing a cached stream obtains a fresh URL and deduplicates concurrent requests', async () => {
189:   const plugin = new YtDlpSearchPlugin();
190:   const current = song(plugin);
191:   let calls = 0;
192:   plugin.fetchInfo = async (_input, flags) => {
193:     assert.equal(flags.noPlaylist, true);
194:     calls += 1;
195:     return { url: `https://audio.test/${calls}` };
196:   };
197:   assert.equal(await plugin.getStreamURL(current), 'https://audio.test/1');
198:   current.stream.url = 'https://audio.test/1';
199:   plugin.invalidateStream(current, 0);
200:   const results = await Promise.all([plugin.getStreamURL(current), plugin.getStreamURL(current)]);
201:   assert.deepEqual(results, ['https://audio.test/2', 'https://audio.test/2']);
202:   assert.equal(calls, 2);
203: });
204: 
205: test('search tries another candidate when the best result is unavailable', async () => {
206:   const plugin = new YtDlpSearchPlugin();
207:   const inputs = [];
208:   plugin.fetchInfo = async (input) => {
209:     inputs.push(input);
210:     if (input.startsWith('ytsearch')) return { entries: [
211:       { _type: 'url', title: 'Artist Song', url: 'https://youtube.com/first' },
212:       { _type: 'url', title: 'Artist Song audio', url: 'https://youtube.com/second' },
213:     ] };
214:     if (input.endsWith('first')) throw new Error('Video unavailable');
215:     return { id: 'BBBBBBBBBBB', extractor: 'youtube', title: 'Artist Song audio', webpage_url: input, url: 'https://audio.test/valid' };
216:   };
217:   const result = await plugin.searchSong('Artist Song', {});
218:   assert.equal(result.id, 'BBBBBBBBBBB');
219:   assert.equal(inputs.length, 3);
220:   assert.equal(await plugin.getStreamURL(result), 'https://audio.test/valid');
221:   assert.equal(inputs.length, 3);
222: });
223: 
224: test('a blocked source falls back to SoundCloud and enters a cooldown', async () => {
225:   const plugin = new YtDlpSearchPlugin();
226:   const inputs = [];
227:   plugin.fetchInfo = async (input) => {
228:     inputs.push(input);
229:     if (!input.startsWith('scsearch')) throw new Error('HTTP Error 429: Too Many Requests');
230:     return { entries: [{ id: 'sc-track', title: 'Artist Song', webpage_url: 'https://soundcloud.com/artist/song' }] };
231:   };
232:   assert.equal((await plugin.searchSong('Artist Song', {})).source, 'soundcloud');
233:   assert.equal((await plugin.searchSong('Artist Another Song', {})).source, 'soundcloud');
234:   assert.equal(inputs.filter((input) => input.startsWith('ytsearch')).length, 1);
235:   assert.equal(inputs.some((input) => input.startsWith('https://music')), false);
236: });
237: 
238: test('candidate ranking keeps the requested version ahead of unsolicited covers and remixes', () => {
239:   const candidates = [
240:     { title: 'Artist Song live cover' }, { title: 'Artist Song remix' }, { title: 'Song', uploader: 'Artist' },
241:   ];
242:   assert.equal(rankSearchCandidates('Artist Song', candidates)[0], candidates[2]);
243:   assert.equal(rankSearchCandidates('Artist Song remix', candidates)[0], candidates[1]);
244: });
245: 
246: test('transient retries are bounded and private or rate-limited content is not retried', async () => {
247:   let attempts = 0;
248:   const signal = new AbortController().signal;
249:   const waits = [];
250:   await assert.rejects(retryTransient(async () => {
251:     attempts += 1;
252:     throw Object.assign(new Error('network'), { code: 'ECONNRESET' });
253:   }, signal, 2, async (ms) => { waits.push(ms); }));
254:   assert.equal(attempts, 3);
255:   assert.deepEqual(waits, [500, 1000]);
256:   for (const message of ['This video is private', 'HTTP Error 429: Too Many Requests']) {
257:     attempts = 0;
258:     await assert.rejects(retryTransient(async () => { attempts += 1; throw new Error(message); }, signal));
259:     assert.equal(attempts, 1);
260:   }
261: });
262: 
263: test('the extraction pool limits parallel work and cancels queued operations', async () => {
264:   const pool = new ExtractionPool(1, 1);
265:   let release;
266:   const first = pool.run(() => new Promise((resolve) => { release = resolve; }), new AbortController().signal);
267:   const abort = new AbortController();
268:   const waiting = pool.run(async () => assert.fail('Cancelled work must not run'), abort.signal);
269:   await assert.rejects(pool.run(async () => {}, new AbortController().signal), { code: 'MUSIC_BUSY' });
270:   const rejected = assert.rejects(waiting);
271:   abort.abort();
272:   await rejected;
273:   release('done');
274:   assert.equal(await first, 'done');
275:   assert.equal(await pool.run(async () => 'next', new AbortController().signal), 'next');
276: });
277: 
278: test('yt-dlp cancellation kills the extraction and reports a timeout without retrying', async (t) => {
279:   const childProcess = require('node:child_process');
280:   const controller = new AbortController();
281:   let starts = 0;
282:   t.mock.method(childProcess, 'spawn', (_path, args, options) => {
283:     starts += 1;
284:     assert.ok(args.includes('--socket-timeout'));
285:     assert.equal(options.windowsHide, true);
286:     const child = new EventEmitter();
287:     child.stdout = new EventEmitter();
288:     child.stderr = new EventEmitter();
289:     options.signal.addEventListener('abort', () => {
290:       child.emit('error', Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
291:     }, { once: true });
292:     queueMicrotask(() => controller.abort());
293:     return child;
294:   });
295:   await assert.rejects(runYtDlp('test', {}, controller.signal), { code: 'ETIMEDOUT' });
296:   assert.equal(starts, 1);
297: });
298: 
299: test('uncaught exceptions and unhandled rejections exit once for supervisor recovery', async () => {
300:   const safety = require.resolve('../dist/runtime/safety');
301:   for (const trigger of ["setImmediate(() => { throw new Error('fatal-marker'); })", "Promise.reject(new Error('fatal-marker'))"]) {
302:     const script = `require(${JSON.stringify(safety)}).installProcessHandlers(code => process.exit(code)); ${trigger};`;
303:     await assert.rejects(promisify(execFile)(process.execPath, ['-e', script], { windowsHide: true, timeout: 5000 }), (error) => {
304:       assert.equal(error.code, 1);
305:       assert.match(error.stderr, /fatal-marker/);
306:       return true;
307:     });
308:   }
309: });
````

## File: src/commands/index.ts
````typescript
 1: import { play } from './play';
 2: import { skip } from './skip';
 3: import { stop } from './stop';
 4: import { queue } from './queue';
 5: import { nowplaying } from './nowplaying';
 6: import { pause } from './pause';
 7: import { resume } from './resume';
 8: import { volume } from './volume';
 9: import { shuffle } from './shuffle';
10: import { loop } from './loop';
11: import { seek } from './seek';
12: import { remove } from './remove';
13: import { search } from './search';
14: import { autoplay } from './autoplay';
15: import { recommend } from './recommend';
16: import { clear, move } from './queueManagement';
17: import { estado, historial } from './diagnostics';
18: 
19: export const commands = [play, skip, stop, queue, nowplaying, pause, resume, volume, shuffle, loop, seek, remove, search, autoplay, recommend, clear, move, estado, historial];
````

## File: src/music/errors.ts
````typescript
  1: import { escapeMarkdown } from 'discord.js';
  2: import type { SearchSource } from './ytDlpSearchPlugin';
  3: 
  4: interface MusicErrorContext {
  5:   source?: SearchSource;
  6:   songName?: string;
  7: }
  8: 
  9: interface ErrorDescription {
 10:   title: string;
 11:   detail: string;
 12:   hint: string;
 13: }
 14: 
 15: const ERROR_DESCRIPTIONS: Record<string, ErrorDescription> = {
 16:   INVALID_QUEUE_POSITION: {
 17:     title: 'Posición de cola no válida', detail: 'La posición indicada ya no existe o corresponde a la canción actual.',
 18:     hint: 'Abre /queue y usa sus posiciones: la primera canción pendiente es la 1.',
 19:   },
 20:   SESSION_CHANGED: {
 21:     title: 'La sesión de música cambió', detail: 'La cola terminó o fue reemplazada mientras esperaba la acción.',
 22:     hint: 'Abre el reproductor actual con /nowplaying y vuelve a intentarlo.',
 23:   },
 24:   CONTROL_CHANNEL_REQUIRED: {
 25:     title: 'Debes estar en el canal de voz del bot', detail: 'Tu canal de voz cambió mientras esperaba la acción.',
 26:     hint: 'Entra al mismo canal de voz que el bot para controlar la música.',
 27:   },
 28:   QUEUE_BLOCKED: {
 29:     title: 'La cola está pausada por fallos', detail: 'Varias canciones agotaron su recuperación; las pendientes se conservan.',
 30:     hint: 'Usa Reintentar o /resume para hacer una prueba, o Detener para cerrar la sesión.',
 31:   },
 32:   AUDIO_STALLED: {
 33:     title: 'El audio dejó de avanzar', detail: 'No llegaron nuevos frames de audio dentro del tiempo permitido.',
 34:     hint: 'El bot intentará recuperar la fuente dentro del límite de reintentos.',
 35:   },
 36:   MUSIC_BUSY: {
 37:     title: 'El buscador está ocupado',
 38:     detail: 'Hay demasiadas consultas de música pendientes.',
 39:     hint: 'Espera unos segundos antes de volver a intentar.',
 40:   },
 41:   CANNOT_RESOLVE_SONG: {
 42:     title: 'No se encontraron canciones',
 43:     detail: 'La búsqueda no devolvió resultados en la fuente seleccionada.',
 44:     hint: 'Prueba con artista y título, pega un enlace directo o cambia la opción fuente.',
 45:   },
 46:   NO_RESULT: {
 47:     title: 'No se pudo resolver la canción',
 48:     detail: 'No fue posible encontrar o consultar una versión reproducible. La plataforma también puede haber fallado al responder.',
 49:     hint: 'Prueba un enlace directo o una fuente diferente. Si se repite, revisa el error completo en la consola.',
 50:   },
 51:   NOT_SUPPORTED_URL: {
 52:     title: 'Enlace no compatible',
 53:     detail: 'El bot no tiene un extractor compatible con ese enlace.',
 54:     hint: 'Usa un enlace de una canción o playlist de YouTube, SoundCloud, Spotify o Apple Music.',
 55:   },
 56:   UNAVAILABLE_VIDEO: {
 57:     title: 'Contenido no disponible',
 58:     detail: 'La plataforma no permite acceder a esta canción o video.',
 59:     hint: 'Comprueba que el enlace abra sin iniciar sesión o prueba otra versión de la canción.',
 60:   },
 61:   PRIVATE_CONTENT: {
 62:     title: 'Contenido privado o que requiere iniciar sesión',
 63:     detail: 'El bot no puede acceder a este contenido con su sesión actual.',
 64:     hint: 'Usa un enlace público que se pueda abrir sin iniciar sesión.',
 65:   },
 66:   AGE_RESTRICTED: {
 67:     title: 'Contenido con restricción de edad',
 68:     detail: 'La plataforma exige verificar la edad para acceder a este contenido.',
 69:     hint: 'Prueba otra versión pública de la canción sin esa restricción.',
 70:   },
 71:   NON_NSFW: {
 72:     title: 'Contenido restringido en este canal',
 73:     detail: 'DisTube bloqueó una canción con restricción de edad en un canal de texto sin esa clasificación.',
 74:     hint: 'Prueba otra versión de la canción sin restricción de edad.',
 75:   },
 76:   GEO_RESTRICTED: {
 77:     title: 'Contenido bloqueado por región',
 78:     detail: 'La canción no está disponible desde la región donde se ejecuta el bot.',
 79:     hint: 'Prueba otra publicación de la canción o una fuente diferente.',
 80:   },
 81:   SOURCE_RATE_LIMITED: {
 82:     title: 'La plataforma está limitando las solicitudes',
 83:     detail: 'El servicio rechazó temporalmente más consultas (HTTP 429).',
 84:     hint: 'Espera unos minutos antes de volver a intentar o usa otra fuente.',
 85:   },
 86:   SOURCE_BLOCKED: {
 87:     title: 'La plataforma rechazó el acceso',
 88:     detail: 'El servidor devolvió HTTP 403 o pidió comprobar que la solicitud no viene de un bot.',
 89:     hint: 'Prueba otra fuente. Si persiste, quien administra el bot debe revisar yt-dlp y el acceso a la plataforma.',
 90:   },
 91:   SOURCE_UNAVAILABLE: {
 92:     title: 'La plataforma no está respondiendo correctamente',
 93:     detail: 'El servicio devolvió un error de servidor (HTTP 5xx).',
 94:     hint: 'Inténtalo más tarde o usa otra fuente.',
 95:   },
 96:   NETWORK_TIMEOUT: {
 97:     title: 'Se agotó el tiempo de espera',
 98:     detail: 'La consulta o descarga de audio tardó demasiado en responder.',
 99:     hint: 'Vuelve a intentarlo. Si se repite, revisa la conexión a Internet del equipo donde corre el bot.',
100:   },
101:   NETWORK_ERROR: {
102:     title: 'No se pudo contactar con la plataforma',
103:     detail: 'Falló la conexión de red o la resolución del nombre del servidor.',
104:     hint: 'Revisa la conexión a Internet del equipo donde corre el bot y vuelve a intentarlo.',
105:   },
106:   VOICE_CONNECT_FAILED: {
107:     title: 'No se pudo conectar al canal de voz',
108:     detail: 'Discord no completó la conexión antes de agotar el tiempo de espera.',
109:     hint: 'Revisa los permisos Ver canal, Conectar y Hablar. Si persiste, prueba otra Anulación de región en los ajustes del canal de voz.',
110:   },
111:   VOICE_RECONNECT_FAILED: {
112:     title: 'Se perdió la conexión de voz',
113:     detail: 'El bot se desconectó y no pudo volver a entrar al canal.',
114:     hint: 'Revisa la conexión del bot y sus permisos; después vuelve a usar /play.',
115:   },
116:   VOICE_FULL: {
117:     title: 'El canal de voz está lleno',
118:     detail: 'El bot no puede entrar porque el canal alcanzó su límite de usuarios.',
119:     hint: 'Libera un lugar, aumenta el límite del canal o usa otro canal de voz.',
120:   },
121:   VOICE_MISSING_PERMS: {
122:     title: 'Faltan permisos de voz',
123:     detail: 'Discord no permite que el bot entre o hable en ese canal.',
124:     hint: 'Concede Ver canal, Conectar y Hablar al rol del bot y revisa las excepciones del canal.',
125:   },
126:   DISCORD_MISSING_PERMS: {
127:     title: 'Discord rechazó la acción por permisos',
128:     detail: 'El bot no tiene acceso o permisos suficientes para completar la acción.',
129:     hint: 'Revisa el rol del bot y los permisos del canal, incluidos Ver canal, Enviar mensajes e Insertar enlaces.',
130:   },
131:   DISCORD_INVALID_PAYLOAD: {
132:     title: 'Discord rechazó el formato del mensaje del bot',
133:     detail: 'El bot generó una respuesta con campos o componentes inválidos.',
134:     hint: 'Vuelve a abrir la cola con /queue. Si se repite, informa este código para corregir el formato de la respuesta.',
135:   },
136:   EMPTY_PLAYLIST: {
137:     title: 'La playlist no contiene canciones reproducibles',
138:     detail: 'La lista está vacía o sus canciones no están disponibles para el bot.',
139:     hint: 'Comprueba que la playlist sea pública y tenga canciones accesibles.',
140:   },
141:   EMPTY_FILTERED_PLAYLIST: {
142:     title: 'Todas las canciones de la playlist fueron filtradas',
143:     detail: 'No quedó contenido reproducible después de aplicar las restricciones del canal.',
144:     hint: 'Prueba una playlist con canciones públicas sin restricción de edad.',
145:   },
146:   CANNOT_GET_STREAM_URL: {
147:     title: 'No se pudo obtener el audio',
148:     detail: 'Se encontró la canción, pero la plataforma no entregó un enlace de audio reproducible.',
149:     hint: 'Prueba otra versión o fuente. Si ocurre con todas las canciones, revisa yt-dlp en la consola.',
150:   },
151:   UNPLAYABLE_FORMATS: {
152:     title: 'No hay un formato de audio compatible',
153:     detail: 'La plataforma no ofreció un formato que el bot pueda reproducir.',
154:     hint: 'Prueba otra versión de la canción o una fuente diferente.',
155:   },
156:   FFMPEG_NOT_INSTALLED: {
157:     title: 'El motor de audio no está disponible',
158:     detail: 'El bot no pudo encontrar o ejecutar FFmpeg.',
159:     hint: 'Quien administra el bot debe revisar la instalación de ffmpeg-static y reiniciarlo.',
160:   },
161:   FFMPEG_EXITED: {
162:     title: 'El motor de audio se detuvo',
163:     detail: 'FFmpeg terminó antes de completar la reproducción.',
164:     hint: 'Vuelve a pedir la canción o prueba otro enlace. Si se repite, revisa los registros de audio en la consola.',
165:   },
166:   ERR_STREAM_PREMATURE_CLOSE: {
167:     title: 'El audio se interrumpió',
168:     detail: 'La conexión de audio se cerró antes de completar la reproducción.',
169:     hint: 'Vuelve a pedir la canción. Si se repite, prueba otra fuente y revisa la conexión del bot.',
170:   },
171:   YTDLP_NOT_FOUND: {
172:     title: 'El buscador de música no está disponible',
173:     detail: 'El bot no pudo encontrar el ejecutable de yt-dlp.',
174:     hint: 'Quien administra el bot debe reinstalar las dependencias con npm install y reiniciarlo.',
175:   },
176:   NO_EXTRACTOR_PLUGIN: {
177:     title: 'El buscador de música no está configurado',
178:     detail: 'No hay un extractor disponible para resolver búsquedas por nombre.',
179:     hint: 'Quien administra el bot debe revisar la configuración de los plugins y reiniciarlo.',
180:   },
181:   NO_QUEUE: {
182:     title: 'No hay música en reproducción',
183:     detail: 'La cola ya terminó o todavía no se ha creado.',
184:     hint: 'Usa /play para iniciar una canción antes de controlar la reproducción.',
185:   },
186:   NO_UP_NEXT: {
187:     title: 'No hay una siguiente canción',
188:     detail: 'No quedan canciones en la cola para saltar.',
189:     hint: 'Añade una canción con /play o pide sugerencias con /recommend.',
190:   },
191:   UNKNOWN: {
192:     title: 'No se pudo completar la acción de música',
193:     detail: 'Ocurrió un error que el bot todavía no puede identificar.',
194:     hint: 'Inténtalo otra vez. Si persiste, comparte el código de abajo con quien administra el bot; el detalle completo está en la consola.',
195:   },
196: };
197: 
198: const CODE_ALIASES: Record<string, string> = {
199:   NO_STREAM_URL: 'CANNOT_GET_STREAM_URL',
200:   NOT_SUPPORTED_SONG: 'NOT_SUPPORTED_URL',
201:   NO_PLAYING_SONG: 'NO_QUEUE',
202:   QUEUE_STOPPED: 'NO_QUEUE',
203:   ETIMEDOUT: 'NETWORK_TIMEOUT',
204:   UND_ERR_CONNECT_TIMEOUT: 'NETWORK_TIMEOUT',
205:   UND_ERR_HEADERS_TIMEOUT: 'NETWORK_TIMEOUT',
206:   ECONNRESET: 'NETWORK_ERROR',
207:   ECONNREFUSED: 'NETWORK_ERROR',
208:   ENOTFOUND: 'NETWORK_ERROR',
209:   EAI_AGAIN: 'NETWORK_ERROR',
210:   '50013': 'DISCORD_MISSING_PERMS',
211:   '50001': 'DISCORD_MISSING_PERMS',
212:   '50035': 'DISCORD_INVALID_PAYLOAD',
213: };
214: 
215: // FFmpeg's negative AVERROR tags arrive as unsigned 32-bit exit codes on Windows.
216: // https://ffmpeg.org/doxygen/trunk/group__lavu__error.html
217: const FFMPEG_HTTP_ERRORS: Record<number, string> = {
218:   [-0x333034f8]: 'SOURCE_BLOCKED', // HTTP 403
219:   [-0x313034f8]: 'PRIVATE_CONTENT', // HTTP 401
220:   [-0x343034f8]: 'UNAVAILABLE_VIDEO', // HTTP 404
221:   [-0x393234f8]: 'SOURCE_RATE_LIMITED', // HTTP 429
222:   [-0x585835f8]: 'SOURCE_UNAVAILABLE', // HTTP 5xx
223: };
224: 
225: function classifyFFmpegExit(message: unknown): string | undefined {
226:   if (typeof message !== 'string') return undefined;
227:   const match = /^ffmpeg exited with code (-?\d+)$/i.exec(message);
228:   if (!match) return undefined;
229:   const exitCode = Number(match[1]);
230:   if (!Number.isInteger(exitCode) || exitCode < -0x80000000 || exitCode > 0xffffffff) return undefined;
231:   return FFMPEG_HTTP_ERRORS[exitCode | 0];
232: }
233: 
234: export function classifyMusicError(error: unknown): string {
235:   const messages: string[] = [];
236:   let fallbackCode = 'UNKNOWN';
237:   const visited = new Set<unknown>();
238:   for (let current = error; current && !visited.has(current) && visited.size < 5;) {
239:     visited.add(current);
240:     if (typeof current === 'string') {
241:       messages.push(current);
242:       break;
243:     }
244:     if (typeof current !== 'object') break;
245:     const candidate = current as { errorCode?: unknown; code?: unknown; message?: unknown; stderr?: unknown; cause?: unknown };
246:     const rawCode = candidate.errorCode ?? candidate.code;
247:     const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';
248:     const knownCode = Object.hasOwn(CODE_ALIASES, code) ? CODE_ALIASES[code]! : code;
249:     if (knownCode === 'FFMPEG_EXITED') {
250:       const httpError = classifyFFmpegExit(candidate.message);
251:       if (httpError) return httpError;
252:     }
253:     if (Object.hasOwn(ERROR_DESCRIPTIONS, knownCode)) return knownCode;
254:     if (/^[A-Z0-9_]{1,64}$/.test(code)) fallbackCode = code;
255:     if (typeof candidate.message === 'string') messages.push(candidate.message);
256:     if (typeof candidate.stderr === 'string') messages.push(candidate.stderr);
257:     current = candidate.cause;
258:   }
259: 
260:   const message = messages.join('\n');
261:   const patterns: [RegExp, string][] = [
262:     [/confirm you(?:'|’)?re not a bot|HTTP (?:Error |error )?403|403 Forbidden/i, 'SOURCE_BLOCKED'],
263:     [/HTTP (?:Error |error )?429|429 Too Many Requests/i, 'SOURCE_RATE_LIMITED'],
264:     [/age[- ]restricted|confirm your age|age verification/i, 'AGE_RESTRICTED'],
265:     [/private (?:video|playlist)|(?:video|playlist) is private|login required|sign in|log in|members[- ]only|requires authentication/i, 'PRIVATE_CONTENT'],
266:     [/not available in your country|not made .*available in your country|not available (?:in|from) your (?:region|location)|geo[- ]restrict/i, 'GEO_RESTRICTED'],
267:     [/video (?:is )?unavailable|video has been removed|video (?:is )?deleted|HTTP (?:Error |error )?404/i, 'UNAVAILABLE_VIDEO'],
268:     [/requested format (?:is )?not available|no (?:playable|video|audio) formats found/i, 'UNPLAYABLE_FORMATS'],
269:     [/timed? ?out|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS)_TIMEOUT/i, 'NETWORK_TIMEOUT'],
270:     [/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|unable to resolve|name or service not known|temporary failure in name resolution/i, 'NETWORK_ERROR'],
271:     [/HTTP (?:Error |error )?5\d\d/i, 'SOURCE_UNAVAILABLE'],
272:     [/spawn .*yt-dlp.*ENOENT/i, 'YTDLP_NOT_FOUND'],
273:     [/did not return a playable stream URL|cannot resolve a stream URL/i, 'CANNOT_GET_STREAM_URL'],
274:   ];
275:   return patterns.find(([pattern]) => pattern.test(message))?.[1] ?? fallbackCode;
276: }
277: 
278: export function musicErrorTitle(error: unknown): string {
279:   return (ERROR_DESCRIPTIONS[classifyMusicError(error)] ?? ERROR_DESCRIPTIONS['UNKNOWN']!).title;
280: }
281: 
282: export function describeMusicError(error: unknown, context: MusicErrorContext = {}): string {
283:   const code = classifyMusicError(error);
284:   const description = ERROR_DESCRIPTIONS[code] ?? ERROR_DESCRIPTIONS['UNKNOWN']!;
285:   const source = context.source === 'youtube' ? 'YouTube y YouTube Music' : 'SoundCloud';
286:   const detail = code === 'CANNOT_RESOLVE_SONG' && context.source
287:     ? `La búsqueda no devolvió canciones; se probaron YouTube, YouTube Music y SoundCloud empezando por ${source}.`
288:     : description.detail;
289:   const song = context.songName ? `\nCanción: **${escapeMarkdown(context.songName.slice(0, 160))}**` : '';
290:   return `❌ **${description.title}**${song}\n${detail}\n\n💡 ${description.hint}\n\nCódigo: \`${code}\``;
291: }
````

## File: src/bootstrap.ts
````typescript
 1: import 'dotenv/config';
 2: import { guardedEvent, installProcessHandlers } from './runtime/safety';
 3: import { installLogs } from './runtime/logger';
 4: import { acquireInstanceLock, InstanceLockError } from './runtime/instanceLock';
 5: const logs = installLogs();
 6: 
 7: let stopBot: (() => Promise<void>) | undefined;
 8: let releaseInstance: (() => Promise<void>) | undefined;
 9: let stopping = false;
10: function shutdown(code: number): void {
11:   if (stopping) {
12:     if (code !== 0) process.exit(code);
13:     return;
14:   }
15:   stopping = true;
16:   // Shutdown cannot wait indefinitely for Discord or another dependency.
17:   setTimeout(() => process.exit(code), 5_000).unref();
18:   void Promise.resolve().then(() => stopBot?.()).catch(error => console.error('Error durante el cierre:', error))
19:     .finally(() => { void logs.close().finally(async () => {
20:       try { await releaseInstance?.(); } finally { process.exit(code); }
21:     }); });
22: }
23: 
24: installProcessHandlers(shutdown);
25: process.on('SIGINT', () => shutdown(0));
26: process.on('SIGTERM', () => shutdown(0));
27: process.on('disconnect', () => shutdown(0));
28: process.on('message', (message: unknown) => {
29:   if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') shutdown(0);
30: });
31: 
32: // IPC callbacks absorb parent disconnects; a failed heartbeat is not a bot failure.
33: const heartbeat = setInterval(() => {
34:   if (process.connected) process.send?.({ type: 'heartbeat' }, () => {});
35: }, 10_000);
36: heartbeat.unref();
37: 
38: async function boot(): Promise<void> {
39:   const { config } = await import('./config');
40:   releaseInstance = await acquireInstanceLock(config.clientId);
41:   if (stopping) { await releaseInstance(); return; }
42:   const { client, queueRecovery, startBot, stopEmptyVoice, stopPlayerPanels, history } = await import('./index');
43:   stopBot = async () => {
44:     stopEmptyVoice();
45:     stopPlayerPanels();
46:     queueRecovery.stop();
47:     await Promise.allSettled([history.close(), client.destroy()]);
48:   };
49:   if (stopping) { await stopBot(); return; }
50:   await startBot();
51: }
52: 
53: void boot().catch(guardedEvent('Inicio del bot', (error: unknown) => {
54:   console.error(error);
55:   // Configuration failures should be fixed, rather than retried forever.
56:   const message = error instanceof Error ? error.message : String(error);
57:   shutdown(error instanceof InstanceLockError ? (error.code === 'INSTANCE_ALREADY_RUNNING' ? 79 : 78) :
58:     /Variable de entorno requerida|invalid token|TokenInvalid|disallowed intents/i.test(message) ? 78 : 1);
59: }));
````

## File: src/events/buttonHandler.ts
````typescript
  1: import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
  2: import { ButtonId, createQueueButtons, createQueueEmbed } from '../utils/embed';
  3: import { BotColors } from '../utils/colors';
  4: import { describeMusicError } from '../music/errors';
  5: import { getPlayerPanels } from '../music/playerPanel';
  6: import { getPlaybackHealth } from '../music/playbackHealth';
  7: import { historyView } from '../music/historyView';
  8: import { playRequest } from '../commands/play';
  9: import { checkpointQueue } from '../music/queueChanges';
 10: import { ensureControlChannel } from '../utils/guard';
 11: 
 12: export async function handleButton(interaction: ButtonInteraction) {
 13:   if (!interaction.guild) return;
 14: 
 15:   const distube = interaction.client.distube;
 16:   const historyMatch = /^hist_(page|retry):(\d{15,22}):([a-f0-9]{16}|\d{1,3})$/.exec(interaction.customId);
 17:   if (historyMatch) {
 18:     const history = getPlaybackHealth(distube)?.history;
 19:     if (!history || historyMatch[2] !== interaction.guild.id) {
 20:       await interaction.reply({ content: 'Este historial no está disponible para este servidor.', flags: MessageFlags.Ephemeral }); return;
 21:     }
 22:     if (historyMatch[1] === 'page') {
 23:       await interaction.deferUpdate();
 24:       await interaction.editReply(historyView(history, interaction.guild.id, Number(historyMatch[3])));
 25:     } else {
 26:       const current = distube.getQueue(interaction.guild.id);
 27:       if (current && !await ensureControlChannel(interaction, current)) return;
 28:       if (!interaction.guild.members.cache.get(interaction.user.id)?.voice.channel) {
 29:         await interaction.reply({ content: 'Debes estar en un canal de voz para volver a intentarlo.', flags: MessageFlags.Ephemeral }); return;
 30:       }
 31:       const entry = history.claim(interaction.guild.id, historyMatch[3]!);
 32:       if (!entry?.url) { await interaction.reply({ content: 'La entrada venció o ya se intentó hace menos de 30 segundos.', flags: MessageFlags.Ephemeral }); return; }
 33:       await playRequest(interaction, entry.url, entry.searchSource, true);
 34:     }
 35:     return;
 36:   }
 37:   const queue = distube.getQueue(interaction.guild.id);
 38:   const panels = getPlayerPanels(distube);
 39:   const pageMatch = /^queue_page:([a-f0-9]{16}):(\d{1,6})$/.exec(interaction.customId);
 40:   if (!pageMatch && !Object.values(ButtonId).includes(interaction.customId as ButtonId)) return;
 41: 
 42:   const current = queue && (pageMatch ? panels?.session(queue) === pageMatch[1] : panels?.owns(queue, interaction.message.id));
 43:   if (!queue || !panels || !current) {
 44:     await interaction.reply({ content: '⌛ Este panel pertenece a una sesión anterior. Usa `/nowplaying` para ver el reproductor actual.', flags: MessageFlags.Ephemeral });
 45:     await interaction.message.edit({ components: [] }).catch((error: unknown) => console.error('[Retirar controles antiguos]', error));
 46:     return;
 47:   }
 48: 
 49:   const member = interaction.guild.members.cache.get(interaction.user.id);
 50:   if (!member?.voice.channel) {
 51:     await interaction.reply({
 52:       embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en un canal de voz.')],
 53:       flags: MessageFlags.Ephemeral,
 54:     });
 55:     return;
 56:   }
 57: 
 58:   if (member.voice.channel.id !== queue.voiceChannel?.id) {
 59:     await interaction.reply({ content: '❌ Debes estar en el mismo canal de voz que el bot.', flags: MessageFlags.Ephemeral });
 60:     return;
 61:   }
 62: 
 63:   if (pageMatch) await interaction.deferUpdate();
 64:   else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
 65: 
 66:   // A session can end while Discord acknowledges the interaction. Never call
 67:   // stop/pause/skip on an old Queue after a replacement has taken its guild ID.
 68:   const stillCurrent = distube.getQueue(interaction.guild.id) === queue && (pageMatch
 69:     ? panels.session(queue) === pageMatch[1] : panels.owns(queue, interaction.message.id));
 70:   if (!stillCurrent) {
 71:     await interaction.editReply({ content: '⌛ La sesión terminó. Usa `/nowplaying` para ver el reproductor actual.', embeds: [], components: [] });
 72:     return;
 73:   }
 74: 
 75:   if (pageMatch) {
 76:     const page = Number(pageMatch[2]);
 77:     const session = panels.session(queue);
 78:     await interaction.editReply({ embeds: [createQueueEmbed(queue, page)], components: session ? createQueueButtons(queue, session, page) : [], allowedMentions: { parse: [] } });
 79:     return;
 80:   }
 81: 
 82:   switch (interaction.customId) {
 83:     case ButtonId.History: {
 84:       const history = getPlaybackHealth(distube)?.history;
 85:       if (history) await interaction.editReply(historyView(history, interaction.guild.id));
 86:       else await interaction.editReply({ content: 'El historial todavía no está disponible.' });
 87:       break;
 88:     }
 89:     case ButtonId.Retry: {
 90:       await getPlaybackHealth(distube)?.retryBlocked(queue);
 91:       checkpointQueue(distube, queue); await panels.refresh(queue);
 92:       await interaction.editReply({ content: '🔄 Iniciada una prueba de recuperación de la cola.' });
 93:       break;
 94:     }
 95:     case ButtonId.PauseResume: {
 96:       if (queue.paused) {
 97:         await queue.resume();
 98:         await panels.refresh(queue);
 99:         await interaction.editReply({ content: '▶️ Música reanudada.' });
100:       } else {
101:         await queue.pause();
102:         await panels.refresh(queue);
103:         await interaction.editReply({ content: '⏸️ Música pausada.' });
104:       }
105:       break;
106:     }
107: 
108:     case ButtonId.Skip: {
109:       try {
110:         const song = await queue.skip();
111:         await panels.refresh(queue);
112:         await interaction.editReply({
113:           embeds: [new EmbedBuilder().setColor(BotColors.Success).setDescription(`⏭️ Saltando a: **${song.name}**`)],
114:         });
115:       } catch (error) {
116:         await interaction.editReply({
117:           embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(describeMusicError(error))],
118:         });
119:       }
120:       break;
121:     }
122: 
123:     case ButtonId.Stop: {
124:       await queue.stop();
125:       await panels.close(queue, '⏹ Música detenida');
126:       await interaction.editReply({
127:         embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('⏹️ Música detenida.')],
128:       });
129:       break;
130:     }
131: 
132:     case ButtonId.Queue: {
133:       const embed = createQueueEmbed(queue);
134:       const session = panels.session(queue);
135:       await interaction.editReply({ embeds: [embed], components: session ? createQueueButtons(queue, session) : [], allowedMentions: { parse: [] } });
136:       break;
137:     }
138:   }
139: }
````

## File: src/music/ytDlpSearchPlugin.ts
````typescript
  1: import { ExtractorPlugin, Playlist, ResolveOptions, Song, SongInfo, PlaylistInfo } from 'distube';
  2: import { setTimeout as delay } from 'node:timers/promises';
  3: import { runYtDlp, YtDlpFlags } from './ytDlpRunner';
  4: import { classifyMusicError } from './errors';
  5: 
  6: // The wrapper's types predate yt-dlp's JavaScript runtime option.
  7: type YtDlpJsonFlags = YtDlpFlags;
  8: 
  9: export type SearchSource = 'youtube' | 'soundcloud';
 10: 
 11: export interface PlaybackMetadata {
 12:   searchSource: SearchSource;
 13: }
 14: 
 15: interface CacheEntry<T> {
 16:   expiresAt: number;
 17:   value: T;
 18: }
 19: 
 20: interface YtDlpThumbnail {
 21:   url?: string;
 22: }
 23: 
 24: interface YtDlpInfo {
 25:   _type?: string;
 26:   id?: string | number;
 27:   title?: string;
 28:   fulltitle?: string;
 29:   url?: string;
 30:   webpage_url?: string;
 31:   original_url?: string;
 32:   extractor?: string;
 33:   is_live?: boolean;
 34:   duration?: number | null;
 35:   thumbnail?: string;
 36:   thumbnails?: YtDlpThumbnail[];
 37:   uploader?: string;
 38:   uploader_url?: string;
 39:   view_count?: number;
 40:   like_count?: number;
 41:   dislike_count?: number;
 42:   repost_count?: number;
 43:   age_limit?: number;
 44:   entries?: YtDlpInfo[];
 45: }
 46: 
 47: const URL_PATTERN = /^https?:\/\//i;
 48: const SEARCH_PREFIXES: Record<SearchSource, string> = {
 49:   youtube: 'ytsearch5:',
 50:   soundcloud: 'scsearch5:',
 51: };
 52: const YTDLP_SEARCH_PATTERN = /^(?:ytsearch|scsearch)\d*:/i;
 53: const SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
 54: const STREAM_CACHE_TTL_MS = 25 * 60 * 1000;
 55: const MIX_CACHE_TTL_MS = 30 * 60 * 1000;
 56: const SEARCH_CACHE_MAX_ITEMS = 500;
 57: const STREAM_CACHE_MAX_ITEMS = 200;
 58: const MIX_CACHE_MAX_ITEMS = 100;
 59: const MIX_CANDIDATE_LIMIT = 60;
 60: const PLAYLIST_WARM_CONCURRENCY = 2;
 61: export const PLAYLIST_SEARCH_WARM_LIMIT = 25;
 62: 
 63: class TtlCache<T> {
 64:   private readonly entries = new Map<string, CacheEntry<T>>();
 65: 
 66:   constructor(
 67:     private readonly maxItems: number,
 68:     private readonly ttlMs: number,
 69:   ) {}
 70: 
 71:   get(key: string): T | undefined {
 72:     const entry = this.entries.get(key);
 73:     if (!entry) return undefined;
 74: 
 75:     if (entry.expiresAt <= Date.now()) {
 76:       this.entries.delete(key);
 77:       return undefined;
 78:     }
 79: 
 80:     this.entries.delete(key);
 81:     this.entries.set(key, entry);
 82:     return entry.value;
 83:   }
 84: 
 85:   set(key: string, value: T): void {
 86:     this.deleteExpired();
 87:     this.entries.set(key, {
 88:       expiresAt: Date.now() + this.ttlMs,
 89:       value,
 90:     });
 91:     this.trim();
 92:   }
 93: 
 94:   private deleteExpired(): void {
 95:     const now = Date.now();
 96:     for (const [key, entry] of this.entries) {
 97:       if (entry.expiresAt <= now) {
 98:         this.entries.delete(key);
 99:       }
100:     }
101:   }
102: 
103:   delete(key: string): void {
104:     this.entries.delete(key);
105:   }
106: 
107:   private trim(): void {
108:     while (this.entries.size > this.maxItems) {
109:       const oldestKey = this.entries.keys().next().value;
110:       if (!oldestKey) return;
111:       this.entries.delete(oldestKey);
112:     }
113:   }
114: }
115: 
116: function isSearchSource(value: unknown): value is SearchSource {
117:   return value === 'youtube' || value === 'soundcloud';
118: }
119: 
120: function getSearchSource(metadata: unknown): SearchSource {
121:   if (typeof metadata !== 'object' || metadata === null) return 'youtube';
122:   const candidate = metadata as { searchSource?: unknown };
123:   return isSearchSource(candidate.searchSource) ? candidate.searchSource : 'youtube';
124: }
125: 
126: function toSearchQuery(query: string, source: SearchSource): string {
127:   const trimmedQuery = query.trim();
128:   return YTDLP_SEARCH_PATTERN.test(trimmedQuery) ? trimmedQuery : `${SEARCH_PREFIXES[source]}${trimmedQuery}`;
129: }
130: 
131: function normalizeSearchCacheKey(query: string): string {
132:   return query.trim().replace(/\s+/g, ' ').toLowerCase();
133: }
134: 
135: function normalizeUrlCacheKey(url: string): string {
136:   return url.trim();
137: }
138: 
139: function toStringValue(value: unknown): string | undefined {
140:   if (typeof value === 'string' && value.trim()) return value;
141:   if (typeof value === 'number') return String(value);
142:   return undefined;
143: }
144: 
145: function toPositiveNumber(value: unknown): number | undefined {
146:   return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
147: }
148: 
149: function getBestThumbnail(info: YtDlpInfo): string | undefined {
150:   if (info.thumbnail) return info.thumbnail;
151:   return info.thumbnails?.find((thumbnail) => typeof thumbnail.url === 'string')?.url;
152: }
153: 
154: function hasEntries(info: YtDlpInfo): info is YtDlpInfo & { entries: YtDlpInfo[] } {
155:   return Array.isArray(info.entries);
156: }
157: 
158: function getPlayableUrl(info: YtDlpInfo): string | undefined {
159:   return info.webpage_url ?? info.original_url ?? info.url;
160: }
161: 
162: function searchTokens(value: string): string[] {
163:   const ignored = new Set(['la', 'las', 'los', 'el', 'de', 'del', 'en', 'y', 'the', 'of', 'and', 'a', 'official', 'audio', 'video', 'lyrics']);
164:   return (value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
165:     .filter((word) => !ignored.has(word));
166: }
167: 
168: function matchesSearchQuery(query: string, result: YtDlpInfo): boolean {
169:   const wanted = searchTokens(query);
170:   const words = searchTokens(`${result.title ?? ''} ${result.uploader ?? ''}`);
171:   return wanted.length === 0 || wanted.filter((word) => words.includes(word)).length / wanted.length >= 0.8;
172: }
173: 
174: function recoveryQuery(name: string): string {
175:   return name.replace(/\b(?:official(?: music)? video|official audio|lyric(?:s| video)|visualizer|HD|4K)\b/gi, ' ')
176:     .replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
177: }
178: 
179: function compatibleAlternative(query: string, requested: Song, reference: Song, info: YtDlpInfo): boolean {
180:   if (!matchesSearchQuery(query, info) || info.is_live || (info.age_limit ?? 0) >= 18) return false;
181:   // Metadata providers know the artist separately. A long matching title must
182:   // not hide an artist mismatch when looking for a different upload.
183:   if (!requested.stream.playFromSource && requested.uploader?.name && !matchesSearchQuery(requested.uploader.name, info)) return false;
184:   if (!matchesSearchQuery(recoveryQuery(requested.name ?? ''), info)) return false;
185:   const originalWords = searchTokens(query);
186:   const candidateWords = searchTokens(info.title ?? '');
187:   const variants = ['remix', 'live', 'cover', 'karaoke', 'nightcore', 'sped', 'slowed', 'instrumental'];
188:   if (variants.some(word => candidateWords.includes(word) && !originalWords.includes(word))) return false;
189:   const duration = requested.duration || reference.duration;
190:   if (duration > 0 && (!info.duration || Math.abs(info.duration - duration) > Math.max(15, Math.min(45, duration * 0.15)))) return false;
191:   return true;
192: }
193: 
194: export function rankSearchCandidates<T extends { title?: string; uploader?: string; duration?: number | null }>(query: string, candidates: T[]): T[] {
195:   const wanted = searchTokens(query);
196:   const variants = ['remix', 'live', 'cover', 'karaoke', 'nightcore', 'sped', 'slowed'];
197:   const score = (candidate: T) => {
198:     const words = searchTokens(`${candidate.title ?? ''} ${candidate.uploader ?? ''}`);
199:     const overlap = wanted.filter((word) => words.includes(word)).length / Math.max(wanted.length, 1);
200:     const penalty = variants.some((word) => words.includes(word) && !wanted.includes(word)) ? 0.4 : 0;
201:     return overlap - penalty;
202:   };
203:   return candidates.map((candidate, index) => ({ candidate, index, score: score(candidate) }))
204:     .sort((a, b) => b.score - a.score || a.index - b.index).map(({ candidate }) => candidate);
205: }
206: 
207: async function runWithConcurrency<T>(
208:   items: T[],
209:   concurrency: number,
210:   worker: (item: T) => Promise<void>,
211: ): Promise<void> {
212:   let nextIndex = 0;
213:   const workerCount = Math.min(concurrency, items.length);
214:   const workers = Array.from({ length: workerCount }, async () => {
215:     while (nextIndex < items.length) {
216:       const item = items[nextIndex];
217:       nextIndex += 1;
218:       if (item !== undefined) {
219:         await worker(item);
220:       }
221:     }
222:   });
223: 
224:   await Promise.all(workers);
225: }
226: 
227: export class YtDlpSearchPlugin extends ExtractorPlugin {
228:   private readonly searchCache = new TtlCache<YtDlpInfo>(SEARCH_CACHE_MAX_ITEMS, SEARCH_CACHE_TTL_MS);
229:   private readonly streamUrlCache = new TtlCache<string>(STREAM_CACHE_MAX_ITEMS, STREAM_CACHE_TTL_MS);
230:   private readonly mixCache = new TtlCache<YtDlpInfo[]>(MIX_CACHE_MAX_ITEMS, MIX_CACHE_TTL_MS);
231:   private readonly pendingSearches = new Map<string, Promise<YtDlpInfo | null>>();
232:   private readonly pendingStreamUrls = new Map<string, Promise<string>>();
233:   private readonly pendingMixes = new Map<string, Promise<YtDlpInfo[]>>();
234:   private readonly refreshAfter = new WeakMap<Song, number>();
235:   private readonly sourceCooldowns = new Map<SearchSource, { until: number; error: unknown }>();
236: 
237:   override validate(url: string): boolean {
238:     return URL_PATTERN.test(url);
239:   }
240: 
241:   override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
242:     const info = await this.fetchInfo(url, { playlistEnd: 500 });
243: 
244:     if (hasEntries(info)) {
245:       return this.createPlaylist(info, options);
246:     }
247: 
248:     return this.createSong(info, options);
249:   }
250: 
251:   override async searchSong<T>(query: string, options: ResolveOptions<T>): Promise<Song<T> | null> {
252:     const result = await this.getSearchResult(query, options.metadata);
253: 
254:     return result ? this.createSong(result, options) : null;
255:   }
256: 
257:   override async getStreamURL<T>(song: Song<T>): Promise<string> {
258:     const refreshAfter = this.refreshAfter.get(song);
259:     if (refreshAfter) {
260:       this.refreshAfter.delete(song);
261:       await delay(Math.max(0, refreshAfter - Date.now()));
262:     }
263:     if (!song.url) {
264:       throw new Error('Cannot resolve a stream URL for a song without a source URL.');
265:     }
266: 
267:     const cacheKey = normalizeUrlCacheKey(song.url);
268:     const cachedStreamUrl = this.streamUrlCache.get(cacheKey);
269:     if (cachedStreamUrl) return cachedStreamUrl;
270: 
271:     const pendingStreamUrl = this.pendingStreamUrls.get(cacheKey);
272:     if (pendingStreamUrl) return pendingStreamUrl;
273: 
274:     const streamUrlPromise = this.fetchStreamUrl(song.url).finally(() => {
275:       this.pendingStreamUrls.delete(cacheKey);
276:     });
277:     this.pendingStreamUrls.set(cacheKey, streamUrlPromise);
278: 
279:     const streamUrl = await streamUrlPromise;
280:     this.streamUrlCache.set(cacheKey, streamUrl);
281:     return streamUrl;
282:   }
283: 
284:   override async getRelatedSongs(song: Song): Promise<Song[]> {
285:     return this.getRecommendations(song);
286:   }
287: 
288:   invalidateStream(song: Song, retryDelayMs = 500): void {
289:     const playable = song.stream.playFromSource ? song : song.stream.song;
290:     if (!playable) return;
291:     if (playable.url) this.streamUrlCache.delete(normalizeUrlCacheKey(playable.url));
292:     if (playable.stream.playFromSource) delete playable.stream.url;
293:     this.refreshAfter.set(playable, Date.now() + retryDelayMs);
294:   }
295: 
296:   async searchCandidates(query: string, limit = 5, source: SearchSource = 'youtube'): Promise<Song[]> {
297:     const budget = AbortSignal.timeout(90_000);
298:     let lastError: unknown;
299:     for (const attempt of this.searchAttempts(toSearchQuery(query, source), limit)) {
300:       const cooldown = this.sourceCooldowns.get(attempt.source);
301:       if (cooldown && cooldown.until > Date.now()) { lastError = cooldown.error; continue; }
302:       try {
303:         const info = await this.fetchInfo(attempt.input, { flatPlaylist: true, playlistEnd: limit }, budget);
304:         const entries = (hasEntries(info) ? info.entries : [info]).filter((entry) => entry && getPlayableUrl(entry));
305:         if (entries.length) return rankSearchCandidates(query, entries).slice(0, limit).map((entry) => this.createSong(
306:           { ...entry, extractor: attempt.source }, { metadata: { searchSource: attempt.source } },
307:         ));
308:       } catch (error) {
309:         this.noteSourceError(attempt.source, error);
310:         lastError = error;
311:         if (budget.aborted || ['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
312:       }
313:     }
314:     if (lastError) throw lastError;
315:     return [];
316:   }
317: 
318:   async findAlternative(song: Song, signal?: AbortSignal): Promise<Song | null> {
319:     if (!song.name || song.isLive) return null;
320:     const reference = song.stream.playFromSource ? song : song.stream.song ?? song;
321:     if (reference.isLive) return null;
322:     const query = recoveryQuery(`${song.name} ${!song.stream.playFromSource ? song.uploader?.name ?? '' : ''}`);
323:     if (!query) return null;
324:     const budget = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]);
325:     const preferred: SearchSource = reference.source.toLowerCase().includes('soundcloud') ? 'youtube' : 'soundcloud';
326:     let hydrated = 0;
327:     const seen = new Set<string>();
328:     for (const attempt of this.searchAttempts(toSearchQuery(query, preferred))) {
329:       budget.throwIfAborted();
330:       const cooldown = this.sourceCooldowns.get(attempt.source);
331:       if (cooldown && cooldown.until > Date.now()) continue;
332:       try {
333:         const info = await this.fetchInfo(attempt.input, { flatPlaylist: true, playlistEnd: 5 }, budget);
334:         const entries = rankSearchCandidates(query, (hasEntries(info) ? info.entries : [info]).filter(entry => entry && getPlayableUrl(entry)));
335:         for (const entry of entries.slice(0, 3)) {
336:           const url = getPlayableUrl(entry)!;
337:           const key = `${attempt.source}:${entry.id ?? url}`;
338:           if (seen.has(key)) continue;
339:           seen.add(key);
340:           const sameSource = attempt.source === (reference.source.includes('soundcloud') ? 'soundcloud' : 'youtube');
341:           if (url === reference.url || (String(entry.id) === reference.id && sameSource)) continue;
342:           if (hydrated++ >= 6) return null;
343:           try {
344:             const result = await this.fetchInfo(url, { format: 'ba/ba*', noPlaylist: true }, budget);
345:             const canonical = getPlayableUrl(result);
346:             if (!canonical || canonical === reference.url || hasEntries(result) || !result.url || result.url === canonical) continue;
347:             if (String(result.id) === reference.id && sameSource) continue;
348:             if (!compatibleAlternative(query, song, reference, result)) continue;
349:             const candidate = this.createSong({ ...result, extractor: result.extractor ?? attempt.source }, {
350:               metadata: song.metadata, ...(song.member ? { member: song.member } : {}),
351:             });
352:             if (!candidate.stream.playFromSource) continue;
353:             candidate.stream.url = result.url;
354:             if (song.playlist) candidate.playlist = song.playlist;
355:             this.streamUrlCache.set(normalizeUrlCacheKey(canonical), result.url);
356:             budget.throwIfAborted();
357:             return candidate;
358:           } catch (error) {
359:             budget.throwIfAborted();
360:             this.noteSourceError(attempt.source, error);
361:             if (['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
362:             if (['SOURCE_BLOCKED', 'SOURCE_RATE_LIMITED'].includes(classifyMusicError(error))) break;
363:           }
364:         }
365:       } catch (error) {
366:         budget.throwIfAborted();
367:         this.noteSourceError(attempt.source, error);
368:         if (['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
369:       }
370:     }
371:     return null;
372:   }
373: 
374:   private searchAttempts(searchQuery: string, limit = 5): { input: string; source: SearchSource }[] {
375:     const match = /^(ytsearch|scsearch)\d*:(.*)$/is.exec(searchQuery);
376:     const query = match?.[2] ?? searchQuery;
377:     const youtube: { input: string; source: SearchSource }[] = [
378:       { input: `ytsearch${limit}:${query}`, source: 'youtube' },
379:       { input: `https://music.youtube.com/search?${new URLSearchParams({ q: query })}#songs`, source: 'youtube' },
380:     ];
381:     const soundcloud = { input: `scsearch${limit}:${query}`, source: 'soundcloud' as const };
382:     return match?.[1]?.toLowerCase() === 'scsearch' ? [soundcloud, ...youtube] : [...youtube, soundcloud];
383:   }
384: 
385:   private noteSourceError(source: SearchSource, error: unknown): void {
386:     if (['SOURCE_RATE_LIMITED', 'SOURCE_BLOCKED'].includes(classifyMusicError(error))) {
387:       this.sourceCooldowns.set(source, { until: Date.now() + 60_000, error });
388:     }
389:   }
390: 
391:   async getRecommendations(seed: Song): Promise<Song[]> {
392:     const videoId = await this.getYouTubeVideoId(seed);
393:     if (!videoId) return [];
394: 
395:     const entries = await this.getMixEntries(videoId);
396:     const seen = new Set<string>([videoId]);
397:     return entries.flatMap((entry) => {
398:       const id = toStringValue(entry.id);
399:       if (!id || !/^[\w-]{11}$/.test(id) || seen.has(id)) return [];
400:       seen.add(id);
401: 
402:       const info: YtDlpInfo = {
403:         ...entry,
404:         id,
405:         extractor: 'youtube',
406:         webpage_url: `https://www.youtube.com/watch?v=${id}`,
407:       };
408:       const options: ResolveOptions<PlaybackMetadata> = { metadata: { searchSource: 'youtube' } };
409:       if (seed.member) options.member = seed.member;
410:       return [this.createSong(info, options)];
411:     });
412:   }
413: 
414:   async warmSearchCache(queries: string[], metadata: unknown): Promise<void> {
415:     const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(
416:       0,
417:       PLAYLIST_SEARCH_WARM_LIMIT,
418:     );
419: 
420:     await runWithConcurrency(uniqueQueries, PLAYLIST_WARM_CONCURRENCY, async (query) => {
421:       try {
422:         await this.getSearchResult(query, metadata);
423:       } catch (error) {
424:         console.warn(`No se pudo precachear "${query}":`, error);
425:       }
426:     });
427:   }
428: 
429:   private async fetchStreamUrl(url: string): Promise<string> {
430:     const info = await this.fetchInfo(url, { format: 'ba/ba*', noPlaylist: true });
431:     const streamUrl = toStringValue(info.url);
432: 
433:     if (!streamUrl) {
434:       throw new Error(`yt-dlp did not return a playable stream URL for ${url}.`);
435:     }
436: 
437:     return streamUrl;
438:   }
439: 
440:   private async getYouTubeVideoId(song: Song): Promise<string | null> {
441:     if (!song.stream.playFromSource && song.stream.song) {
442:       return this.getYouTubeVideoId(song.stream.song);
443:     }
444: 
445:     if (song.source.toLowerCase().includes('youtube') && /^[\w-]{11}$/.test(song.id)) {
446:       return song.id;
447:     }
448: 
449:     const query = [song.name, song.uploader.name].filter(Boolean).join(' ');
450:     if (!query) return null;
451: 
452:     const result = await this.getSearchResult(query, { searchSource: 'youtube' });
453:     const id = result && toStringValue(result.id);
454:     return id && /^[\w-]{11}$/.test(id) ? id : null;
455:   }
456: 
457:   private async getMixEntries(videoId: string): Promise<YtDlpInfo[]> {
458:     const cached = this.mixCache.get(videoId);
459:     if (cached) return cached;
460: 
461:     const pending = this.pendingMixes.get(videoId);
462:     if (pending) return pending;
463: 
464:     const promise = this.fetchInfo(
465:       `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
466:       { flatPlaylist: true, playlistEnd: MIX_CANDIDATE_LIMIT },
467:     ).then((info) => {
468:       const entries = hasEntries(info) ? info.entries : [];
469:       if (entries.length > 0) this.mixCache.set(videoId, entries);
470:       return entries;
471:     }).finally(() => {
472:       this.pendingMixes.delete(videoId);
473:     });
474: 
475:     this.pendingMixes.set(videoId, promise);
476:     return promise;
477:   }
478: 
479:   private async getSearchResult(query: string, metadata: unknown): Promise<YtDlpInfo | null> {
480:     const trimmedQuery = query.trim();
481:     if (!trimmedQuery) return null;
482: 
483:     const searchQuery = toSearchQuery(trimmedQuery, getSearchSource(metadata));
484:     const cacheKey = normalizeSearchCacheKey(searchQuery);
485:     const cachedResult = this.searchCache.get(cacheKey);
486:     if (cachedResult) return cachedResult;
487: 
488:     const pendingSearch = this.pendingSearches.get(cacheKey);
489:     if (pendingSearch) return pendingSearch;
490: 
491:     const searchPromise = this.fetchSearchResult(searchQuery).finally(() => {
492:       this.pendingSearches.delete(cacheKey);
493:     });
494:     this.pendingSearches.set(cacheKey, searchPromise);
495: 
496:     const result = await searchPromise;
497:     if (result) {
498:       this.searchCache.set(cacheKey, result);
499:     }
500: 
501:     return result;
502:   }
503: 
504:   private async fetchSearchResult(searchQuery: string): Promise<YtDlpInfo | null> {
505:     const budget = AbortSignal.timeout(90_000);
506:     const query = searchQuery.replace(YTDLP_SEARCH_PATTERN, '');
507:     let lastError: unknown;
508:     for (const attempt of this.searchAttempts(searchQuery)) {
509:       const cooldown = this.sourceCooldowns.get(attempt.source);
510:       if (cooldown && cooldown.until > Date.now()) { lastError = cooldown.error; continue; }
511:       try {
512:         const info = await this.fetchInfo(attempt.input, { flatPlaylist: true, playlistEnd: 5 }, budget);
513:         const candidates = rankSearchCandidates(query, (hasEntries(info) ? info.entries : [info])
514:           .filter((entry) => entry && getPlayableUrl(entry)));
515:         for (const candidate of candidates.slice(0, 5)) {
516:           try {
517:             const result = candidate._type === 'url'
518:               ? await this.fetchInfo(getPlayableUrl(candidate)!, { format: 'ba/ba*', noPlaylist: true }, budget)
519:               : candidate;
520:             const canonical = getPlayableUrl(result);
521:             if (!canonical || hasEntries(result)) continue;
522:             if (candidate._type === 'url' && !matchesSearchQuery(query, result)) continue;
523:             if (result.url && result.url !== canonical) this.streamUrlCache.set(normalizeUrlCacheKey(canonical), result.url);
524:             return { ...result, extractor: result.extractor ?? attempt.source };
525:           } catch (error) {
526:             lastError = error;
527:             this.noteSourceError(attempt.source, error);
528:             if (budget.aborted || ['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
529:             if (['SOURCE_BLOCKED', 'SOURCE_RATE_LIMITED'].includes(classifyMusicError(error))) break;
530:           }
531:         }
532:       } catch (error) {
533:         lastError = error;
534:         this.noteSourceError(attempt.source, error);
535:         if (budget.aborted || ['YTDLP_NOT_FOUND', 'MUSIC_BUSY'].includes(classifyMusicError(error))) throw error;
536:       }
537:     }
538:     if (lastError) throw lastError;
539:     return null;
540:   }
541: 
542:   private async fetchInfo(input: string, extraFlags: YtDlpJsonFlags = {}, signal?: AbortSignal): Promise<YtDlpInfo> {
543:     const flags: YtDlpJsonFlags = {
544:       dumpSingleJson: true,
545:       noWarnings: true,
546:       preferFreeFormats: true,
547:       skipDownload: true,
548:       simulate: true,
549:       jsRuntimes: `node:${process.execPath}`,
550:       ...extraFlags,
551:     };
552: 
553:     return await runYtDlp(input, flags, signal) as YtDlpInfo;
554:   }
555: 
556:   private createPlaylist<T>(info: YtDlpInfo & { entries: YtDlpInfo[] }, options: ResolveOptions<T>): Playlist<T> {
557:     const songs: Song[] = info.entries
558:       .filter((entry) => getPlayableUrl(entry))
559:       .map((entry) => this.createSong(entry, options));
560: 
561:     const playlistInfo: PlaylistInfo = {
562:       source: info.extractor ?? 'yt-dlp',
563:       songs,
564:     };
565: 
566:     const id = toStringValue(info.id);
567:     const name = toStringValue(info.title);
568:     const url = getPlayableUrl(info);
569:     const thumbnail = getBestThumbnail(info);
570: 
571:     if (id) playlistInfo.id = id;
572:     if (name) playlistInfo.name = name;
573:     if (url) playlistInfo.url = url;
574:     if (thumbnail) playlistInfo.thumbnail = thumbnail;
575: 
576:     return new Playlist<T>(playlistInfo, options);
577:   }
578: 
579:   private createSong<T>(info: YtDlpInfo, options: ResolveOptions<T>): Song<T> {
580:     const id = toStringValue(info.id) ?? getPlayableUrl(info) ?? toStringValue(info.title) ?? 'yt-dlp-result';
581:     const source = info.extractor ?? 'yt-dlp';
582:     const songInfo: SongInfo = {
583:       plugin: this,
584:       source,
585:       playFromSource: true,
586:       id,
587:     };
588: 
589:     const name = toStringValue(info.title) ?? toStringValue(info.fulltitle);
590:     const url = getPlayableUrl(info);
591:     const thumbnail = getBestThumbnail(info);
592:     const duration = toPositiveNumber(info.duration);
593:     const views = toPositiveNumber(info.view_count);
594:     const likes = toPositiveNumber(info.like_count);
595:     const dislikes = toPositiveNumber(info.dislike_count);
596:     const reposts = toPositiveNumber(info.repost_count);
597: 
598:     if (name) songInfo.name = name;
599:     if (url) songInfo.url = url;
600:     if (thumbnail) songInfo.thumbnail = thumbnail;
601:     if (typeof info.is_live === 'boolean') songInfo.isLive = info.is_live;
602:     if (duration !== undefined) songInfo.duration = duration;
603:     if (views !== undefined) songInfo.views = views;
604:     if (likes !== undefined) songInfo.likes = likes;
605:     if (dislikes !== undefined) songInfo.dislikes = dislikes;
606:     if (reposts !== undefined) songInfo.reposts = reposts;
607:     if (typeof info.age_limit === 'number') songInfo.ageRestricted = info.age_limit >= 18;
608: 
609:     const uploaderName = toStringValue(info.uploader);
610:     const uploaderUrl = toStringValue(info.uploader_url);
611:     if (uploaderName || uploaderUrl) {
612:       songInfo.uploader = {};
613:       if (uploaderName) songInfo.uploader.name = uploaderName;
614:       if (uploaderUrl) songInfo.uploader.url = uploaderUrl;
615:     }
616: 
617:     return new Song<T>(songInfo, options);
618:   }
619: }
````

## File: src/index.ts
````typescript
 1: import './types';
 2: import { Client, GatewayIntentBits, Events } from 'discord.js';
 3: import { config } from './config';
 4: import { handleInteraction } from './events/interactionCreate';
 5: import { createDisTube } from './music/distube';
 6: import { registerDisTubeEvents } from './music/events';
 7: import { guardedEvent } from './runtime/safety';
 8: import { QueueRecovery } from './music/queueRecovery';
 9: import { registerEmptyVoice } from './music/emptyVoice';
10: import { HistoryStore } from './music/history';
11: import { resolve } from 'node:path';
12: 
13: export const client = new Client({
14:   intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
15: });
16: client.distube = createDisTube(client);
17: export const history = new HistoryStore(resolve('data/history.json'));
18: export const stopPlayerPanels = registerDisTubeEvents(client.distube, history);
19: export const stopEmptyVoice = registerEmptyVoice(client, client.distube);
20: export const queueRecovery = new QueueRecovery(client, client.distube);
21: 
22: client.once(Events.ClientReady, guardedEvent('Recuperar colas al iniciar', async (readyClient) => {
23:   console.log(`✅ Bot conectado como ${readyClient.user.tag}`);
24:   await queueRecovery.restore();
25: }));
26: client.on(Events.Error, (error) => console.error('[Discord client]', error));
27: client.on(Events.ShardError, (error, shard) => console.error(`[Discord shard ${shard}]`, error));
28: client.on(Events.Warn, (message) => console.warn('[Discord]', message));
29: client.on(Events.InteractionCreate, guardedEvent('Interacción de Discord', handleInteraction));
30: 
31: client.on(Events.Raw, guardedEvent('Paquete de voz', (packet: { t?: string }) => {
32:   if (packet.t === 'VOICE_STATE_UPDATE' || packet.t === 'VOICE_SERVER_UPDATE') console.log(`[Gateway Voice Packet] ${packet.t}`);
33: }));
34: client.on(Events.VoiceStateUpdate, guardedEvent('Estado de voz', (_oldState, newState) => {
35:   if (newState.member?.id === client.user?.id) console.log(`[Bot Voice State] Canal: ${newState.channel?.name ?? 'desconectado'}`);
36: }));
37: 
38: export async function startBot(): Promise<void> {
39:   await client.login(config.token);
40: }
````

## File: package.json
````json
 1: {
 2:   "name": "discord-music-bot",
 3:   "version": "1.0.0",
 4:   "description": "Private Discord music bot with DisTube",
 5:   "main": "dist/index.js",
 6:   "scripts": {
 7:     "build": "tsc",
 8:     "test": "tsc && node --test \"test/*.test.js\"",
 9:     "start": "node scripts/supervise.cjs",
10:     "start:once": "node --no-deprecation dist/bootstrap.js",
11:     "update:ytdlp": "node scripts/update-ytdlp.cjs",
12:     "dev": "ts-node src/bootstrap.ts",
13:     "deploy": "ts-node src/deploy-commands.ts",
14:     "deploy:check": "ts-node src/deploy-commands.ts --dry-run"
15:   },
16:   "dependencies": {
17:     "@discordjs/opus": "^0.10.0",
18:     "@distube/spotify": "^2.0.2",
19:     "@distube/yt-dlp": "^2.0.1",
20:     "discord.js": "^14.16.3",
21:     "distube": "^5.0.3",
22:     "dotenv": "^16.4.5",
23:     "ffmpeg-static": "^5.3.0",
24:     "libsodium-wrappers": "^0.8.4"
25:   },
26:   "devDependencies": {
27:     "@types/node": "^22.9.0",
28:     "ts-node": "^10.9.2",
29:     "typescript": "^5.6.3"
30:   }
31: }
````

## File: docs/OPERACION.md
````markdown
  1: # Operación y activación de las mejoras
  2: 
  3: La nueva versión se activó con autorización del usuario el 8 de octubre de 2026 a las 20:24 (Ciudad de México): se respaldaron código y datos, Discord confirmó los 19 comandos y se cerró ordenadamente la instancia anterior antes de arrancar una sola instancia nueva. Se confirmó la recuperación de siete canciones. `npm run start` usa un supervisor de proceso, sin recarga de archivos.
  4: 
  5: La activación inicial usó el supervisor en segundo plano PID 20556 y el bot hijo PID 25824, desde la revisión `2d539846eb84d0ba96b031f44c76759002709dc5`. El respaldo está en `C:\Users\picud\Repos\discord-music-backup-20261008-202303`; contiene el código, historial Git, `dist` preparado y datos después del cierre, además de los metadatos de activación.
  6: 
  7: Después se inició otra copia desde la terminal a las 20:32. Al investigar los errores de voz e interacciones se confirmaron ambas instancias activas. Se cerró ordenadamente solo la copia en segundo plano, conservando el supervisor de la terminal PID 7708 y su bot hijo PID 43540. Estos PID describen la comprobación del incidente; cambiarán al reiniciar.
  8: 
  9: La observación inicial confirmó cinco minutos de avance real, actualización del panel y checkpoints, sin errores ni advertencias nuevos en los registros y sin reemplazo del proceso. El usuario detuvo Computer Use con Esc durante la comprobación de Discord; no se continuó con entradas en la aplicación. Posteriormente, el usuario confirmó que probó el bot sin problemas y que la portada se ve. Se registra esa prueba de uso como satisfactoria; no se especificaron su duración ni todos los controles utilizados. Siguen sin documentarse una prueba prolongada y la recuperación real de una cola bloqueada.
 10: 
 11: Se encontró además pérdida de la portada al restaurar. El ajuste conserva imágenes públicas y usa una portada de YouTube por ID para checkpoints antiguos; está compilado y probado. El usuario confirmó que la portada se muestra en uso real. No indicó si esa comprobación incluyó una restauración de cola.
 12: 
 13: ## Validación local
 14: 
 15: Resultado al 8 de octubre de 2026: **200 pruebas aprobadas, cero fallos**, con compilación TypeScript correcta mediante `npm test`.
 16: 
 17: La suite cubre el detector a 8 y 12 segundos, pausas y seek, tres solicitudes agotadas con la recuperación real, reintento manual, dos servidores, edición simultánea, recomendaciones tardías, historial con límites de almacenamiento, permisos, fallos de disco, rotación y restauración de colas normales y bloqueadas. También comprueba FFmpeg ante un HTTP 403 de un servidor local y el reinicio del supervisor con procesos de prueba.
 18: 
 19: Se simula una hora de progreso y la limpieza repetida de sesiones y observadores. La suite local no inicia un bot ni conecta a Discord con las credenciales del usuario. El registro y la activación reales se hicieron después, como se describe arriba; sigue pendiente la prueba prolongada en un servidor. Las pruebas locales no garantizan disponibilidad de YouTube ni SoundCloud.
 20: 
 21: `npm run deploy:check` también pasó: valida localmente las 19 definiciones, comprueba que sus nombres sean únicos y muestra una huella SHA-256 del contenido. No realiza llamadas a Discord ni requiere credenciales válidas. El registro real devuelve código 1 ante errores de configuración o API, oculta credenciales en los diagnósticos y comprueba que Discord devuelva los comandos esperados. Los casos de éxito y rechazo de la API se probaron con respuestas simuladas, sin registrar comandos reales.
 22: 
 23: ### Validación del ciclo de voz y operaciones simultáneas
 24: 
 25: Se añadieron 12 pruebas con `QueueManager`, `Queue` y el bloqueo de tareas reales de DisTube, usando una conexión de voz simulada. No se conectan a Discord ni descargan audio. Esta capa permitió reproducir y corregir los siguientes casos:
 26: 
 27: | Caso | Resultado verificado |
 28: | --- | --- |
 29: | Error de voz después de detener la cola | Lo absorbe un observador permanente; no se convierte en una excepción sin manejador ni revive la reproducción. |
 30: | Error al cerrar el audio de una solicitud agotada | La frontera del evento captura el fallo y la cola se retira incluso si falla `voice.stop`. |
 31: | Errores duplicados del mismo stream | Se consume un solo intento y no se adelanta la cola. |
 32: | Fin de audio antiguo durante Siguiente o seek | Se vuelve a comprobar canción, recurso y sesión después de esperar las operaciones pendientes; no se salta una segunda canción ni se termina el recurso nuevo. |
 33: | Eventos de fin duplicados | Comparten una sola transición pendiente, sin dejar tareas bloqueadas. |
 34: | Cola bloqueada o sesión reemplazada | Los callbacks antiguos no retiran la cabecera ni afectan a la sesión siguiente. |
 35: | Detector, pausa y seek | El detector usa el mismo presupuesto de recuperación; la pausa no cuenta y seek concede los doce segundos para audio nuevo. |
 36: | Cien sesiones sucesivas | Se liberan los manejadores de cola, las tareas y el estado del monitor; queda un único observador de errores tardíos por voz. |
 37: 
 38: Detener manualmente ya no registra la canción como completada por un evento de fin tardío. Cancelar una recuperación para pasar a otra canción limpia su indicador de intento; los callbacks de una cola cerrada no vuelven a incorporarla al monitor.
 39: 
 40: Estos resultados amplían la validación local. La prueba de uso posterior del usuario terminó sin problemas; sigue sin documentarse una prueba prolongada de reproducción real.
 41: 
 42: ### Validación de persistencia y restauración
 43: 
 44: Se añadieron diez casos de regresión con checkpoints en directorios temporales y consultas controladas, sin conectar el bot. Las 18 pruebas de restauración verifican también el método real `Queue.setRepeatMode` de la versión instalada de DisTube: repetir una asignación del mismo modo lo desactiva. La recuperación aplica ese ajuste solo cuando difiere.
 45: 
 46: - Cerrar durante la consulta de un canal o plugin impide iniciar después la reproducción guardada y conserva el checkpoint.
 47: - Una sesión manual creada durante la consulta conserva canciones y ajustes propios. Si se detiene antes de terminar la consulta, la restauración pendiente queda cancelada; si se cierra el proceso, se guarda esa sesión manual.
 48: - Una cola sustituta no recibe ajustes ni pausas de una recuperación anterior. Los eventos tardíos de reproducción, incorporaciones y fin no sobrescriben su checkpoint.
 49: - Dos solicitudes simultáneas de restauración comparten una operación. Cerrar el almacén varias veces es seguro y retira sus seis manejadores de eventos, sin acumularlos en las siguientes inicializaciones.
 50: 
 51: Estas comprobaciones cubren la lógica local de restauración. La activación confirmó la recuperación de una cola normal con conexión real a Discord; sigue pendiente probar una cola bloqueada en un entorno de pruebas.
 52: 
 53: ### Recuperación del guardado del historial
 54: 
 55: Se corrigió un caso en el que el historial permanecía en memoria después de un fallo de escritura, aunque el disco volviera a estar disponible. Ahora mantiene los cambios pendientes y vuelve a intentar guardarlos a los 60 segundos sin necesitar otra canción. Los errores consecutivos respetan esa espera; las entradas siguen sujetas a los límites de retención y se revisan antes de cada escritura.
 56: 
 57: El cierre cancela el temporizador, espera la escritura en curso y hace un último intento si quedan cambios pendientes, incluso dentro de la espera de 60 segundos. Si el disco sigue fallando, informa del fallo sin programar más reintentos. El límite general de cierre del proceso sigue siendo de cinco segundos.
 58: 
 59: Nueve pruebas con archivos temporales y reloj simulado comprueban recuperación automática, fallos persistentes, conservación del archivo anterior si falla el reemplazo, escrituras simultáneas con el cierre y caducidad tras una interrupción prolongada. Una prueba adicional dentro de esos nueve casos usa un proceso local para verificar que el temporizador pendiente no impide su salida; no conecta un bot a Discord.
 60: 
 61: ### Evitar instancias duplicadas
 62: 
 63: El arranque reserva una instancia por `CLIENT_ID` en el equipo antes de importar el bot o conectar a Discord. En Windows usa una tubería local con nombre; en otros sistemas, un puerto de localhost derivado del identificador. La reserva se libera al cerrar o morir el proceso, sin archivos de bloqueo que haya que borrar.
 64: 
 65: Una segunda copia termina con código 79 y un diagnóstico explícito. El supervisor no vuelve a arrancarla en bucle ni detiene a la primera. La protección se aplica también a `dev` y `start:once`. Trece pruebas adicionales verifican arranques concurrentes, procesos distintos, liberación tras un cierre forzado, salida del supervisor, interacciones vencidas o ya atendidas y redacción de credenciales sin ocultar frases normales como “Bot Voice State”.
 66: 
 67: Los errores de interacción 10062 y 40060 se registran como advertencia y no provocan otro intento de respuesta. Otros fallos conservan su manejo habitual.
 68: 
 69: Esta protección y el ajuste de interacciones quedaron compilados después de arrancar la instancia de la terminal. Se indicó reiniciar para cargarlos; la confirmación posterior de uso satisfactorio no especifica si hubo reinicio. Si sigue activo el proceso anterior, pulsa `Ctrl+C`, espera a que termine y ejecuta `npm run start` cuando se pueda interrumpir la música. No hace falta registrar comandos de nuevo. Compilar no recarga el proceso activo; no inicies una copia adicional para probar la protección mientras siga funcionando la versión anterior.
 70: 
 71: ## Configuración
 72: 
 73: | Variable | Predeterminado | Efecto |
 74: | --- | --- | --- |
 75: | `AUDIO_WATCHDOG_ENABLED` | `true` | `false` desactiva solo la detección de falta de avance. |
 76: | `AUDIO_BREAKER_ENABLED` | `true` | `false` desactiva solo el bloqueo por fallos consecutivos. |
 77: | `LOG_MAX_BYTES` | `10485760` | Tamaño por archivo; entero de 1 a 104857600. |
 78: | `LOG_BACKUPS` | `5` | Archivos anteriores por proceso; entero de 1 a 20. |
 79: 
 80: Las variables se leen al arrancar desde el entorno o `.env`. Si desactivas el freno, una cola que ya estaba bloqueada sigue esperando Reintentar o Detener: la configuración no debe reanudarla sin una acción explícita.
 81: 
 82: El detector observa cada dos segundos el avance del recurso, sin analizar el volumen musical. Permite ocho segundos sin avance después de empezar y doce segundos para el primer audio, también después de seek. Durante una extracción respeta los límites existentes. Detectar no significa completar todos los reintentos dentro de ese plazo.
 83: 
 84: El freno cuenta solicitudes agotadas, no cada intento. Tres fallos en cinco minutos bloquean la cola. Una canción completada o 30 segundos de audio continuo cortan la racha. Reintentar o `/resume` permiten una solicitud nueva con dos renovaciones y una alternativa; si se agota, vuelve a bloquearse inmediatamente.
 85: 
 86: ## Datos y diagnóstico
 87: 
 88: - `data/queues.json`: orden, posición aproximada, ajustes y bloqueo. Se conserva al cerrar normalmente; `/stop` elimina esa cola. Un canal vacío no se recupera automáticamente.
 89: - `data/history.json`: completadas, saltadas y fallidas. Hasta 100 por servidor durante siete días, 2000 globales y 2.5 MB. Conserva enlaces públicos de origen reconocidos, nunca enlaces temporales de audio.
 90: - `logs/bot.jsonl` y `logs/supervisor.jsonl`: fecha, nivel y mensajes con enlaces y credenciales ocultos. Cinco archivos anteriores y 10 MiB por archivo de forma predeterminada, unos 120 MiB entre ambos procesos. Una cola de escritura limitada evita acumular memoria si el disco falla.
 91: - `logs/deploy.jsonl`: diagnóstico separado de comprobación y registro de comandos, con la misma rotación (hasta unos 60 MiB adicionales con los valores predeterminados).
 92: - `/estado`: privado, con fuente real, conexión, progreso e incidente. La referencia relaciona diagnóstico, historial y registros `[Incidente]`.
 93: - `/historial`: privado, con páginas de cinco entradas. Volver a intentar añade una solicitud nueva, exige canal de voz y limita dobles clics a uno cada 30 segundos por entrada y servidor.
 94: 
 95: Conserva `data` entre versiones. No publiques `.env` ni las copias de datos. Un disco que no permite guardar deja disponible el estado en memoria y la consola, pero no asegura persistencia tras un cierre.
 96: 
 97: ## Activación durante mantenimiento
 98: 
 99: 1. Conserva una revisión o copia verificada de la versión anterior. Guarda el estado del repositorio con `git status` y la referencia con `git rev-parse HEAD`; comprueba que esa referencia corresponde a la versión que quieres poder restaurar.
100: 2. Ejecuta `npm test` y `npm run deploy:check`. No arrancan el bot de Discord ni registran comandos. Si hay fallos, corrígelos antes de activar. Conserva la huella mostrada por la comprobación para compararla con el registro real.
101: 3. Cuando puedas interrumpir brevemente la música, detén el supervisor actual con `Ctrl+C`. Espera a que termine. Esto guarda el checkpoint; no uses `/stop` si deseas recuperar la cola.
102: 4. Copia `data` a una carpeta de respaldo fuera del repositorio. Por ejemplo, desde la raíz, con la instancia detenida:
103: 
104:    ```powershell
105:    $musicBackup = Join-Path (Split-Path -Parent (Get-Location).Path) ("discord-music-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
106:    New-Item -ItemType Directory -Path $musicBackup
107:    if (Test-Path -LiteralPath .\data) { Copy-Item -LiteralPath .\data -Destination $musicBackup -Recurse }
108:    git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $musicBackup "revision.txt")
109:    ```
110: 
111: 5. Registra los comandos nuevos en el servidor configurado: `npm run deploy`. Comprueba que muestre la misma huella y confirme el registro. Si falla, termina con código 1: revisa el motivo antes de continuar o restaura la versión anterior. No necesita iniciar otra instancia del bot. La API tiene un límite de 15 segundos por intento y dos reintentos ante fallos temporales; los límites de solicitudes se rechazan para permitir decidir cuándo volver a intentar.
112: 6. Inicia una sola instancia con `npm run start`. Comprueba la conexión y `/estado`; reproduce una canción y prueba Cola, historial, Siguiente y Detener. Las posiciones de `/remove` y `/move` empiezan en 1 para la primera pendiente. `/clear` conserva la canción actual.
113: 7. En un servidor de pruebas, comprueba pausas largas, seek y una reproducción prolongada; vigila referencias repetidas, crecimiento de logs y desconexiones. No uses una playlist de producción para provocar fallos de forma deliberada.
114: 
115: El estado guardado conserva un bloqueo al reiniciar y solo recupera canales accesibles con personas. Si una plataforma rechaza el acceso, la nueva versión puede conservar la cola y ofrecer alternativas, pero no garantiza reproducir ese contenido.
116: 
117: ## Volver a la versión anterior
118: 
119: 1. Detén la nueva instancia con `Ctrl+C` y espera a que termine. Conserva una copia aparte de sus datos y registros para diagnosticar el problema.
120: 2. Recupera la revisión o copia verificada anterior en un directorio preparado para ella; instala sus dependencias con `npm ci` y compila con `npm run build`. No descartes cambios locales para hacer la vuelta atrás.
121: 3. Restaura la copia de `data` tomada antes de activar. El campo `blocked` es opcional y el nuevo código acepta checkpoints antiguos. Una versión anterior puede ignorar ese campo, por lo que usar un checkpoint nuevo bloqueado podría hacer que vuelva a recorrer la cola fallida. Mantén aparte el historial nuevo si la versión anterior no lo utiliza.
122: 4. Ejecuta `npm run deploy` desde esa versión para restaurar su conjunto de comandos y arranca una sola instancia con `npm run start`.
123: 5. Comprueba conexión, reproducción y controles. Las posiciones del checkpoint son aproximadas y restaurar una copia anterior pierde los cambios hechos después de esa copia.
124: 
125: Para aislar un problema del detector o del freno sin volver atrás, puedes desactivar la opción correspondiente y reiniciar durante mantenimiento. Los errores operativos siguen capturados y el supervisor mantiene la protección del proceso.
````

## File: docs/PLAN_MEJORAS.md
````markdown
  1: # Plan de mejoras del bot de música
  2: 
  3: Estado al 8 de octubre de 2026: las entregas 1 a 6 están implementadas. La entrega 7 incluye respaldo, registro real de los 19 comandos y activación autorizada a las 20:24 (Ciudad de México). Se confirmó la recuperación de siete canciones y cinco minutos de avance real sin errores registrados. Después se detectaron dos instancias activas: se cerró la copia en segundo plano y se conservó la de la terminal. La nueva protección contra duplicados está compilada y probada; requiere arrancar la versión nueva. El usuario confirmó posteriormente una prueba de uso sin problemas y la portada visible. Siguen sin documentarse una prueba prolongada y la recuperación real de una cola bloqueada.
  4: 
  5: ## Objetivo y punto de partida
  6: 
  7: Completar las siete mejoras propuestas, dando prioridad a la continuidad de la música, la conservación de la cola y los errores recuperables. Mantener el panel con portada elegido y preparar cada entrega para un reinicio de mantenimiento.
  8: 
  9: El repositorio ya tiene supervisor del proceso, recuperación de colas, búsquedas alternativas, reintentos limitados del audio, avisos editables y un panel por sesión. `/shuffle` y `/remove` también existen: necesitan mejoras, no una segunda implementación. La cola ya muestra duración pendiente; falta estimar cuándo empieza cada canción y representar los nuevos estados.
 10: 
 11: La referencia inicial fue de 113 pruebas aprobadas. La implementación añade pruebas del detector, bloqueo, historial, gestión simultánea, permisos, persistencia y límites de disco. El resultado final y los pasos de activación se documentan en [OPERACION.md](OPERACION.md).
 12: 
 13: ## Orden de trabajo
 14: 
 15: | Entrega | Mejoras incluidas | Depende de |
 16: | --- | --- | --- |
 17: | 1 | Registros con rotación y estado compartido de reproducción | Código actual |
 18: | 2 | Detector de audio atascado y freno de fallos consecutivos | 1 |
 19: | 3 | Comando privado `/estado` | 1 y 2 |
 20: | 4 | Gestión de cola: reforzar `/shuffle` y `/remove`; añadir `/clear` y `/move` | 2 |
 21: | 5 | Historial y botón Volver a intentar | 1, 2 y 4 |
 22: | 6 | Estados visuales y tiempos estimados | 2, 4 y 5 |
 23: | 7 | Validación integrada y despliegue gradual | Todas |
 24: 
 25: Los valores numéricos siguientes son los implementados. Podrán ajustarse tras la validación en el servidor de pruebas.
 26: 
 27: ## Resultado de implementación
 28: 
 29: - Registros JSONL asíncronos con rotación, redacción de credenciales y referencias de incidentes; archivos separados para bot y supervisor.
 30: - Estado por sesión, detector de 8/12 segundos y freno de tres solicitudes fallidas en cinco minutos. Reintento manual controlado y bloqueo conservado al reiniciar.
 31: - `/estado` privado, `/historial` paginado y reintentos desde enlaces públicos, con límites de retención y deduplicación.
 32: - `/clear` y `/move`, además de `/shuffle` y `/remove` reforzados. Comprobaciones del canal de voz, operaciones ordenadas y descarte de resultados tardíos.
 33: - Portada grande conservada, estados del audio, historial y Reintentar en el panel, inicio aproximado de pendientes y tiempo restante del ciclo actual.
 34: - Pruebas de recuperación integrada, dos servidores, pausas, callbacks tardíos, componentes de Discord, errores de disco, restauración bloqueada y una hora de avance de audio con reloj simulado. La hora simulada no equivale a una hora de reproducción real en Discord.
 35: - Preparación de activación reforzada: `deploy:check` comprueba los 19 comandos sin contactar con Discord. El registro real falla con código 1 si hay problemas y verifica la respuesta de la API. La suite completa tiene 200 pruebas aprobadas. Discord confirmó el registro real y el usuario informó de una prueba de uso satisfactoria; sigue sin documentarse una prueba prolongada.
 36: - Doce pruebas adicionales con la cola y el bloqueo reales de DisTube, y voz simulada, cubren errores tardíos de voz, cierre fallido, errores y finales duplicados, Siguiente y seek simultáneos con el fin del audio, sesiones reemplazadas y cien sesiones sucesivas. Se corrigieron los fallos reproducidos: una excepción tardía sin manejador y el avance indebido de la cola por eventos antiguos.
 37: - Diez pruebas adicionales de persistencia y restauración cubren cierre durante consultas pendientes, sesiones manuales que sustituyen o cancelan la restauración, eventos antiguos, solicitudes de restauración concurrentes y limpieza de manejadores. Se comprobó además el método real `Queue.setRepeatMode`: aplicar el mismo modo dos veces lo desactiva; la restauración ahora conserva el ajuste.
 38: - Nueve pruebas adicionales de persistencia del historial cubren fallos de disco y reemplazo atómico, recuperación sin nuevas canciones, cambios durante una escritura y cierre. Un error conserva los cambios pendientes y programa un reintento a los 60 segundos, con un solo temporizador. Al cerrar se cancela y se realiza un último intento; el temporizador no mantiene vivo el proceso.
 39: - La activación detectó que los checkpoints no conservaban la portada. Se añadió su persistencia para imágenes públicas sin credenciales ni parámetros y una portada de YouTube deducida del ID para checkpoints antiguos, sin búsquedas adicionales. Dos pruebas nuevas y la restauración existente verifican el ajuste. El usuario confirmó que la portada se ve en Discord; no especificó si probó una restauración.
 40: - El incidente de instancias duplicadas motivó una reserva local por `CLIENT_ID` antes de conectar a Discord. La segunda copia termina con código 79, sin bucle de reinicios. Trece pruebas adicionales cubren la reserva entre procesos y su liberación, el supervisor, respuestas vencidas o ya atendidas y el filtro de credenciales. La copia anterior en segundo plano quedó cerrada; la protección nueva requiere iniciar la versión compilada posterior. La prueba de uso comunicada por el usuario no especifica si hubo reinicio.
 41: 
 42: La configuración y la secuencia de activación y vuelta atrás están en [OPERACION.md](OPERACION.md). Se mantienen a continuación el alcance y los criterios de aceptación de cada entrega.
 43: 
 44: ## Entrega 1: registros y estado compartido
 45: 
 46: - Crear un registro común de eventos con fecha, nivel, servidor, sesión, canción, operación, código y resultado. Asignar una referencia de incidente para relacionar `/estado`, historial y consola.
 47: - Guardar registros en `logs/`, además de conservar la salida de consola. Proponer archivos de hasta 10 MB y cinco archivos anteriores, con límites configurables.
 48: - Ocultar tokens, cookies, cabeceras, enlaces de webhooks y parámetros sensibles. No guardar objetos completos de interacciones ni enlaces temporales de audio.
 49: - Hacer las escrituras fuera de la ruta crítica de reproducción, con una cola de escritura limitada. Si el disco falla o se llena, continuar por consola sin recursión ni acumulación ilimitada.
 50: - Incluir los fallos fatales y los reinicios del supervisor; definir un cierre de logs con tiempo máximo para que nunca bloquee el cierre del bot.
 51: - Mantener un estado por sesión: preparando, reproduciendo, pausado, recuperando, bloqueado por fallos, finalizado o desconectado. Compartirlo entre recuperación, diagnóstico y panel.
 52: - Liberar temporizadores, referencias y tareas cuando termina una sesión. Distinguir cada incorporación a la cola, aunque dos canciones tengan la misma URL.
 53: 
 54: **Aceptación:** un error se puede seguir por su referencia; los registros rotan dentro del límite; un fallo al escribirlos no afecta al audio; una sesión nueva no hereda operaciones de la anterior.
 55: 
 56: ## Entrega 2: continuidad del audio
 57: 
 58: ### Detector de reproducción atascada
 59: 
 60: - Comprobar cada dos segundos si avanza el recurso de audio, incluso cuando DisTube no emite un error. Detectar falta de frames, no silencio musical.
 61: - Proponer ocho segundos sin avance para iniciar la recuperación de audio que ya estaba reproduciéndose; con el intervalo de comprobación, la detección ocurre aproximadamente entre ocho y diez segundos. Al arrancar una canción o cambiar el recurso por un seek, permitir hasta doce segundos para recibir el primer audio, sin sumar después otra espera de ocho segundos. Descontar las pausas manuales y reconocer desconexiones.
 62: - Distinguir el plazo de detección del tiempo de los reintentos: detectar el atasco inicia la recuperación existente, no garantiza que la música vuelva dentro de ocho segundos.
 63: - Si ya hay una extracción o recuperación pendiente, respetar su plazo y no iniciar otra en paralelo.
 64: - Conectar el detector al mismo mecanismo de recuperación existente: dos renovaciones y una búsqueda de alternativa, sin multiplicar presupuestos ni crear ciclos nuevos.
 65: - Una recuperación agotada salta la canción o termina la cola vacía. Una sesión que queda sin voz se informa como desconectada.
 66: - Siguiente, Detener, seek y los cambios de sesión deben invalidar las observaciones anteriores. El detector no debe reiniciar todo el proceso por un fallo de una sola cola.
 67: 
 68: ### Freno de fallos consecutivos
 69: 
 70: - Contar canciones que agotaron su recuperación, una sola vez por solicitud. No contar cada reintento como una canción fallida.
 71: - Proponer el bloqueo tras tres canciones fallidas consecutivas dentro de cinco minutos. Una canción completada correctamente, o 30 segundos de audio continuo, corta la racha.
 72: - Al bloquear, conservar las canciones pendientes y frenar el avance automático y la radio. Integrar ese freno en el inicio de reproducción; pausar únicamente el reproductor no basta para detener los manejadores automáticos de DisTube.
 73: - Mostrar un único aviso con la causa y las opciones Reintentar y Detener. Reintentar permite una prueba controlada; si vuelve a fallar, mantener el bloqueo.
 74: - Mantener Detener disponible y distinguir este bloqueo de una pausa manual. Guardar el estado bloqueado con el checkpoint para que un reinicio no vuelva a recorrer una playlist que está fallando.
 75: - Respetar la espera por fuente que ya existe para HTTP 403/429.
 76: 
 77: **Aceptación:** no hay recuperaciones simultáneas de una misma solicitud; la pausa no dispara alarmas; una playlist con fallos deja de consumirse; otras colas del bot siguen funcionando; ningún temporizador revive una cola detenida.
 78: 
 79: ## Entrega 3: `/estado`
 80: 
 81: - Añadir una respuesta privada con conexión a Discord, tiempo activo, conexión de voz del servidor, canción, fuente real y estado de reproducción.
 82: - Mostrar recuperación en curso, intento, último progreso de audio, racha de fallos y último error con su referencia y hora.
 83: - Usar el estado local, sin lanzar búsquedas ni comprobaciones externas cada vez que se consulte.
 84: - Mostrar solo información del servidor actual y omitir secretos, trazas completas y rutas del equipo. Informar claramente cuando una medida no esté disponible.
 85: 
 86: **Aceptación:** el comando responde aunque no exista una cola o la fuente esté fallando; sus datos coinciden con los del panel y los registros.
 87: 
 88: ## Entrega 4: gestión de la cola
 89: 
 90: - Reforzar `/shuffle` y `/remove` con validación de usuario en el canal de voz del bot, respuestas tempranas, actualización del panel y guardado del cambio.
 91: - Añadir `/clear` para quitar solo las canciones pendientes. La canción actual continúa; `/stop` conserva su función de detener toda la sesión.
 92: - Añadir `/move origen destino` para mover canciones pendientes, con la misma numeración que muestra `/queue`: la primera pendiente es la posición 1.
 93: - Proteger la canción actual y la cabecera retenida durante una recuperación. Realizar cambios de forma ordenada respecto a Siguiente, búsquedas y otros comandos.
 94: - Evitar que trabajos de precalentamiento o recomendaciones terminados tarde vuelvan a añadir elementos retirados.
 95: - Revisar la política de permisos en todos los comandos que alteran reproducción. Validar de nuevo la sesión y las posiciones al ejecutar una acción que haya esperado.
 96: - Mantener el guardado de cola consistente y ajustar las páginas después de quitar o mover canciones.
 97: 
 98: **Aceptación:** ningún cambio afecta a otra sesión ni elimina la canción actual por confusión de índices; dos operaciones simultáneas producen un orden válido; el nuevo orden se conserva al reiniciar.
 99: 
100: ## Entrega 5: historial y reintento manual
101: 
102: - Añadir `/historial` privado, paginado, con las últimas canciones completadas, saltadas y fallidas, su hora y motivo.
103: - Conservar hasta 100 entradas por servidor durante siete días, con un límite global de almacenamiento. Guardar de forma atómica y tolerar archivos dañados.
104: - Registrar una sola entrada final por solicitud. Relacionar una alternativa con la canción originalmente solicitada y mostrar qué fuente llegó a reproducirse.
105: - Añadir Volver a intentar para incorporar una nueva solicitud al final de la cola, con un presupuesto nuevo y limitado. Obtener audio fresco; no reutilizar enlaces temporales.
106: - Si no hay sesión, permitir crear una desde el canal de voz del usuario con las mismas comprobaciones que `/play`. Si existe, exigir que esté en el canal del bot.
107: - Usar identificadores de entrada estables en los botones, controlar dobles clics y rechazar entradas vencidas o de otro servidor.
108: - Guardar únicamente los datos necesarios y enlaces públicos de origen. Desactivar el reintento cuando no se conserve un origen reproducible seguro.
109: 
110: **Aceptación:** un fallo con varios reintentos deja una sola entrada; dos clics simultáneos no duplican la solicitud; un archivo de historial dañado no impide iniciar ni reproducir.
111: 
112: ## Entrega 6: mejoras visuales
113: 
114: - Conservar portada grande, un panel por sesión y los controles actuales.
115: - Mostrar estados coherentes con el audio: preparando, reproduciendo, pausado, buscando alternativa, bloqueado por fallos o desconectado. Evitar mostrar Reproduciendo solo porque arrancó FFmpeg.
116: - Integrar acceso al historial y a la recuperación bloqueada sin repetir controles ni crear identificadores duplicados.
117: - Mostrar espera aproximada por canción: tiempo restante de la actual más la duración de las anteriores. Actualizar al saltar, mover, mezclar, quitar o buscar otra versión.
118: - Identificar la estimación como aproximada. Con pausa, mostrar tiempo desde la reanudación; con duración desconocida, emisión en vivo, recuperación o repetición que impide avanzar, indicar que no se puede estimar.
119: - Conservar la duración total pendiente que ya existe y distinguirla del tiempo total restante de la sesión. No inventar una duración para futuras canciones de la radio.
120: - Mantener ediciones agrupadas, evitar escrituras si no cambia el contenido y respetar el intervalo y la espera tras fallos de Discord del panel actual.
121: 
122: **Aceptación:** portada y controles siguen funcionando; los tiempos se recalculan correctamente; los botones viejos caducan; los fallos de edición no frenan la música ni generan mensajes repetidos.
123: 
124: ## Entrega 7: pruebas y activación
125: 
126: 1. Ejecutar la suite actual como referencia y añadir pruebas de los comportamientos nuevos en cada entrega. Usar relojes controlados para esperas largas.
127: 2. Probar audio detenido sin evento de error, pausas largas, seek, fuentes bloqueadas, agotamiento de alternativas y rachas de fallos.
128: 3. Probar Siguiente, Detener, edición de cola y reintento mientras hay búsquedas pendientes; incluir dos servidores y sesiones reemplazadas.
129: 4. Probar permisos de Discord, mensajes borrados, interacciones vencidas y límites de componentes. Simular disco lleno, errores de rotación y datos guardados dañados.
130: 5. Probar reinicio con una cola normal y con una cola bloqueada. Comprobar que no se pierden pendientes ni se generan nuevas tormentas de solicitudes.
131: 6. Realizar una prueba prolongada en un bot o servidor de pruebas con logs acotados, temporizadores estables y reproducción controlada. Un segundo bot necesita sus propias credenciales.
132: 7. Preparar la compilación, la documentación de configuración y los nuevos comandos. Registrar estos con `npm run deploy` durante la activación acordada.
133: 8. Activar en mantenimiento: conservar la versión anterior y los datos, detener la instancia, iniciar la nueva y verificar `/estado`, `/play`, Cola, Siguiente y Detener. No ejecutar dos instancias del mismo bot para simular una actualización sin corte.
134: 9. Permitir desactivar el detector y el freno automático por configuración. Mantener formatos de datos compatibles o una migración que permita volver a la versión anterior.
135: 
136: La implementación se puede preparar y probar mientras el usuario usa el bot. `npm run start` no recarga archivos; aplicar el código requerirá un reinicio cuando el usuario esté listo. Las comprobaciones y las recuperaciones reducen interrupciones, pero las restricciones de las plataformas pueden seguir impidiendo reproducir una canción.
````

## File: src/commands/play.ts
````typescript
  1: import { ButtonInteraction, ChatInputCommandInteraction, GuildTextBasedChannel, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
  2: import { DisTubeError, isURL, PlayOptions, Song } from 'distube';
  3: import { Command } from './command.types';
  4: import { resolveAppleMusic } from '../utils/appleMusic';
  5: import { PlaybackMetadata, SearchSource, YtDlpSearchPlugin } from '../music/ytDlpSearchPlugin';
  6: import { describeMusicError } from '../music/errors';
  7: import { ensureControlChannel, ensureGuild } from '../utils/guard';
  8: import { BotColors } from '../utils/colors';
  9: import { fetchSearchSuggestions } from '../utils/suggestions';
 10: import { getPlaybackState } from '../music/playbackState';
 11: 
 12: function isGuildTextChannel(channel: unknown): channel is GuildTextBasedChannel {
 13:   if (typeof channel !== 'object' || channel === null) return false;
 14:   const candidate = channel as { guild?: unknown; send?: unknown };
 15:   return candidate.guild !== undefined && typeof candidate.send === 'function';
 16: }
 17: 
 18: function parseSearchSource(value: string | null): SearchSource {
 19:   return value === 'soundcloud' ? 'soundcloud' : 'youtube';
 20: }
 21: 
 22: export const play: Command = {
 23:   data: new SlashCommandBuilder()
 24:     .setName('play')
 25:     .setDescription('Reproduce YouTube, SoundCloud, Spotify, Apple Music y URLs compatibles')
 26:     .addStringOption((opt) =>
 27:       opt
 28:         .setName('query')
 29:         .setDescription('URL o nombre de la canción')
 30:         .setRequired(true)
 31:         .setAutocomplete(true),
 32:     )
 33:     .addStringOption((opt) =>
 34:       opt
 35:         .setName('fuente')
 36:         .setDescription('Fuente para búsquedas por nombre o enlaces de metadata')
 37:         .addChoices(
 38:           { name: 'YouTube', value: 'youtube' },
 39:           { name: 'SoundCloud', value: 'soundcloud' },
 40:         ),
 41:     ) as SlashCommandBuilder,
 42: 
 43:   async autocomplete(interaction) {
 44:     const focusedValue = interaction.options.getFocused();
 45:     if (!focusedValue || focusedValue.trim().length < 2) {
 46:       await interaction.respond([]);
 47:       return;
 48:     }
 49: 
 50:     const suggestions = await fetchSearchSuggestions(focusedValue);
 51:     await interaction.respond(
 52:       suggestions.map((s) => ({
 53:         name: s.slice(0, 100),
 54:         value: s.slice(0, 100),
 55:       })),
 56:     );
 57:   },
 58: 
 59:   async execute(interaction) {
 60:     await playRequest(interaction, interaction.options.getString('query', true), parseSearchSource(interaction.options.getString('fuente')));
 61:   },
 62: };
 63: 
 64: export async function playRequest(interaction: ChatInputCommandInteraction | ButtonInteraction, rawQuery: string, searchSource: SearchSource, privateReply = false): Promise<void> {
 65:     const guild = await ensureGuild(interaction);
 66:     if (!guild) return;
 67: 
 68:     const member = guild.members.cache.get(interaction.user.id);
 69:     const voiceChannel = member?.voice.channel;
 70: 
 71:     if (!voiceChannel) {
 72:       await interaction.reply({
 73:         embeds: [
 74:           new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ Debes estar en un canal de voz.'),
 75:         ],
 76:         flags: MessageFlags.Ephemeral,
 77:       });
 78:       return;
 79:     }
 80: 
 81:     const permissions = voiceChannel.permissionsFor(interaction.client.user!.id);
 82:     const missingPermissions = [
 83:       { flag: 'ViewChannel', label: 'Ver canal' },
 84:       { flag: 'Connect', label: 'Conectar' },
 85:       { flag: 'Speak', label: 'Hablar' },
 86:     ] as const;
 87:     const missing = missingPermissions.filter(({ flag }) => !permissions?.has(flag));
 88:     if (missing.length > 0) {
 89:       await interaction.reply({
 90:         embeds: [
 91:           new EmbedBuilder()
 92:             .setColor(BotColors.Error)
 93:             .setDescription(`❌ **Faltan permisos en el canal de voz:** ${missing.map(({ label }) => label).join(', ')}.\n💡 Revisa el rol del bot y las excepciones de ese canal.`),
 94:         ],
 95:         flags: MessageFlags.Ephemeral,
 96:       });
 97:       return;
 98:     }
 99: 
100:     const distube = interaction.client.distube;
101:     const initialQueue = distube.getQueue(guild.id);
102:     if (initialQueue && !await ensureControlChannel(interaction, initialQueue)) return;
103:     const revision = initialQueue ? getPlaybackState(initialQueue)?.revision : undefined;
104:     if (!interaction.deferred && !interaction.replied) await interaction.deferReply(privateReply ? { flags: MessageFlags.Ephemeral } : {});
105: 
106:     try {
107:       const resolved = await resolveAppleMusic(rawQuery);
108: 
109:       const displayQuery = resolved.isAppleMusic && resolved.artist && resolved.title
110:         ? `${resolved.artist} - ${resolved.title}`
111:         : rawQuery;
112: 
113:       await interaction.editReply({
114:         embeds: [
115:           new EmbedBuilder().setColor(BotColors.Gold).setDescription(`🔍 Buscando: **${displayQuery}**...`),
116:         ],
117:       });
118: 
119:       const playOptions: PlayOptions<PlaybackMetadata> = {
120:         member: member!,
121:         metadata: { searchSource },
122:       };
123:       const textChannel = isGuildTextChannel(interaction.channel) ? interaction.channel : undefined;
124: 
125:       if (textChannel) {
126:         playOptions.textChannel = textChannel;
127:       }
128: 
129:       // DisTube replaces search errors with NO_RESULT, discarding the actual cause.
130:       // Resolve text here so network and platform errors reach the user intact.
131:       let input: string | Song<PlaybackMetadata> = resolved.query;
132:       if (!isURL(input)) {
133:         const plugin = distube.plugins.find((item): item is YtDlpSearchPlugin => item instanceof YtDlpSearchPlugin);
134:         if (!plugin) throw new DisTubeError('NO_EXTRACTOR_PLUGIN');
135:         const song = await plugin.searchSong(input, playOptions);
136:         if (!song) throw new DisTubeError('CANNOT_RESOLVE_SONG', input);
137:         input = song;
138:       }
139: 
140:       if (distube.getQueue(guild.id) !== initialQueue || initialQueue?.stopped || (initialQueue && getPlaybackState(initialQueue)?.closing) ||
141:         (initialQueue && getPlaybackState(initialQueue)?.revision !== revision) || member?.voice.channel?.id !== voiceChannel.id) {
142:         await interaction.editReply({ content: 'La sesión, la cola o tu canal de voz cambió mientras buscaba. Vuelve a intentarlo.', embeds: [], components: [] });
143:         return;
144:       }
145:       await distube.play<PlaybackMetadata>(voiceChannel, input, playOptions);
146:     } catch (error: unknown) {
147:       console.error('Error en /play:', error);
148: 
149:       const description = describeMusicError(error, { source: searchSource });
150: 
151:       const content = {
152:         embeds: [
153:           new EmbedBuilder()
154:             .setColor(BotColors.Error)
155:             .setDescription(description),
156:         ],
157:       };
158:       if (interaction.deferred) {
159:         await interaction.editReply(content);
160:       } else {
161:         await interaction.reply({ ...content, flags: MessageFlags.Ephemeral });
162:       }
163:     }
164: }
````

## File: src/utils/embed.ts
````typescript
  1: import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
  2: import { Queue, RepeatMode, Song } from 'distube';
  3: import { BotColors } from './colors';
  4: import { getPlaybackState, playbackLabel } from '../music/playbackState';
  5: 
  6: export enum ButtonId {
  7:   PauseResume = 'btn_pause_resume',
  8:   Skip = 'btn_skip',
  9:   Stop = 'btn_stop',
 10:   Queue = 'btn_queue',
 11:   History = 'btn_history',
 12:   Retry = 'btn_retry',
 13: }
 14: 
 15: export function createPlayerButtons(paused = false, disabled = false, skipDisabled = false, blocked = false): ActionRowBuilder<ButtonBuilder> {
 16:   return new ActionRowBuilder<ButtonBuilder>().addComponents(
 17:     new ButtonBuilder()
 18:       .setCustomId(blocked ? ButtonId.Retry : ButtonId.PauseResume)
 19:       .setEmoji(blocked ? '🔄' : paused ? '▶️' : '⏸️')
 20:       .setLabel(blocked ? 'Reintentar' : paused ? 'Reanudar' : 'Pausar')
 21:       .setStyle(ButtonStyle.Primary).setDisabled(disabled),
 22:     new ButtonBuilder().setCustomId(ButtonId.Skip).setEmoji('⏭️').setLabel('Siguiente')
 23:       .setStyle(ButtonStyle.Secondary).setDisabled(disabled || skipDisabled || blocked),
 24:     new ButtonBuilder().setCustomId(ButtonId.Queue).setEmoji('📋').setLabel('Cola')
 25:       .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
 26:     new ButtonBuilder().setCustomId(ButtonId.Stop).setEmoji('⏹️').setLabel('Detener')
 27:       .setStyle(ButtonStyle.Danger).setDisabled(disabled),
 28:     new ButtonBuilder().setCustomId(ButtonId.History).setEmoji('🕘').setLabel('Historial')
 29:       .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
 30:   );
 31: }
 32: 
 33: export function createProgressBar(currentMs: number, totalMs: number, barLength = 15): string {
 34:   if (!Number.isFinite(totalMs) || totalMs <= 0) return '`🔴 En vivo`';
 35: 
 36:   const position = Number.isFinite(currentMs) ? Math.max(0, Math.min(currentMs, totalMs)) : 0;
 37:   const length = Number.isFinite(barLength) ? Math.max(1, Math.min(30, Math.floor(barLength))) : 15;
 38:   const filled = Math.round(position / totalMs * length);
 39:   const bar = '▰'.repeat(filled) + '▱'.repeat(length - filled);
 40:   return `\`${formatDuration(position)} ${bar} ${formatDuration(totalMs)}\``;
 41: }
 42: 
 43: export function formatDuration(ms: number): string {
 44:   const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
 45:   const hours = Math.floor(totalSeconds / 3600);
 46:   const minutes = Math.floor((totalSeconds % 3600) / 60);
 47:   const seconds = totalSeconds % 60;
 48:   const pad = (n: number) => n.toString().padStart(2, '0');
 49:   if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
 50:   return `${pad(minutes)}:${pad(seconds)}`;
 51: }
 52: 
 53: interface PlayerDetails {
 54:   status?: string | undefined;
 55:   remaining?: string | undefined;
 56:   paused?: boolean;
 57:   volume?: number;
 58:   nextSong?: Song | undefined;
 59:   queued?: number;
 60:   autoplay?: boolean;
 61:   repeatMode?: RepeatMode;
 62:   ended?: string | undefined;
 63: }
 64: 
 65: function httpUrl(value: string | undefined): string | null {
 66:   try {
 67:     const url = new URL(value ?? '');
 68:     return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
 69:   } catch { return null; }
 70: }
 71: 
 72: export function createNowPlayingEmbed(song: Song, currentMs = 0, details: PlayerDetails = {}): EmbedBuilder {
 73:   const status = details.ended ?? details.status ?? (details.paused ? '⏸ En pausa' : '▶ Reproduciendo');
 74:   const audioSource = (song.stream.playFromSource ? song.source : song.stream.song?.source) ?? song.source;
 75:   const audioSong = song.stream.playFromSource ? song : song.stream.song;
 76:   const thumbnail = song.thumbnail ?? audioSong?.thumbnail ??
 77:     (audioSong?.source === 'youtube' && /^[\w-]{11}$/.test(audioSong.id)
 78:       ? `https://i.ytimg.com/vi/${audioSong.id}/hqdefault.jpg` : undefined);
 79:   const source = ({ youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify', apple_music: 'Apple Music' } as Record<string, string>)[audioSource] ?? audioSource;
 80:   const repeat = details.repeatMode === RepeatMode.SONG ? ' · Repetir canción' : details.repeatMode === RepeatMode.QUEUE ? ' · Repetir cola' : '';
 81:   const embed = new EmbedBuilder()
 82:     .setColor(!details.ended && details.paused ? BotColors.Warning : BotColors.Info)
 83:     .setAuthor({ name: status })
 84:     .setTitle((song.name || 'Canción sin título').slice(0, 256))
 85:     .setDescription(details.ended ? 'Añade otra canción con `/play`.' : createProgressBar(currentMs, song.duration * 1000, 12))
 86:     .addFields(
 87:       { name: 'Solicitada por', value: escapeMarkdown((song.member?.displayName || 'Desconocido').slice(0, 80)), inline: true },
 88:       { name: 'Volumen', value: `${details.volume ?? 100} %`, inline: true },
 89:     )
 90:     .setImage(httpUrl(thumbnail))
 91:     .setURL(httpUrl(song.url))
 92:     .setFooter({ text: `${source} · ${details.ended ? 0 : details.queued ?? 0} en espera · Radio ${details.autoplay ? 'activada' : 'desactivada'}${repeat}`.slice(0, 2048) });
 93:   if (!details.ended) {
 94:     if (details.remaining) embed.addFields({ name: 'Tiempo restante de la cola actual', value: details.remaining });
 95:     embed.addFields({ name: 'A continuación', value: details.nextSong
 96:       ? `${escapeMarkdown((details.nextSong.name || 'Canción sin título').slice(0, 180))} · \`${details.nextSong.formattedDuration}\``
 97:       : details.autoplay ? 'Buscaré una canción relacionada al terminar.' : 'No hay canciones en espera.' });
 98:   }
 99: 
100:   return embed;
101: }
102: 
103: export function createAddQueueEmbed(song: Song): EmbedBuilder {
104:   return new EmbedBuilder()
105:     .setColor(BotColors.Info)
106:     .setDescription(`📥 Añadida a la cola: **${song.name ?? 'Canción sin título'}** — \`${song.formattedDuration}\``);
107: }
108: 
109: export const QUEUE_PAGE_SIZE = 10;
110: 
111: export function queueEstimates(queue: Queue): (number | null)[] {
112:   const state = getPlaybackState(queue);
113:   const unavailable = state && ['preparing', 'recovering', 'alternative', 'blocked', 'disconnected'].includes(state.mode);
114:   let seconds: number | null = unavailable || queue.repeatMode === RepeatMode.SONG ? null : 0;
115:   return queue.songs.map((song, index) => {
116:     const start = seconds;
117:     if (!song.duration || !Number.isFinite(song.duration) || song.isLive) seconds = null;
118:     else if (seconds !== null) seconds += index === 0 ? Math.max(0, song.duration - (Number.isFinite(queue.currentTime) ? queue.currentTime : 0)) : song.duration;
119:     return start;
120:   });
121: }
122: 
123: export function queueRemaining(queue: Queue): string {
124:   if (queue.repeatMode === RepeatMode.SONG) return 'Repetición de canción · sin estimación';
125:   const state = getPlaybackState(queue);
126:   if (state && ['preparing', 'recovering', 'alternative', 'blocked', 'disconnected'].includes(state.mode)) return 'Estimación no disponible';
127:   if (queue.songs.some(song => !song.duration || !Number.isFinite(song.duration) || song.isLive)) return 'Duración desconocida o emisión en vivo';
128:   const seconds = queue.songs.reduce((sum, song, index) => sum + (index ? song.duration : Math.max(0, song.duration - (queue.currentTime || 0))), 0);
129:   return `≈ ${formatDuration(seconds * 1000)}${queue.paused ? ' desde la reanudación' : ''}${queue.repeatMode === RepeatMode.QUEUE ? ' · ciclo actual' : ''}`;
130: }
131: 
132: export function queuePage(queue: Queue, requested = 0): { page: number; pages: number } {
133:   const pages = Math.max(1, Math.ceil(Math.max(0, queue.songs.length - 1) / QUEUE_PAGE_SIZE));
134:   const page = Number.isFinite(requested) ? Math.max(0, Math.min(pages - 1, Math.floor(requested))) : 0;
135:   return { page, pages };
136: }
137: 
138: export function createQueueButtons(queue: Queue, session: string, requested = 0): ActionRowBuilder<ButtonBuilder>[] {
139:   const { page, pages } = queuePage(queue, requested);
140:   if (pages === 1) return [];
141:   return [new ActionRowBuilder<ButtonBuilder>().addComponents(
142:     new ButtonBuilder().setCustomId(`queue_page:${session}:${Math.max(0, page - 1)}`).setLabel('Anterior')
143:       .setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
144:     // Disabled buttons also need unique IDs. The indicator must not share the
145:     // previous/next page ID at the first or last page.
146:     new ButtonBuilder().setCustomId(`queue_page_indicator:${session}:${page}`).setLabel(`${page + 1} / ${pages}`)
147:       .setStyle(ButtonStyle.Secondary).setDisabled(true),
148:     new ButtonBuilder().setCustomId(`queue_page:${session}:${Math.min(pages - 1, page + 1)}`).setLabel('Siguiente')
149:       .setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
150:   )];
151: }
152: 
153: export function createQueueEmbed(queue: Queue, requested = 0): EmbedBuilder {
154:   const songs = queue.songs;
155:   const nowPlaying = songs[0];
156: 
157:   if (!nowPlaying) {
158:     return new EmbedBuilder().setColor(BotColors.Error).setDescription('❌ No hay cola de reproducción.');
159:   }
160: 
161:   const { page, pages } = queuePage(queue, requested);
162:   const offset = 1 + page * QUEUE_PAGE_SIZE;
163:   const upcoming = songs.slice(offset, offset + QUEUE_PAGE_SIZE);
164:   const estimates = queueEstimates(queue);
165:   const description = upcoming
166:     .map((song, i) => `${offset + i}. **${escapeMarkdown((song.name || 'Canción sin título').slice(0, 150))}** — \`${song.formattedDuration}\`\n` +
167:       (estimates[offset + i] == null ? 'Inicio sin estimación' : `≈ ${formatDuration(estimates[offset + i]! * 1000)} ${queue.paused ? 'al reanudar' : 'para empezar'}`))
168:     .join('\n');
169:   const remainingTime = songs.slice(1).reduce((total, song) => total + (Number.isFinite(song.duration) ? song.duration : 0), 0);
170:   const remaining = songs.slice(1).some((song) => song.isLive) ? 'Incluye emisiones en vivo' : `${formatDuration(remainingTime * 1000)} en espera`;
171: 
172:   return new EmbedBuilder()
173:     .setColor(BotColors.Info)
174:     .setTitle('🎵 Cola de Reproducción')
175:     .setDescription(
176:       `**${playbackLabel(queue)}:** ${escapeMarkdown((nowPlaying.name || 'Canción sin título').slice(0, 150))} — \`${nowPlaying.formattedDuration}\`\n\n${description || '_No hay canciones en espera._'}`,
177:     )
178:     .setFooter({ text: `${songs.length - 1} en espera · ${remaining} · Página ${page + 1}/${pages}` });
179: }
````

## File: src/events/interactionCreate.ts
````typescript
 1: import { Interaction, MessageFlags, InteractionReplyOptions } from 'discord.js';
 2: import { commands } from '../commands';
 3: import { describeMusicError } from '../music/errors';
 4: import { handleButton } from './buttonHandler';
 5: import { getPlayerPanels } from '../music/playerPanel';
 6: import { ensureControlChannel } from '../utils/guard';
 7: import { checkpointQueue } from '../music/queueChanges';
 8: 
 9: function unavailableInteraction(error: unknown): boolean {
10:   if (typeof error !== 'object' || error === null || !('code' in error)) return false;
11:   const code = Number(error.code);
12:   if (code !== 10062 && code !== 40060) return false;
13:   console.warn(`[Interacción ${code}] La interacción venció o ya fue atendida. No se reenviará la respuesta; comprueba que solo haya una instancia activa.`);
14:   return true;
15: }
16: 
17: export async function handleInteraction(interaction: Interaction): Promise<void> {
18:   try {
19:     if (interaction.isButton()) {
20:       await handleButton(interaction);
21:       return;
22:     }
23:     await handleCommand(interaction);
24:   } catch (error) {
25:     if (unavailableInteraction(error)) return;
26:     console.error('Error procesando interacción:', error);
27:     if (!interaction.isRepliable()) return;
28:     // A failed error response (expired token, deleted channel, missing permissions)
29:     // must not escape the interaction boundary either.
30:     try {
31:       if (interaction.deferred && !interaction.replied) {
32:         await interaction.editReply({ content: describeMusicError(error), embeds: [], components: [] });
33:       } else if (interaction.replied) {
34:         await interaction.followUp({ content: describeMusicError(error), flags: MessageFlags.Ephemeral });
35:       } else {
36:         await interaction.reply({ content: describeMusicError(error), flags: MessageFlags.Ephemeral });
37:       }
38:     } catch (replyError) {
39:       if (unavailableInteraction(replyError)) return;
40:       console.error('No se pudo informar el error de interacción:', replyError);
41:     }
42:   }
43: }
44: 
45: async function handleCommand(interaction: Interaction) {
46:   if (interaction.isAutocomplete()) {
47:     const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
48:     if (!command?.autocomplete) return;
49: 
50:     try {
51:       await command.autocomplete(interaction);
52:     } catch (error) {
53:       console.error(`Error en autocomplete para /${interaction.commandName}:`, error);
54:     }
55:     return;
56:   }
57: 
58:   if (!interaction.isChatInputCommand()) return;
59: 
60:   const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
61: 
62:   if (!command) {
63:     console.warn(`Comando desconocido: ${interaction.commandName}`);
64:     return;
65:   }
66: 
67:   try {
68:     const controlled = new Set(['play', 'search', 'skip', 'stop', 'pause', 'resume', 'volume', 'shuffle', 'remove', 'clear', 'move', 'seek', 'loop', 'autoplay', 'recommend']);
69:     const existing = interaction.guildId ? interaction.client.distube.getQueue(interaction.guildId) : undefined;
70:     if (existing && controlled.has(interaction.commandName) && !await ensureControlChannel(interaction, existing)) return;
71:     await command.execute(interaction);
72:     const queue = interaction.guildId ? interaction.client.distube.getQueue(interaction.guildId) : undefined;
73:     if (queue) { checkpointQueue(interaction.client.distube, queue); await getPlayerPanels(interaction.client.distube)?.refresh(queue); }
74:   } catch (error) {
75:     if (unavailableInteraction(error)) return;
76:     console.error(`Error ejecutando /${interaction.commandName}:`, error);
77: 
78:     const reply: InteractionReplyOptions = {
79:       content: describeMusicError(error),
80:       flags: MessageFlags.Ephemeral,
81:     };
82: 
83:     if (interaction.deferred && !interaction.replied) {
84:       await interaction.editReply({ content: describeMusicError(error), embeds: [], components: [], allowedMentions: { parse: [] } }).catch(() => {});
85:     } else if (interaction.replied) {
86:       await interaction.followUp(reply).catch(() => {});
87:     } else {
88:       await interaction.reply(reply).catch(() => {});
89:     }
90:   }
91: }
````

## File: src/music/events.ts
````typescript
  1: import { DisTube, DisTubeEvents, TypedDisTubeEvents, Events, InfoExtractorPlugin, Playlist, Queue, Song, DisTubeStream } from 'distube';
  2: import { EmbedBuilder } from 'discord.js';
  3: import { createAddQueueEmbed } from '../utils/embed';
  4: import { BotColors } from '../utils/colors';
  5: import { PLAYLIST_SEARCH_WARM_LIMIT, YtDlpSearchPlugin } from './ytDlpSearchPlugin';
  6: import { getStreamDiagnostics, observeStreamErrors, observeVoiceErrors } from './streamErrors';
  7: import { describeMusicError } from './errors';
  8: import { PlaybackRecovery } from './playbackRecovery';
  9: import { guardedEvent } from '../runtime/safety';
 10: import { PlayerPanels } from './playerPanel';
 11: import { RecoveryNotices } from './recoveryNotices';
 12: import { PlaybackHealth, HealthOptions, stallError } from './playbackHealth';
 13: import { getPlaybackState, markQueueEdited, resetObservation } from './playbackState';
 14: import { HistoryStore } from './history';
 15: import { checkpointQueue } from './queueChanges';
 16: 
 17: function findSearchPlugin(distube: DisTube): YtDlpSearchPlugin | undefined {
 18:   return distube.plugins?.find((plugin): plugin is YtDlpSearchPlugin => plugin instanceof YtDlpSearchPlugin);
 19: }
 20: 
 21: async function getSearchQuery(song: Song): Promise<string | null> {
 22:   if (song.stream.playFromSource) return null;
 23:   if (song.plugin instanceof InfoExtractorPlugin) return song.plugin.createSearchQuery(song);
 24:   return song.name ?? null;
 25: }
 26: 
 27: function warmSearchCache(distube: DisTube, songs: Song[], metadata: unknown): void {
 28:   const plugin = findSearchPlugin(distube);
 29:   if (!plugin || !songs.length) return;
 30:   guardedEvent('Precalentamiento de búsquedas', async () => {
 31:     const queries = await Promise.all(songs.slice(0, PLAYLIST_SEARCH_WARM_LIMIT).map(getSearchQuery));
 32:     await plugin.warmSearchCache(queries.filter((query): query is string => Boolean(query?.trim())), metadata);
 33:   })();
 34: }
 35: 
 36: export function registerDisTubeEvents(distube: DisTube, history?: HistoryStore, options?: HealthOptions): () => void {
 37:   const notices = new RecoveryNotices();
 38:   const panels = new PlayerPanels(distube);
 39:   let disposed = false;
 40:   const failedStreams = new WeakSet<object>();
 41:   const ownsQueue = (queue: Queue) => !disposed && !queue.stopped && !getPlaybackState(queue)?.closing &&
 42:     (typeof distube.getQueue !== 'function' || distube.getQueue(queue.id) === queue);
 43:   async function failSong(queue: Queue, error: unknown, song = queue.songs[0]): Promise<void> {
 44:     if (!ownsQueue(queue) || getPlaybackState(queue)?.blocked || !song || queue.songs[0] !== song) return;
 45:     const stream = queue.voice.stream;
 46:     if (stream) failedStreams.add(stream);
 47:     queue.voice.emittedError = true;
 48:     queue.songs.shift();
 49:     distube.emit(Events.ERROR, error instanceof Error ? error : new Error(String(error)), queue, song);
 50:     try { stream?.kill(); } catch (killError) { console.error('[Cerrar stream fallido]', killError); }
 51:     if (queue.songs.length) await distube.queues.playSong(queue);
 52:     else {
 53:       // Native error handling awaits stop() without guarding its rejected promise.
 54:       // Cleanup here also avoids reacquiring a task lock held by extraction.
 55:       try { queue.voice.stop(); } finally { queue.remove(); }
 56:     }
 57:   }
 58:   let health: PlaybackHealth;
 59:   const recovery = new PlaybackRecovery((status) => { health.recovery(status); void notices.update(status); });
 60:   health = new PlaybackHealth(distube, history, queue => {
 61:     void panels.refresh(queue); checkpointQueue(distube, queue);
 62:   }, queue => failSong(queue, stallError()), options);
 63:   const restoreControls = new Map<Queue, () => void>();
 64:   const alternativePlays = new WeakMap<Queue, { song: Song; pending: Promise<void> }>();
 65:   const nativePlay = distube.queues?.playSong;
 66:   // Keep ownership across attachStreamInfo's await. The library's implementation
 67:   // starts the resolved stream even if its old queue ended during extraction.
 68:   async function startSong(queue: Queue, emit = true): Promise<void> {
 69:     if (!distube.handler?.attachStreamInfo) { await nativePlay?.call(distube.queues, queue, emit); return; }
 70:     const song = queue.songs[0];
 71:     if (!song || queue.stopped) return;
 72:     let stream: DisTubeStream | undefined;
 73:     const owns = () => ownsQueue(queue) && queue.songs[0] === song;
 74:     try {
 75:       await distube.handler.attachStreamInfo(song);
 76:       if (!owns() || getPlaybackState(queue)?.blocked) return;
 77:       const playable = song.stream.playFromSource ? song : song.stream.song;
 78:       if (!playable?.stream.playFromSource || !playable.stream.url) throw Object.assign(new Error('No stream URL attached'), { errorCode: 'NO_STREAM_URL' });
 79:       stream = new DisTubeStream(playable.stream.url, {
 80:         ffmpeg: { path: distube.options.ffmpeg.path, args: { global: { ...queue.ffmpegArgs.global }, input: { ...queue.ffmpegArgs.input },
 81:           output: { ...queue.ffmpegArgs.output, ...queue.filters.ffmpegArgs } } }, ...(playable.duration ? { seek: queue._beginTime } : {}),
 82:       });
 83:       queue._beginTime = 0;
 84:       stream.on('debug', data => distube.emit(Events.FFMPEG_DEBUG, `[${queue.id}] ${data}`));
 85:       await queue.voice.play(stream);
 86:       if (!owns()) { stream.kill(); return; }
 87:       if (emit) distube.emit(Events.PLAY_SONG, queue, song);
 88:     } catch (error) {
 89:       stream?.kill();
 90:       if (!owns()) return;
 91:       await failSong(queue, error, song);
 92:     }
 93:   }
 94:   const nativeFinish = distube.queues?.handleSongFinish;
 95:   const pendingFinishes = new WeakMap<Queue, { song: Song | undefined; stream: DisTubeStream | undefined; manual: boolean; pending: Promise<void> }>();
 96:   if (nativeFinish) distube.queues.handleSongFinish = async queue => {
 97:     const song = queue.songs[0], stream = queue.voice.stream, manual = queue._manualUpdate;
 98:     if (!song) return;
 99:     const eligible = () => {
100:       const state = getPlaybackState(queue);
101:       return ownsQueue(queue) && !state?.blocked && !state?.busy && queue.songs[0] === song && queue.voice.stream === stream &&
102:         queue._manualUpdate === manual && (manual || !queue.voice.emittedError &&
103:           !(state && ['recovering', 'alternative'].includes(state.mode) && !stream?.audioResource?.playbackDuration));
104:     };
105:     if (!eligible()) return;
106:     const existing = pendingFinishes.get(queue);
107:     if (existing && existing.song === song && existing.stream === stream && existing.manual === manual) return existing.pending;
108:     const pending = (async () => {
109:       try {
110:         for (;;) {
111:           await queue._taskQueue.queuing();
112:           let finishing: Promise<void>;
113:           try {
114:             if (!eligible()) return;
115:             // Drain commands already waiting before delegating: native finish
116:             // captures the head before acquiring its own task lock.
117:             if (queue._taskQueue.remaining > 1) continue;
118:             finishing = nativeFinish.call(distube.queues, queue);
119:           } finally { queue._taskQueue.resolve(); }
120:           await finishing;
121:           return;
122:         }
123:       } catch (error) { console.error('[Fin de canción]', error); }
124:     })();
125:     pendingFinishes.set(queue, { song, stream, manual, pending });
126:     try { await pending; }
127:     finally { if (pendingFinishes.get(queue)?.pending === pending) pendingFinishes.delete(queue); }
128:   };
129:   if (nativePlay) {
130:     // ERROR listeners are not awaited. Hold the reinserted head here, before
131:     // native playback, so an asynchronous alternative never races the next song.
132:     const playWithRecovery: typeof nativePlay = async (queue, emitPlaySong) => {
133:       const failed = queue.songs[0];
134:       if (!ownsQueue(queue)) return;
135:       if (getPlaybackState(queue)?.blocked) { await panels.show(queue); return; }
136:       const plugin = findSearchPlugin(distube);
137:       const existing = alternativePlays.get(queue);
138:       if (existing && existing.song === failed) return existing.pending;
139:       if (failed && plugin && recovery.needsAlternative(queue, failed)) {
140:         const pending = (async () => {
141:           health.beforePlay(queue, failed);
142:           try {
143:             const prepared = await recovery.prepareAlternative(queue, failed, plugin);
144:             if (queue.stopped || getPlaybackState(queue)?.closing || distube.getQueue(queue.id) !== queue) { recovery.cancelQueue(queue); return; }
145:             if (!prepared) {
146:               if (queue.songs[0] === failed) return; // cancelled lookup; never replay the failed head
147:               // A manual skip already owns playback of its new head.
148:               if (!recovery.alternativeFailed(queue, failed)) return;
149:               // Do not await stop() while DisTube holds the queue task lock.
150:               if (!queue.songs.length) { queue.voice.stop(); queue.remove(); return; }
151:             }
152:             await startSong(queue, emitPlaySong);
153:           } finally { health.afterPlay(queue); }
154:         })();
155:         alternativePlays.set(queue, { song: failed, pending });
156:         try { await pending; }
157:         finally { if (alternativePlays.get(queue)?.pending === pending) alternativePlays.delete(queue); }
158:         return;
159:       }
160:       if (failed) health.beforePlay(queue, failed);
161:       try { await startSong(queue, emitPlaySong); }
162:       finally { health.afterPlay(queue); }
163:     };
164:     distube.queues.playSong = playWithRecovery;
165:   }
166:   const observedVoices = new WeakSet<Queue['voice']>();
167:   const listeners: (() => void)[] = [];
168:   function on<E extends keyof DisTubeEvents>(event: E, handler: (...args: DisTubeEvents[E]) => unknown): void {
169:     const listener = guardedEvent(`DisTube ${event}`, handler) as TypedDisTubeEvents[E];
170:     distube.on(event, listener);
171:     listeners.push(() => { distube.off(event, listener); });
172:   }
173: 
174:   on(Events.INIT_QUEUE, (queue) => {
175:     health.init(queue);
176:     observeVoiceErrors(queue.voice);
177:     if (!restoreControls.has(queue)) {
178:       const previousError = queue._listeners?.error;
179:       const voiceError = guardedEvent('Error de reproducción de voz', async (error: Error) => {
180:         if (queue.voice.stream && failedStreams.has(queue.voice.stream)) return;
181:         await failSong(queue, error);
182:       });
183:       if (previousError) {
184:         queue.voice.off('error', previousError);
185:         queue._listeners!.error = voiceError;
186:         queue.voice.on('error', voiceError);
187:       }
188:       const skip = queue.skip;
189:       const stop = queue.stop;
190:       const seek = queue.seek;
191:       const resume = queue.resume;
192:       // Abort extraction before these methods wait for DisTube's task lock.
193:       // Otherwise a user pressing Stop/Next could wait for the whole lookup.
194:       if (skip) queue.skip = async (...args) => {
195:         const failed = queue.songs[0];
196:         const searching = failed && recovery.needsAlternative(queue, failed);
197:         recovery.cancelQueue(queue);
198:         if (getPlaybackState(queue)?.blocked) throw Object.assign(new Error('La cola está pausada por fallos. Usa Reintentar o Detener.'), { errorCode: 'QUEUE_BLOCKED' });
199:         resetObservation(queue, health.now());
200:         try {
201:           const result = await skip.apply(queue, args);
202:           markQueueEdited(queue);
203:           if (failed) health.history.finish(queue, failed, 'skipped');
204:           return result;
205:         }
206:         catch (error) {
207:           // Skip can reject (e.g. there is no next song, or radio lookup fails).
208:           // Do not leave an aborted recovery at the head with no active audio.
209:           if (searching && recovery.abandonCancelled(queue, failed)) {
210:             if (queue.songs.length) await queue.play();
211:             else await queue.stop();
212:           }
213:           throw error;
214:         }
215:       };
216:       if (stop) queue.stop = (...args) => {
217:         if (queue.stopped) return Promise.resolve();
218:         const state = getPlaybackState(queue); if (state) state.closing = true;
219:         markQueueEdited(queue); recovery.cancelQueue(queue); return stop.apply(queue, args);
220:       };
221:       if (seek) queue.seek = (...args) => {
222:         if (getPlaybackState(queue)?.blocked) return Promise.reject(Object.assign(new Error('Usa Reintentar para recuperar la cola.'), { errorCode: 'QUEUE_BLOCKED' }));
223:         recovery.cancelQueue(queue); resetObservation(queue, health.now());
224:         return seek.apply(queue, args);
225:       };
226:       if (resume) queue.resume = (...args) => getPlaybackState(queue)?.blocked ? health.retryBlocked(queue).then(() => queue) : resume.apply(queue, args);
227:       restoreControls.set(queue, () => {
228:         if (previousError && queue._listeners?.error === voiceError) {
229:           queue.voice.off('error', voiceError);
230:           queue._listeners.error = previousError;
231:           if (!queue.stopped) queue.voice.on('error', previousError);
232:         }
233:         if (skip) queue.skip = skip;
234:         if (stop && !queue.stopped) queue.stop = stop;
235:         if (seek) queue.seek = seek;
236:         if (resume) queue.resume = resume;
237:       });
238:     }
239:     if (observedVoices.has(queue.voice)) return;
240:     observedVoices.add(queue.voice);
241:     const playStream = queue.voice.play.bind(queue.voice);
242:     queue.voice.play = (stream) => {
243:       observeStreamErrors(stream);
244:       return playStream(stream);
245:     };
246:   });
247: 
248:   on(Events.PLAY_SONG, async (queue, song) => {
249:     if (queue.stopped || distube.getQueue?.(queue.id) && distube.getQueue(queue.id) !== queue) return;
250:     health.started(queue, song);
251:     recovery.markStarted(queue, song);
252:     if (queue.voice.stream) observeStreamErrors(queue.voice.stream);
253:     warmSearchCache(distube, queue.songs.slice(1), song.metadata);
254:     await panels.show(queue, song);
255:   });
256: 
257:   on(Events.ADD_SONG, async (queue, song) => {
258:     await panels.refresh(queue);
259:     await queue.textChannel?.send({ embeds: [createAddQueueEmbed(song)] });
260:   });
261: 
262:   on(Events.ADD_LIST, async (queue, playlist: Playlist) => {
263:     warmSearchCache(distube, playlist.songs, playlist.metadata);
264:     await panels.refresh(queue);
265:     await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Info)
266:       .setDescription(`📚 Añadida playlist: **${playlist.name ?? 'Playlist'}** — ${playlist.songs.length} canciones`)] });
267:   });
268: 
269:   on(Events.DISCONNECT, async (queue) => {
270:     await panels.close(queue, '🔌 Desconectado');
271:     await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription('🔌 Desconectado del canal de voz.')] });
272:   });
273: 
274:   on(Events.FINISH, (queue) => panels.close(queue, '✓ Cola terminada'));
275:   on(Events.FINISH_SONG, (queue, song) => { if (song) health.completed(queue, song); });
276:   on(Events.DELETE_QUEUE, (queue) => {
277:     health.end(queue);
278:     recovery.cancelQueue(queue);
279:     restoreControls.get(queue)?.(); restoreControls.delete(queue);
280:     return panels.close(queue);
281:   });
282: 
283:   on(Events.ERROR, async (error, queue: Queue, song) => {
284:     console.error('DisTube Error:', error);
285:     const diagnostics = getStreamDiagnostics(error);
286:     if (diagnostics.length) console.error('[FFmpeg]', diagnostics.join('\n'));
287:     if (!ownsQueue(queue)) return;
288:     // Must run before the first await: DisTube decides whether to stop immediately after emit.
289:     recovery.retry(queue, song, error, findSearchPlugin(distube));
290:     if (!song) await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Error).setDescription(describeMusicError(error))] });
291:   });
292: 
293:   on(Events.DEBUG, (message) => {
294:     if (/QueueManager|voice|join/i.test(message)) console.log(`[DisTube Debug] ${message}`);
295:   });
296: 
297:   on(Events.NO_RELATED, async (queue) => {
298:     await queue.textChannel?.send({ embeds: [new EmbedBuilder().setColor(BotColors.Warning)
299:       .setDescription('🔇 No se encontraron canciones relacionadas. Puedes añadir otra con /play.')] });
300:   });
301:   return () => {
302:     disposed = true;
303:     for (const remove of listeners.splice(0)) remove();
304:     notices.dispose(); recovery.dispose(); panels.dispose(); health.dispose();
305:     for (const restore of restoreControls.values()) restore();
306:     restoreControls.clear();
307:     if (nativePlay) distube.queues.playSong = nativePlay;
308:     if (nativeFinish) distube.queues.handleSongFinish = nativeFinish;
309:   };
310: }
````

## File: README.md
````markdown
  1: # Discord Music Bot
  2: 
  3: Bot privado de musica para Discord hecho con `discord.js`, `DisTube`, `yt-dlp` y TypeScript.
  4: 
  5: ## Que soporta
  6: 
  7: El bot puede reproducir musica usando enlaces directos y busquedas por nombre.
  8: 
  9: | Plataforma | Soporte | Notas |
 10: | --- | --- | --- |
 11: | YouTube | Si | Fuente inicial por defecto; prueba YouTube Music y SoundCloud si no encuentra una versión reproducible. |
 12: | SoundCloud | Si | Soporta URLs directas y busqueda usando la opcion `fuente: SoundCloud`. |
 13: | Spotify | Parcial | Lee metadata de canciones, albums y playlists, pero no reproduce audio directo desde Spotify. Busca una version reproducible en YouTube o SoundCloud. |
 14: | Apple Music | Parcial | Lee informacion del enlace y busca una version reproducible en YouTube o SoundCloud. |
 15: | Otros sitios | Parcial | URLs compatibles con `yt-dlp` pueden funcionar, dependiendo del sitio. |
 16: 
 17: Spotify y Apple Music se usan como entrada de metadata. El audio final viene de una fuente reproducible compatible con `yt-dlp`.
 18: 
 19: ## Requisitos
 20: 
 21: - Node.js 22.12 o superior.
 22: - Un bot de Discord creado en el Developer Portal.
 23: - Permisos del bot para ver canales, conectarse y hablar en canales de voz.
 24: - Dependencias instaladas con `npm install`.
 25: 
 26: ## Configuracion
 27: 
 28: Crea un archivo `.env` en la raiz del proyecto:
 29: 
 30: ```env
 31: DISCORD_TOKEN=token_del_bot
 32: CLIENT_ID=id_de_la_aplicacion
 33: GUILD_ID=id_del_servidor
 34: ```
 35: 
 36: Spotify admite credenciales opcionales, distintas de las de Discord:
 37: 
 38: ```env
 39: SPOTIFY_CLIENT_ID=id_de_tu_aplicacion_de_spotify
 40: SPOTIFY_CLIENT_SECRET=secreto_de_tu_aplicacion_de_spotify
 41: ```
 42: 
 43: Opciones de operación (se aplican al siguiente arranque):
 44: 
 45: ```env
 46: AUDIO_WATCHDOG_ENABLED=true
 47: AUDIO_BREAKER_ENABLED=true
 48: LOG_MAX_BYTES=10485760
 49: LOG_BACKUPS=5
 50: ```
 51: 
 52: El detector y el freno se pueden desactivar por separado con `false`. Los logs admiten tamaños de 1 a 104857600 bytes y de 1 a 20 archivos anteriores por proceso; valores inválidos usan los valores predeterminados. El bot y el supervisor escriben en archivos separados.
 53: 
 54: Sin ellas, el plugin intenta leer los datos públicos. Si no consigue un token, avisa que puede recuperar como máximo 100 canciones de una playlist o álbum. Las credenciales no garantizan acceso a listas privadas ni eliminan las restricciones de la API; el bot sigue buscando el audio en YouTube o SoundCloud. No publiques el archivo `.env`.
 55: 
 56: ## Instalacion
 57: 
 58: ```powershell
 59: npm install
 60: npm run build
 61: ```
 62: 
 63: Registra los comandos slash en tu servidor:
 64: 
 65: ```powershell
 66: npm run deploy
 67: ```
 68: 
 69: Puedes comprobar antes las definiciones sin contactar con Discord ni iniciar el bot:
 70: 
 71: ```powershell
 72: npm run deploy:check
 73: ```
 74: 
 75: La comprobación muestra los 19 comandos y la huella SHA-256 del registro. El registro real verifica la respuesta de Discord y termina con código 1 si falla; no interpretes un registro fallido como permiso para continuar la activación. Su diagnóstico oculta credenciales y se conserva en `logs/deploy.jsonl`.
 76: 
 77: Inicia el bot:
 78: 
 79: ```powershell
 80: npm run start
 81: ```
 82: 
 83: Para desarrollo:
 84: 
 85: ```powershell
 86: npm run dev
 87: ```
 88: 
 89: ## Comandos
 90: 
 91: ### `/play`
 92: 
 93: Reproduce una cancion, album, playlist o busqueda.
 94: 
 95: Opciones:
 96: 
 97: - `query`: nombre de la cancion o URL.
 98: - `fuente`: fuente preferida para buscar una version reproducible. Si falla, el bot prueba las otras fuentes.
 99: 
100: Ejemplos:
101: 
102: ```text
103: /play query:never gonna give you up
104: /play query:https://www.youtube.com/watch?v=dQw4w9WgXcQ
105: /play query:https://soundcloud.com/artist/song fuente:SoundCloud
106: /play query:https://open.spotify.com/track/... fuente:YouTube
107: /play query:https://open.spotify.com/album/... fuente:SoundCloud
108: /play query:https://music.apple.com/... fuente:YouTube
109: ```
110: 
111: ### Controles
112: 
113: ```text
114: /pause
115: /resume
116: /skip
117: /stop
118: /queue
119: /nowplaying
120: /volume valor:50
121: /autoplay
122: /recommend cantidad:5
123: /estado
124: /historial
125: /shuffle
126: /remove posicion:1
127: /clear
128: /move origen:3 destino:1
129: /loop modo:off
130: /seek segundos:90
131: ```
132: 
133: El reproductor muestra la portada grande cuando está disponible, progreso, volumen, fuente de audio, estado y siguiente canción. Usa botones con texto para pausar/reanudar, saltar, ver la cola, detener y abrir el historial. Cuando la cola queda bloqueada por fallos, aparece Reintentar y se deshabilita Siguiente.
134: 
135: - Cada sesión mantiene un solo panel y lo edita al cambiar la canción o sus ajustes. El progreso se actualiza cada 20 segundos; no se repiten ediciones si el contenido sigue igual, por ejemplo durante una pausa.
136: - `/nowplaying` responde solo al usuario con un enlace al panel actual. Si el mensaje fue eliminado, intenta recrearlo; si no puede publicarlo, muestra una vista sin controles.
137: - `/queue` y el botón Cola muestran una lista privada, con páginas de diez canciones, posiciones, duración e inicio aproximado de cada canción. Con pausa, la espera se mide desde la reanudación. No se estima durante una recuperación, una repetición de canción ni después de audio de duración desconocida o en vivo. La repetición de cola muestra el ciclo actual; la radio no incluye canciones futuras.
138: - Al detenerse o terminar la cola, el panel queda marcado como finalizado y sus controles se desactivan. Los controles de mensajes anteriores al reinicio también se rechazan y se retiran al pulsarlos.
139: - Los cambios del panel se realizan en orden. Los fallos de Discord se registran sin detener el audio y dejan una espera de un minuto antes de volver a intentarlo; solo un mensaje confirmado como eliminado permite crear un reemplazo.
140: 
141: Los comandos que alteran la música y los controles del reproductor requieren estar en el canal de voz del bot. `/clear` retira únicamente las pendientes y conserva la canción actual; si la radio está activada seguirá buscando canciones. `/remove` y `/move` usan la numeración de `/queue`: la primera pendiente es la 1. Los cambios se ordenan con las demás operaciones de la cola y se guardan. Una recomendación o búsqueda terminada después de un cambio de sesión o de cola se descarta.
142: 
143: `/estado` responde en privado con conexión, tiempo activo, voz, fuente real, recuperación, racha de fallos, último avance de audio y último código con referencia. Consulta el estado local y funciona sin cola.
144: 
145: `/historial` muestra en privado canciones completadas, saltadas y fallidas, con fecha, fuente real y referencia de error. Guarda una entrada final por solicitud, incluyendo su versión alternativa, en `data/history.json`: hasta 100 por servidor durante siete días, 2000 en total y 2.5 MB. Un archivo dañado o un fallo de disco no detiene la música. Volver a intentar añade una nueva solicitud con audio fresco; requiere un enlace público de origen reconocido y estar en el canal del bot, o en un canal de voz si todavía no hay cola. Dos clics sobre la misma entrada se limitan a un reintento cada 30 segundos.
146: 
147: `/autoplay` alterna la radio para la cola actual: al terminar, intenta añadir otra canción del YouTube Mix. `/recommend` añade de 1 a 20 sugerencias (5 por defecto) usando la canción actual y, si hace falta, la última de la cola. Evita repetir canciones que ya están en cola o en el historial reciente. Ambos dependen de que YouTube Mix esté disponible; no garantizan música infinita.
148: 
149: ## Como funciona Spotify
150: 
151: Spotify no entrega audio directo para este tipo de bot. Cuando pasas un enlace de Spotify:
152: 
153: 1. El bot lee la informacion del track, album o playlist.
154: 2. Genera una busqueda con el nombre y artista.
155: 3. Busca una version reproducible en YouTube o SoundCloud.
156: 4. Agrega el resultado a la cola.
157: 
158: Esto significa que puede haber diferencias entre la version de Spotify y el resultado encontrado, por ejemplo remixes, videos oficiales, versiones en vivo o subidas por otros usuarios.
159: 
160: ## Cache de busquedas
161: 
162: El bot cachea resultados de busqueda para que playlists grandes de Spotify o Apple Music no repitan tanto trabajo.
163: 
164: - Las busquedas se guardan por fuente y texto normalizado.
165: - El cache de busquedas dura 12 horas y guarda hasta 500 resultados.
166: - Los enlaces directos de stream se cachean por 25 minutos y guardan hasta 200 resultados.
167: - Cuando entra una playlist, el bot precalienta en segundo plano las primeras canciones de la cola.
168: - Durante la reproduccion, tambien precalienta las canciones siguientes.
169: 
170: Esto ayuda especialmente cuando se repite una playlist, hay canciones duplicadas o varios usuarios piden musica parecida.
171: 
172: ## Recuperación y operación en producción
173: 
174: `npm run start` ejecuta un supervisor que reinicia el proceso si termina inesperadamente. Usa esperas crecientes de 1 a 30 segundos para evitar un bucle de reinicios rápidos. También comprueba una señal de actividad del bot y lo reinicia si deja de responder durante más de 60 segundos. `Ctrl+C` detiene el supervisor y el bot sin volver a iniciarlo.
175: 
176: Este comando no vigila los archivos ni recarga cambios: compilar mientras está en uso deja la nueva versión preparada para el siguiente reinicio.
177: 
178: - Los errores de comandos, botones, eventos y notificaciones de Discord se capturan en su operación. Un mensaje rechazado por permisos o una interacción vencida no termina el proceso.
179: - Una excepción o promesa rechazada que escape de esas protecciones se registra, guarda el estado disponible y cierra el proceso. El supervisor inicia un proceso limpio. Esto produce una interrupción breve; continuar después de una excepción no controlada puede dejar el proceso en un estado inconsistente, según la [documentación de Node.js](https://nodejs.org/docs/latest-v24.x/api/process.html#warning-using-uncaughtexception-correctly).
180: - Las búsquedas prueban hasta cinco candidatos por fuente. Comparan título y artista y penalizan versiones en vivo, covers o remixes que no se pidieron. Las coincidencias débiles se descartan. El embed muestra la fuente que entrega el audio.
181: - Los fallos temporales de red o HTTP 5xx tienen como máximo dos reintentos con espera. No se insiste en contenido privado, eliminado o restringido, ni en HTTP 429. Los bloqueos 403/429 ponen esa fuente en pausa por un minuto y permiten probar otra.
182: - Cada intento de yt-dlp tiene 20 segundos de límite; una operación tiene 60 segundos y una búsqueda completa 90 segundos. Los procesos agotados se cancelan. Hay un máximo de tres extracciones simultáneas y 50 consultas esperando. Las playlists extraídas con yt-dlp se limitan a 500 entradas.
183: - Si falla el stream por red, HTTP 403/5xx o un error del motor de audio, el bot invalida el enlace cacheado y reintenta hasta dos veces, intentando retomar cerca del punto de interrupción. Después busca una alternativa, empezando por otra plataforma y permitiendo otra subida de la misma plataforma. Esa búsqueda dura como máximo 45 segundos y consulta hasta seis candidatos completos. Excluye la subida que falló, compara título, artista cuando la entrada lo identifica y duración, y descarta covers, remixes u otras variantes que no se pidieron. Una alternativa comienza desde cero; si no existe o también falla, continúa con la siguiente canción o termina la cola vacía. No vuelve a iniciar otro ciclo de reintentos para esa alternativa.
184: - El detector comprueba el avance del recurso de audio cada dos segundos. Ocho segundos sin avance del audio que ya había comenzado inician la recuperación existente (aproximadamente entre ocho y diez segundos según el sondeo). Una canción nueva o un seek tienen doce segundos de margen para el primer audio. Las pausas manuales, las desconexiones y las extracciones pendientes no disparan otra recuperación. Este plazo detecta el atasco; los reintentos pueden necesitar más tiempo.
185: - Tres solicitudes fallidas dentro de cinco minutos bloquean el avance automático y la radio, conservando la canción fallida y las pendientes. Una canción completada o 30 segundos de audio continuo cortan la racha. Reintentar o `/resume` hacen una prueba con un presupuesto nuevo y limitado; si se agota, la cola vuelve a bloquearse. Detener sigue disponible. El bloqueo se guarda y se restaura antes de solicitar audio para evitar recorrer otra vez una playlist que está fallando.
186: - Cada recuperación usa un aviso compacto: amarillo durante el intento, verde cuando el recurso de audio avanza y rojo si se agotan las opciones. Se edita el mismo mensaje. Si pasan 30 segundos sin audio, descontando las pausas, el aviso indica que la recuperación todavía no se confirmó. Los fallos al enviar o editar el aviso se capturan sin generar mensajes de reemplazo repetidos.
187: - Siguiente y Detener cancelan la búsqueda pendiente antes de esperar el bloqueo interno de la cola. Un resultado tardío no reemplaza la siguiente canción ni revive una sesión terminada. Si Siguiente rechaza la operación después de cancelar la búsqueda, la canción fallida se retira para evitar dejarla bloqueada.
188: - Los registros `[Recuperación]` incluyen servidor, canción, fuente, intento, código y resultado, además de la canción alternativa cuando se seleccionó. Los errores tardíos de streams cerrados mantienen un listener para no convertirse en errores no controlados.
189: - La conexión de voz conserva un observador de errores tardíos después de terminar la cola. Los errores activos se manejan en una operación protegida, se deduplican por stream y respetan el bloqueo por fallos. Un evento de fin espera las operaciones de la cola y verifica que la canción y el recurso sigan vigentes, para no avanzar dos veces si coincide con Siguiente o seek. Detener no cuenta como completar la canción.
190: - La cola y su progreso se guardan en `data/queues.json` al cambiar canciones y cada diez segundos. Al reiniciar se recuperan hasta 500 canciones, volumen, repetición, radio y pausa, con una posición aproximada. No se guardan enlaces temporales de audio. Se descartan estados con más de 24 horas y solo se recuperan canales de voz accesibles que tengan personas conectadas. `/stop` elimina el estado de esa cola.
191: - Un archivo de estado dañado o un fallo al escribirlo se registra sin interrumpir la reproducción. Conserva el directorio `data` entre despliegues para recuperar las colas. Si corres el bot en un contenedor, monta ese directorio en almacenamiento persistente.
192: - Token, variables requeridas o intents inválidos detienen el supervisor con código 78: requieren corregir la configuración.
193: - Los registros salen por consola y por `logs/bot.jsonl` y `logs/supervisor.jsonl`, con fecha y nivel. Los incidentes incluyen servidor, sesión, canción, código, intento y referencia para relacionarlos con `/estado` y el historial. Se ocultan enlaces, tokens y cabeceras sensibles. Por defecto se conservan 10 MiB por archivo y cinco anteriores por proceso (unos 120 MiB entre ambos). Las escrituras son asíncronas, con una cola limitada; si falla el disco, se conserva la consola y se espera un minuto antes de volver a escribir.
194: 
195: El supervisor funciona mientras `npm run start` siga activo. Para arrancar después de reiniciar la máquina, configura ese comando en el servicio de tu entorno; en una PC, evita la suspensión mientras el bot deba estar disponible.
196: 
197: yt-dlp ya no se descarga al arrancar: evita que una actualización o una descarga fallida bloquee el inicio. Actualízalo durante mantenimiento con `npm run update:ytdlp` y reinicia el bot después de verificarlo.
198: 
199: ## Activación y vuelta a la versión anterior
200: 
201: La implementación y las pruebas se pueden preparar mientras el bot está en uso. **No hay recarga automática** y los comandos nuevos requieren registro. La guía detallada está en [docs/OPERACION.md](docs/OPERACION.md); el alcance y la validación están en [docs/PLAN_MEJORAS.md](docs/PLAN_MEJORAS.md).
202: 
203: Durante mantenimiento, guarda la versión anterior y una copia de `data`, ejecuta `npm test`, registra los comandos con `npm run deploy` y reinicia una sola instancia con `npm run start`. Comprueba `/estado`, reproducción, Cola, historial, Siguiente y Detener. Si necesitas volver atrás, usa la versión anterior y su copia de datos: una versión antigua no entiende el freno nuevo aunque pueda leer la cola. La prueba prolongada en un servidor de Discord sigue siendo una comprobación de activación; las simulaciones locales no la sustituyen.
204: 
205: ## Otras mejoras posibles
206: 
207: Ideas buenas para seguir mejorando el bot:
208: 
209: - `/lyrics`: buscar letra de la cancion actual.
210: - Filtros de audio como bass boost, nightcore o vaporwave.
211: - Mejorar la resolucion de Spotify/Apple Music para reducir resultados incorrectos.
212: - Guardar colas favoritas por servidor.
213: 
214: ## Scripts
215: 
216: | Script | Descripcion |
217: | --- | --- |
218: | `npm run dev` | Ejecuta el bot con `ts-node`. |
219: | `npm run build` | Compila TypeScript a `dist`. |
220: | `npm run start` | Ejecuta la versión compilada con supervisor y reinicio automático. |
221: | `npm run start:once` | Ejecuta un solo proceso, para usar con un supervisor externo. |
222: | `npm run update:ytdlp` | Actualiza yt-dlp durante mantenimiento, con un límite de 60 segundos. |
223: | `npm test` | Compila y ejecuta las pruebas, incluidas recuperación y fallos simulados. |
224: | `npm run deploy` | Registra comandos slash en el servidor configurado. |
225: | `npm run deploy:check` | Valida y muestra los comandos sin registrarlos ni iniciar el bot. |
226: 
227: Solo puede arrancar una instancia por `CLIENT_ID` en el mismo equipo. Una segunda copia sale con código 79 y el supervisor no la reinicia. La reserva se libera automáticamente al terminar el proceso. `npm run build` no recarga el bot activo: para aplicar cambios, detén su terminal con `Ctrl+C`, espera a que termine y vuelve a ejecutar `npm run start`.
228: 
229: ## Notas
230: 
231: - Los errores de `/play`, `/search` y reproducción incluyen una causa, una sugerencia y un código de diagnóstico. Distinguen búsquedas vacías, restricciones de acceso o región, límites de solicitudes, fallos de red, voz y audio. El error completo se conserva en la consola.
232: - El código de FFmpeg `3436169992` en Windows equivale a HTTP 403: la fuente rechazó el acceso al audio. Se renueva el enlace y se intenta una alternativa dentro de los límites anteriores. No indica por sí solo que FFmpeg esté mal instalado. Los últimos mensajes de FFmpeg se conservan en memoria y se imprimen al fallar, con enlaces y cabeceras sensibles ocultos. Un mismo fallo activo no se registra de nuevo como error tardío.
233: - DisTube limita sus eventos a un listener por defecto. El bot usa un límite finito de diez porque reproducción, guardado de colas y desconexión automática comparten eventos; los avisos por superar ese límite siguen habilitados.
234: - Si cambias opciones de comandos slash, corre `npm run deploy` otra vez.
235: - Si una plataforma falla, revisa si `yt-dlp` soporta ese enlace.
236: - Para playlists grandes, la resolucion puede tardar porque cada cancion necesita buscar una fuente reproducible.
````
