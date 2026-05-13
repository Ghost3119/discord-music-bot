import { DisTube } from 'distube';
import { YtDlpPlugin } from '@distube/yt-dlp';
import { SpotifyPlugin } from '@distube/spotify';
import { Client } from 'discord.js';
import ffmpeg from 'ffmpeg-static';

export function createDisTube(client: Client): DisTube {
  return new DisTube(client as any, {
    plugins: [new SpotifyPlugin(), new YtDlpPlugin({ update: false })],
    emitNewSongOnly: true,
    ffmpeg: { path: ffmpeg ?? undefined },
  });
}