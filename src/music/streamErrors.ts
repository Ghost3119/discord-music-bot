import { DisTubeStream, DisTubeVoice } from 'distube';
import { classifyMusicError } from './errors';

const observedStreams = new WeakSet<DisTubeStream>();
const diagnostics = new WeakMap<object, string[]>();
const observedVoices = new WeakSet<DisTubeVoice>();

/** Queue.remove detaches its error listener while the voice can still receive callbacks. */
export function observeVoiceErrors(voice: DisTubeVoice): void {
  if (observedVoices.has(voice) || typeof voice.on !== 'function') return;
  observedVoices.add(voice);
  voice.on('error', error => {
    if (voice.listenerCount('error') === 1) console.error('Error tardío de voz:', error);
  });
}

function sanitizeAudioLog(line: string): string {
  return line.replace(/\b(?:authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, '[credencial omitida]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[enlace de audio]')
    .slice(0, 500);
}

export function getStreamDiagnostics(error: unknown): readonly string[] {
  return typeof error === 'object' && error !== null ? diagnostics.get(error) ?? [] : [];
}

/** A voice EOF can precede FFmpeg's error event; preserve the stderr already seen. */
export function emptyStreamError(stream: DisTubeStream | undefined): Error {
  const tail = [...getStreamDiagnostics(stream)];
  const code = classifyMusicError({ stderr: tail.join('\n') });
  const error = Object.assign(new Error('El stream terminó sin producir audio'), { errorCode: code === 'UNKNOWN' ? 'AUDIO_STALLED' : code });
  diagnostics.set(error, tail);
  return error;
}

export function observeStreamErrors(stream: DisTubeStream): void {
  if (observedStreams.has(stream)) return;
  observedStreams.add(stream);
  const lines: string[] = [];
  diagnostics.set(stream, lines);
  stream.on('debug', (message: string) => {
    // Exclude spawn commands: they contain signed audio URLs. Keep only a small
    // sanitized tail of FFmpeg stderr, rather than logging every progress line.
    const prefix = '[ffmpeg] log: ';
    if (/^\[process\] exit: code=unknown signal=SIG(?:SEGV|ILL|BUS|ABRT|FPE)$/.test(message)) {
      lines.push(message);
      if (lines.length > 12) lines.shift();
      const error = Object.assign(new Error('FFmpeg terminó por una señal fatal'), { errorCode: 'FFMPEG_EXITED' });
      diagnostics.set(error, [...lines]);
      // DisTube otherwise ignores a null exit code, including process crashes.
      stream.emit('error', error);
      return;
    }
    if (!message.startsWith(prefix)) return;
    lines.push(sanitizeAudioLog(message.slice(prefix.length)));
    if (lines.length > 12) lines.shift();
  });

  // DisTube removes its listener before killing the previous stream; pipeline errors can arrive later.
  stream.on('error', (error: unknown) => {
    if (error && typeof error === 'object') {
      if ('code' in error && error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      diagnostics.set(error, [...lines]);
    }
    // The active stream has DisTube's own handler, which reports the same error.
    // This permanent listener reports only errors arriving after it was removed.
    if (stream.listenerCount('error') > 1) return;
    console.error('Error tardío del stream de audio:', error);
    if (lines.length) console.error('[FFmpeg]', lines.join('\n'));
  });
}
