import { execFile } from 'child_process';
import * as path from 'path';

const APPLE_MUSIC_REGEX = /^https?:\/\/music\.apple\.com\/[a-z]{2}\/(?:album|song|playlist)\//;
const YTDLP_PATH = path.join(__dirname, '..', '..', 'node_modules', '@distube', 'yt-dlp', 'bin', 'yt-dlp.exe');

export interface AppleMusicResult {
  isAppleMusic: boolean;
  query: string;
  title?: string;
  artist?: string;
}

function searchYouTube(searchTerm: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      `ytsearch1:${searchTerm}`,
      '--print', 'webpage_url',
      '--no-warnings',
    ];

    execFile(YTDLP_PATH, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp search error:', error.message, stderr);
        resolve('');
        return;
      }
      const url = stdout.trim().split('\n')[0];
      if (url.startsWith('http')) {
        resolve(url);
      } else {
        console.error('yt-dlp search: URL inválida:', url);
        resolve('');
      }
    });
  });
}

export async function resolveAppleMusic(query: string): Promise<AppleMusicResult> {
  if (!APPLE_MUSIC_REGEX.test(query)) {
    return { isAppleMusic: false, query };
  }

  const cleanUrl = query.split('?')[0].split('#')[0];

  const segments = cleanUrl.split('/');
  const idSegment = segments.reverse().find((s: string) => /^\d{5,}$/.test(s));
  if (!idSegment) {
    const idWithPrefix = cleanUrl.match(/\/id(\d+)/);
    if (idWithPrefix) {
      return lookupAppleMusic(idWithPrefix[1], query);
    }
    return { isAppleMusic: false, query };
  }

  return lookupAppleMusic(idSegment, query);
}

async function lookupAppleMusic(id: string, originalQuery: string): Promise<AppleMusicResult> {
  try {
    const response = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
    const data: any = await response.json();

    if (!data.results || data.results.length === 0) {
      return { isAppleMusic: true, query: originalQuery };
    }

    const track = data.results.find((r: any) => r.wrapperType === 'track') ?? data.results[0];
    const artist = track.artistName ?? '';
    const title = track.trackName ?? '';
    const searchTerm = `${artist} ${title}`.trim();

    const ytUrl = await searchYouTube(searchTerm);
    if (!ytUrl) {
      return { isAppleMusic: true, query: originalQuery, title, artist };
    }

    return {
      isAppleMusic: true,
      query: ytUrl,
      title,
      artist,
    };
  } catch (error) {
    console.error('Error resolviendo Apple Music:', error);
    return { isAppleMusic: true, query: originalQuery };
  }
}