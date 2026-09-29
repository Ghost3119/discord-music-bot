import { DisTubeStream } from 'distube';

const observedStreams = new WeakSet<DisTubeStream>();

export function observeStreamErrors(stream: DisTubeStream): void {
  if (observedStreams.has(stream)) return;
  observedStreams.add(stream);

  // DisTube removes its listener before killing the previous stream; pipeline errors can arrive later.
  stream.on('error', (error) => {
    if ('code' in error && error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error('Error tardío del stream de audio:', error);
  });
}
