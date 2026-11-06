/** Public playback inputs only. Never let DisTube's URL fallback probe an arbitrary host. */
export function publicPlaybackUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || /[\u0000-\u0020\u007f\\]/.test(input)) throw invalidMediaInput();
  const host = url.hostname;
  const supported = ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)
    ? url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '') ||
      url.pathname === '/playlist' && /^[\w-]{2,120}$/.test(url.searchParams.get('list') ?? '') || /^\/(?:shorts|live)\/[\w-]{11}$/.test(url.pathname)
    : host === 'youtu.be' ? /^\/[\w-]{11}$/.test(url.pathname)
      : ['soundcloud.com', 'www.soundcloud.com'].includes(host) ? /^\/[\w-]+\/(?:[\w-]+|sets\/[\w-]+)\/?$/.test(url.pathname) && !/^\/(?:stream|api|discover|search|you)\//.test(url.pathname)
        : host === 'open.spotify.com' ? /^\/(?:intl-[a-z]{2}\/)?(?:track|album|playlist)\/[A-Za-z0-9]{22}$/.test(url.pathname)
          : host === 'music.apple.com' && /^\/[a-z]{2}\/(?:album|song|playlist)\/[^/]+\/[A-Za-z\d.-]+$/.test(url.pathname);
  // Exact provider names exclude IP literals, private networks, localhost and suffix lookalikes.
  if (!supported) throw invalidMediaInput();
  for (const key of [...url.searchParams.keys()]) if (!['v', 'list', 'i'].includes(key)) url.searchParams.delete(key);
  return url.href;
}

export function invalidMediaInput(): Error {
  return Object.assign(new Error('Usa una búsqueda de hasta 500 caracteres o un enlace HTTPS público de YouTube, SoundCloud, Spotify o Apple Music.'), { errorCode: 'INVALID_ACTION', statusCode: 400 });
}

export function playbackQuery(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 500 || /[\u0000-\u001f\u007f]/.test(input)) throw invalidMediaInput();
  const query = input.trim();
  if (query.startsWith('-')) throw invalidMediaInput();
  if (/^[a-z][a-z\d+.-]*:|^[\\/]{2}/i.test(query)) {
    try { return publicPlaybackUrl(query); } catch { throw invalidMediaInput(); }
  }
  return query;
}

export function isPublicPlaybackUrl(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > 2048) return false;
  try { publicPlaybackUrl(input); return true; } catch { return false; }
}

/** The runner receives only fixed, bounded internal search prefixes or provider URLs. */
export function extractionInput(input: string): string {
  if (typeof input !== 'string' || /[\u0000-\u001f\u007f]/.test(input) || input.trim().startsWith('-')) throw invalidMediaInput();
  const search = /^(?:ytsearch|scsearch)([1-9]\d?):(.+)$/i.exec(input);
  if (search) {
    if (Number(search[1]) > 60 || search[2]!.length > 500) throw invalidMediaInput();
    return input;
  }
  // Generated YouTube Music fallback; public playback queries cannot reach this route.
  try {
    const url = new URL(input);
    if (url.origin === 'https://music.youtube.com' && !url.username && !url.password && url.pathname === '/search' && url.hash === '#songs' && [...url.searchParams.keys()].every(key => key === 'q') && (url.searchParams.get('q')?.length ?? 0) > 0 && url.searchParams.get('q')!.length <= 500) return url.href;
    return publicPlaybackUrl(input);
  } catch { throw invalidMediaInput(); }
}
