import { SpotifyPlugin, SpotifyPluginOptions } from '@distube/spotify';

const imageHosts = new Set(['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'mosaic.scdn.co']);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function thumbnail(data: unknown): string | undefined {
  const item = record(data);
  if (!item) return undefined;
  const candidates = [item['thumbnail'], ...[
    record(item['visualIdentity'])?.['image'], record(item['coverArt'])?.['sources'], item['images'],
  ].flatMap(images => list(images).map(image => record(image)?.['url']))];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length > 2_000) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && imageHosts.has(url.hostname) && !url.username && !url.password &&
        !url.port && !url.search && !url.hash) return url.href;
    } catch { /* Artwork remains optional when metadata has no public image. */ }
  }
  return undefined;
}

function withArtwork<T extends { thumbnail?: string }>(data: T): T {
  const image = thumbnail(data);
  return image ? { ...data, thumbnail: image } : data;
}

/** Adapt public image metadata before the existing plugin creates Songs; no extra lookups. */
export class SpotifyArtworkPlugin extends SpotifyPlugin {
  constructor(options: SpotifyPluginOptions = {}) {
    super(options);
    const getData = this.api.getData.bind(this.api);
    this.api.getData = (async (url: string) => {
      const data = withArtwork(await getData(url));
      return 'tracks' in data ? { ...data, tracks: data.tracks.map(withArtwork) } : data;
    }) as typeof this.api.getData;
  }
}
