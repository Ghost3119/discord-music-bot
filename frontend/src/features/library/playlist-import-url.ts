import type { ImportPlatform } from '../../lib/api';

export interface PlaylistUrlInspection {
  status: 'empty' | 'valid' | 'unsupported' | 'invalid';
  platform: ImportPlatform | null;
  label: string;
  hint?: string;
}

export function inspectPlaylistUrl(raw: string): PlaylistUrlInspection {
  const input = raw.trim();
  if (!input) {
    return { status: 'empty', platform: null, label: '' };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      status: 'invalid',
      platform: null,
      label: 'Enlace incompleto',
      hint: 'Pega un enlace completo que empiece por https://',
    };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    return {
      status: 'invalid',
      platform: null,
      label: 'Enlace no seguro',
      hint: 'Usa un enlace público HTTPS sin fragmentos (#) ni puertos.',
    };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'open.spotify.com' && /^\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]{22})\/?$/.test(url.pathname)) {
    return {
      status: 'valid',
      platform: 'spotify',
      label: 'Spotify',
      hint: 'Spotify Web API requiere autorización en modo desarrollo. Si la playlist está restringida, usa la pestaña «Archivo CSV».',
    };
  }

  const isYouTubeMusic = host === 'music.youtube.com';
  const isYouTube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host);
  if (!isYouTube && host !== 'youtu.be') {
    return {
      status: 'invalid',
      platform: null,
      label: 'Plataforma no compatible',
      hint: 'Aceptamos enlaces públicos de playlists de YouTube y YouTube Music.',
    };
  }

  const list = url.searchParams.get('list')?.trim() ?? '';
  if (!list) {
    return {
      status: 'invalid',
      platform: isYouTubeMusic ? 'youtube_music' : 'youtube',
      label: isYouTubeMusic ? 'YouTube Music · Falta lista' : 'YouTube · Falta lista',
      hint: 'Este enlace no incluye una playlist (?list=…). Abre la playlist y copia su dirección.',
    };
  }
  if (!/^[A-Za-z0-9_-]{2,120}$/.test(list)) {
    return {
      status: 'invalid',
      platform: isYouTubeMusic ? 'youtube_music' : 'youtube',
      label: 'ID de playlist inválido',
      hint: 'El parámetro list= del enlace no tiene un formato válido.',
    };
  }
  if (['WL', 'LL', 'LM'].includes(list.toUpperCase())) {
    return {
      status: 'invalid',
      platform: isYouTubeMusic ? 'youtube_music' : 'youtube',
      label: 'Playlist privada de cuenta',
      hint: '«Ver más tarde» y «Canciones que te gustan» son privadas. Usa una playlist pública o no listada.',
    };
  }
  if (url.pathname !== '/playlist' && url.pathname !== '/watch' && host !== 'youtu.be') {
    return {
      status: 'invalid',
      platform: isYouTubeMusic ? 'youtube_music' : 'youtube',
      label: 'Ruta no reconocida',
      hint: 'Usa un enlace directo /playlist?list=… o /watch?v=…&list=…',
    };
  }

  return {
    status: 'valid',
    platform: isYouTubeMusic ? 'youtube_music' : 'youtube',
    label: isYouTubeMusic ? 'YouTube Music' : 'YouTube',
  };
}
