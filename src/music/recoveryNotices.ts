import { EmbedBuilder, Message, escapeMarkdown } from 'discord.js';
import { Queue, Song } from 'distube';
import { RecoveryStatus } from './playbackRecovery';
import { musicErrorTitle } from './errors';

interface Notice {
  latest: RecoveryStatus;
  message: Message | undefined;
  pending: Promise<void>;
  running: boolean;
  dirty: boolean;
  failedWrite: boolean;
}

export function createRecoveryNotice(status: RecoveryStatus): EmbedBuilder {
  const title = escapeMarkdown((status.original.name || 'Canción sin título').slice(0, 160));
  const rawSource = (status.song.stream.playFromSource ? status.song.source : status.song.stream.song?.source) ?? status.song.source;
  const source = rawSource.includes('soundcloud') ? 'SoundCloud' : rawSource.includes('youtube') ? 'YouTube' : rawSource;
  let color = '#F0B232';
  let text: string;
  switch (status.stage) {
    case 'renew': text = `🔄 **Reintentando audio**\n${title}\nRenovando el enlace (${status.attempt}/2).`; break;
    case 'alternative': text = `🔎 **Buscando otra versión o fuente**\n${title}`; break;
    case 'recovered': color = '#3BA55D'; text = `✅ **Audio recuperado en ${escapeMarkdown(source)}**\n${title}`; break;
    case 'unconfirmed': text = `⏳ **Todavía no se ha confirmado el audio**\n${title}`; break;
    case 'cancelled': color = '#949BA4'; text = `⏹ **Recuperación cancelada**\n${title}\nLa sesión terminó o se cambió de canción.`; break;
    case 'failed': color = '#ED4245'; text = `⏭ **No pude reproducir esta canción**\n${title}\n${musicErrorTitle({ errorCode: status.code })}.\n${status.queue.songs.length ? 'Continuaré con la siguiente.' : 'No quedan canciones. Añade otra con /play.'}`; break;
  }
  return new EmbedBuilder().setColor(color as `#${string}`).setDescription(text).setFooter({ text: `${status.code} · ${source}`.slice(0, 2048) });
}

/** One small, serialized message per recovery; Discord failures do not affect audio. */
export class RecoveryNotices {
  private readonly queues = new WeakMap<Queue, WeakMap<Song, Notice>>();
  private disposed = false;

  update(status: RecoveryStatus): Promise<void> {
    if (this.disposed) return Promise.resolve();
    let songs = this.queues.get(status.queue);
    if (!songs) { songs = new WeakMap(); this.queues.set(status.queue, songs); }
    let notice = songs.get(status.original);
    if (!notice) {
      notice = { latest: status, message: undefined, pending: Promise.resolve(), running: false, dirty: false, failedWrite: false };
      songs.set(status.original, notice);
    }
    notice.latest = status;
    notice.dirty = true;
    if (notice.running) return notice.pending;
    notice.running = true;
    const state = notice;
    state.pending = state.pending.then(async () => {
      try {
        while (state.dirty && !this.disposed) {
          state.dirty = false;
          if (state.failedWrite) continue;
          try {
            const payload = { embeds: [createRecoveryNotice(state.latest)], allowedMentions: { parse: [] as const } };
            if (state.message) await state.message.edit(payload);
            else if (state.latest.stage !== 'cancelled') state.message = await state.latest.queue.textChannel?.send(payload);
          } catch (error) {
            // Do not spam replacement messages after permissions, network or deletion errors.
            state.failedWrite = true;
            console.error('[Aviso de recuperación]', error);
          }
        }
      } finally {
        // Release inside the drain, without a later Promise.finally microtask
        // that could strand a status arriving just after the loop finishes.
        state.running = false;
      }
    });
    return state.pending;
  }

  dispose(): void { this.disposed = true; }
}
