import { randomBytes } from 'node:crypto';
import { Message, MessageCreateOptions } from 'discord.js';
import { DisTube, Queue, Song } from 'distube';
import { createNowPlayingEmbed, createPlayerButtons } from '../utils/embed';

interface Panel {
  queue: Queue;
  song: Song;
  session: string;
  message: Message | undefined;
  channelId: string | undefined;
  timer: NodeJS.Timeout | undefined;
  pending: Promise<void>;
  running: boolean;
  dirty: boolean;
  ended: string | undefined;
  lastPayload: string;
  retryAt: number;
}

const managers = new WeakMap<DisTube, PlayerPanels>();

export function getPlayerPanels(distube: DisTube): PlayerPanels | undefined {
  return managers.get(distube);
}

/** Discord failures belong to the display layer and must never stop audio playback. */
export class PlayerPanels {
  private readonly panels = new Map<string, Panel>();
  private disposed = false;

  constructor(distube: DisTube, private readonly intervalMs = 20_000) {
    managers.set(distube, this);
  }

  show(queue: Queue, song = queue.songs[0], force = false): Promise<void> {
    if (this.disposed || queue.stopped || !song) return Promise.resolve();
    let panel = this.panels.get(queue.id);
    if (panel?.queue !== queue) {
      // Wait for an in-flight send and its final disabled edit before replacing a session.
      const previous = panel ? this.close(panel.queue) : Promise.resolve();
      panel = { queue, song, session: randomBytes(8).toString('hex'), message: undefined,
        channelId: undefined, timer: undefined, pending: previous, running: false, dirty: false,
        ended: undefined, lastPayload: '', retryAt: 0 };
      this.panels.set(queue.id, panel);
      if (this.intervalMs > 0) {
        panel.timer = setInterval(() => { void this.refresh(queue); }, this.intervalMs);
        panel.timer.unref();
      }
    }
    panel.song = song;
    if (force) panel.lastPayload = '';
    return this.schedule(panel);
  }

  refresh(queue: Queue): Promise<void> {
    const panel = this.panels.get(queue.id);
    if (!panel || panel.queue !== queue || this.disposed) return Promise.resolve();
    if (queue.stopped) return this.close(queue);
    if (queue.songs[0]) panel.song = queue.songs[0];
    return this.schedule(panel);
  }

  close(queue: Queue, reason = '⏹ Reproducción finalizada'): Promise<void> {
    const panel = this.panels.get(queue.id);
    if (!panel || panel.queue !== queue) return Promise.resolve();
    this.panels.delete(queue.id);
    panel.ended = reason;
    panel.retryAt = 0;
    if (panel.timer) clearInterval(panel.timer);
    return this.schedule(panel);
  }

  owns(queue: Queue, messageId: string): boolean {
    const panel = this.panels.get(queue.id);
    return !this.disposed && !queue.stopped && panel?.queue === queue && panel.message?.id === messageId;
  }

  session(queue: Queue): string | undefined {
    const panel = this.panels.get(queue.id);
    return panel?.queue === queue && !queue.stopped ? panel.session : undefined;
  }

  url(queue: Queue): string | undefined {
    const panel = this.panels.get(queue.id);
    return panel?.queue === queue ? panel.message?.url : undefined;
  }

  dispose(): void {
    this.disposed = true;
    for (const panel of this.panels.values()) {
      if (panel.timer) clearInterval(panel.timer);
    }
    this.panels.clear();
  }

  private schedule(panel: Panel): Promise<void> {
    panel.dirty = true;
    if (panel.running) return panel.pending;
    panel.running = true;
    panel.pending = panel.pending.then(async () => {
      // Coalesce updates while a Discord request is pending; never overlap message writes.
      while (panel.dirty && !this.disposed) {
        panel.dirty = false;
        try {
          await this.write(panel);
        } catch (error) {
          panel.retryAt = Date.now() + 60_000;
          console.error('[Panel de reproducción]', error);
        }
      }
    }).finally(() => { panel.running = false; });
    return panel.pending;
  }

  private async write(panel: Panel): Promise<void> {
    if (Date.now() < panel.retryAt) return;
    const { queue } = panel;
    const channel = queue.textChannel;
    if (!channel) return;
    const ended = panel.ended;
    const payload = {
      embeds: [createNowPlayingEmbed(panel.song, ended ? 0 : (queue.currentTime || 0) * 1000, {
        paused: queue.paused, volume: queue.volume, nextSong: queue.songs[1],
        queued: Math.max(0, queue.songs.length - 1), autoplay: queue.autoplay, repeatMode: queue.repeatMode, ended,
      })],
      components: [createPlayerButtons(queue.paused, Boolean(ended), queue.songs.length < 2 && !queue.autoplay)],
      allowedMentions: { parse: [] },
    } satisfies MessageCreateOptions;
    const fingerprint = JSON.stringify(payload);
    if (panel.message && panel.channelId !== channel.id && !ended) {
      // A new request may choose another text channel. Old controls must become inert.
      try { await panel.message.edit({ components: [createPlayerButtons(false, true)] }); }
      catch (error) { console.error('[Desactivar panel anterior]', error); }
      panel.message = undefined;
      panel.lastPayload = '';
    }
    if (panel.message) {
      if (fingerprint === panel.lastPayload) return;
      try {
        await panel.message.edit({ embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } });
        panel.lastPayload = fingerprint;
        return;
      } catch (error) {
        // Only a known deleted message permits replacement. Network/permission failures
        // must not cause a fresh public message every time the progress timer fires.
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 10008) throw error;
        panel.message = undefined;
        panel.lastPayload = '';
      }
    }
    // A queue may finish while its initial send is still pending. The drain above
    // will disable that message, but never send a new player after the session ends.
    if (panel.ended || this.disposed) return;
    panel.message = await channel.send(payload);
    panel.channelId = channel.id;
    panel.lastPayload = fingerprint;
  }
}
