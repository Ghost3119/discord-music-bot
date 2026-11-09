import { DisTube, DisTubeOptions } from 'distube';
import { SpotifyArtworkPlugin } from './spotifyArtworkPlugin';
import { Client } from 'discord.js';
import ffmpeg from 'ffmpeg-static';
import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';

export function createDisTube(client: Client): DisTube {
  const ffmpegPath = process.env['FFMPEG_PATH'] || ffmpeg;
  const clientId = process.env['SPOTIFY_CLIENT_ID'];
  const clientSecret = process.env['SPOTIFY_CLIENT_SECRET'];
  const options: DisTubeOptions = {
    plugins: [new SpotifyArtworkPlugin(clientId && clientSecret ? { api: { clientId, clientSecret } } : {}), new YtDlpSearchPlugin()],
    emitNewSongOnly: true,
    ffmpeg: { ...(ffmpegPath ? { path: ffmpegPath } : {}), args: { input: { protocol_whitelist: 'http,https,tcp,tls,crypto' } } },
  };

  if (ffmpegPath) {
    options.ffmpeg!.path = ffmpegPath;
  }

  const distube = new DisTube(client, options);
  // DisTube defaults to one listener, but playback, persistence and empty-channel
  // cleanup each observe some of the same events. Keep a finite leak warning limit.
  distube.setMaxListeners(10);
  return distube;
}
