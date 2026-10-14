import { PassThrough, pipeline } from 'node:stream';
import { DisTubeStream, Queue, StreamOptions } from 'distube';
import { createAudioResource, StreamType } from '@discordjs/voice';

export const PREBUFFER_MAX_BYTES = 1024 * 1024;
export const PREBUFFER_READY_MS = 8000;
export function audioStreamOptions(queue: Queue, seek = 0): StreamOptions {
  return { ffmpeg: { path: queue.distube.options.ffmpeg.path,
    args: { global: { ...queue.ffmpegArgs.global }, input: { ...queue.ffmpegArgs.input },
      output: { ...queue.ffmpegArgs.output, ...queue.filters.ffmpegArgs } } }, ...(seek > 0 ? { seek } : {}) };
}

/** One FFmpeg and one native encoder; preparing never touches the voice player. */
export class PrebufferedStream extends DisTubeStream {
  private readonly encoded;
  private readonly packets = new PassThrough({ objectMode: true, highWaterMark: 5 });
  private closed = false;
  private started = false;
  private error: Error | undefined;
  private closing: Promise<void> | undefined;

  constructor(url: string, options: StreamOptions, volume: number) {
    super(url, options);
    this.encoded = this.audioResource.playStream;
    // Keep the installed raw->Opus encoder, add a five-packet staging boundary.
    // Both pipelines apply backpressure; no data listener drains audio into RAM.
    pipeline(this.encoded, this.packets, () => {});
    this.audioResource = createAudioResource(this.packets, { inputType: StreamType.Opus });
    this.setVolume((volume / 100) ** (0.5 / Math.log10(2)));
    this.on('error', error => { this.error = error; });
    this.packets.on('error', error => { if (!this.closed) this.emit('error', error); });
  }

  override spawn(): void {
    if (this.closed) throw new Error('Prepared audio is closed');
    if (this.started) return; // DisTubeVoice.play/unpause call spawn again.
    this.started = true;
    super.spawn();
    const child = this.process, pid = child?.pid;
    if (pid && child && process.env['MUSIC_SUPERVISOR_IPC'] === '1') {
      const report = (action: 'started' | 'closed') => {
        if (process.connected) process.send?.({ type: 'audioWorker', action, pid }, () => {});
      };
      report('started'); child.once('close', () => report('closed'));
    }
  }

  get usable(): boolean { return !this.closed && !this.error && !this.packets.destroyed && this.packets.readableLength > 0; }
  get failure(): Error | undefined { return this.error; }
  get bufferedBytes(): number {
    // Opus packets are objects. An 8 KiB upper bound per packet is deliberately
    // conservative; raw and encoder writable lengths are already bytes.
    return this.stream.readableLength + this.stream.writableLength + (this.process?.stdout?.readableLength ?? 0) +
      (this.encoded.readableLength + this.packets.readableLength + this.packets.writableLength) * 8192 +
      ('writableLength' in this.encoded ? Number(this.encoded.writableLength) : 0) + 128 * 1024;
  }

  async prepare(signal: AbortSignal): Promise<void> {
    const budget = AbortSignal.any([signal, AbortSignal.timeout(PREBUFFER_READY_MS)]);
    budget.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.off('error', failed); this.packets.off('readable', ready);
        this.packets.off('close', ended); this.packets.off('end', ended);
        budget.removeEventListener('abort', abort);
      };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const ready = () => {
        if (this.usable) { cleanup(); resolve(); }
      };
      const ended = () => failed(Object.assign(new Error('Prebuffer ended before audio'), { errorCode: 'FFMPEG_EXITED' }));
      const abort = () => failed(budget.reason);
      this.on('error', failed); this.packets.on('readable', ready);
      this.packets.once('close', ended); this.packets.once('end', ended);
      budget.addEventListener('abort', abort, { once: true });
      try { this.spawn(); ready(); } catch (error) { failed(error as Error); }
    });
  }

  override kill(): void {
    if (this.closed) return;
    // DisTube calls kill from the raw stream's close event, including clean EOF.
    // A short source can reach EOF before handoff; its encoded tail is still
    // useful. Voice destroys the old AudioResource when replacing/stopping it.
    if (this.stream.readableEnded && !this.error && !this.packets.destroyed) { super.kill(); return; }
    this.destroyAudio();
  }
  private destroyAudio(): void {
    if (this.closed) return;
    this.closed = true;
    this.packets.destroy(); this.encoded.destroy();
    super.kill();
  }

  dispose(): Promise<void> {
    if (!this.closing) {
      const child = this.process;
      this.closing = child && child.exitCode === null && child.signalCode === null
        ? new Promise(resolve => { child.once('close', () => resolve()); }) : Promise.resolve();
      this.destroyAudio();
    }
    return this.closing;
  }
}
