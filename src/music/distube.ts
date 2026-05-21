import { DisTube, DisTubeOptions } from 'distube';
import { SpotifyPlugin } from '@distube/spotify';
import { Client } from 'discord.js';
import ffmpeg from 'ffmpeg-static';
import { YtDlpSearchPlugin } from './ytDlpSearchPlugin';

export function createDisTube(client: Client): DisTube {
  const options: DisTubeOptions = {
    plugins: [new SpotifyPlugin(), new YtDlpSearchPlugin()],
    emitNewSongOnly: true,
  };

  if (ffmpeg) {
    options.ffmpeg = { path: ffmpeg };
  }

  return new DisTube(client, options);
}
