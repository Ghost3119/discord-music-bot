import { escapeMarkdown } from 'discord.js';
import type { SearchSource } from './ytDlpSearchPlugin';

interface MusicErrorContext {
  source?: SearchSource;
  songName?: string;
}

interface ErrorDescription {
  title: string;
  detail: string;
  hint: string;
}

const ERROR_DESCRIPTIONS: Record<string, ErrorDescription> = {
  INVALID_QUEUE_POSITION: {
    title: 'Posición de cola no válida', detail: 'La posición indicada ya no existe o corresponde a la canción actual.',
    hint: 'Abre /queue y usa sus posiciones: la primera canción pendiente es la 1.',
  },
  SESSION_CHANGED: {
    title: 'La sesión de música cambió', detail: 'La cola terminó o fue reemplazada mientras esperaba la acción.',
    hint: 'Abre el reproductor actual con /nowplaying y vuelve a intentarlo.',
  },
  CONTROL_CHANNEL_REQUIRED: {
    title: 'Debes estar en el canal de voz del bot', detail: 'Tu canal de voz cambió mientras esperaba la acción.',
    hint: 'Entra al mismo canal de voz que el bot para controlar la música.',
  },
  QUEUE_BLOCKED: {
    title: 'La cola está pausada por fallos', detail: 'Varias canciones agotaron su recuperación; las pendientes se conservan.',
    hint: 'Usa Reintentar o /resume para hacer una prueba, o Detener para cerrar la sesión.',
  },
  AUDIO_STALLED: {
    title: 'El audio dejó de avanzar', detail: 'No llegaron nuevos frames de audio dentro del tiempo permitido.',
    hint: 'El bot intentará recuperar la fuente dentro del límite de reintentos.',
  },
  MUSIC_BUSY: {
    title: 'El buscador está ocupado',
    detail: 'Hay demasiadas consultas de música pendientes.',
    hint: 'Espera unos segundos antes de volver a intentar.',
  },
  CANNOT_RESOLVE_SONG: {
    title: 'No se encontraron canciones',
    detail: 'La búsqueda no devolvió resultados en la fuente seleccionada.',
    hint: 'Prueba con artista y título, pega un enlace directo o cambia la opción fuente.',
  },
  NO_RESULT: {
    title: 'No se pudo resolver la canción',
    detail: 'No fue posible encontrar o consultar una versión reproducible. La plataforma también puede haber fallado al responder.',
    hint: 'Prueba un enlace directo o una fuente diferente. Si se repite, revisa el error completo en la consola.',
  },
  NOT_SUPPORTED_URL: {
    title: 'Enlace no compatible',
    detail: 'El bot no tiene un extractor compatible con ese enlace.',
    hint: 'Usa un enlace de una canción o playlist de YouTube, SoundCloud, Spotify o Apple Music.',
  },
  UNAVAILABLE_VIDEO: {
    title: 'Contenido no disponible',
    detail: 'La plataforma no permite acceder a esta canción o video.',
    hint: 'Comprueba que el enlace abra sin iniciar sesión o prueba otra versión de la canción.',
  },
  PRIVATE_CONTENT: {
    title: 'Contenido privado o que requiere iniciar sesión',
    detail: 'El bot no puede acceder a este contenido con su sesión actual.',
    hint: 'Usa un enlace público que se pueda abrir sin iniciar sesión.',
  },
  AGE_RESTRICTED: {
    title: 'Contenido con restricción de edad',
    detail: 'La plataforma exige verificar la edad para acceder a este contenido.',
    hint: 'Prueba otra versión pública de la canción sin esa restricción.',
  },
  NON_NSFW: {
    title: 'Contenido restringido en este canal',
    detail: 'DisTube bloqueó una canción con restricción de edad en un canal de texto sin esa clasificación.',
    hint: 'Prueba otra versión de la canción sin restricción de edad.',
  },
  GEO_RESTRICTED: {
    title: 'Contenido bloqueado por región',
    detail: 'La canción no está disponible desde la región donde se ejecuta el bot.',
    hint: 'Prueba otra publicación de la canción o una fuente diferente.',
  },
  SOURCE_RATE_LIMITED: {
    title: 'La plataforma está limitando las solicitudes',
    detail: 'El servicio rechazó temporalmente más consultas (HTTP 429).',
    hint: 'Espera unos minutos antes de volver a intentar o usa otra fuente.',
  },
  SOURCE_BLOCKED: {
    title: 'La plataforma rechazó el acceso',
    detail: 'El servidor devolvió HTTP 403 o pidió comprobar que la solicitud no viene de un bot.',
    hint: 'Prueba otra fuente. Si persiste, quien administra el bot debe revisar yt-dlp y el acceso a la plataforma.',
  },
  SOURCE_UNAVAILABLE: {
    title: 'La plataforma no está respondiendo correctamente',
    detail: 'El servicio devolvió un error de servidor (HTTP 5xx).',
    hint: 'Inténtalo más tarde o usa otra fuente.',
  },
  NETWORK_TIMEOUT: {
    title: 'Se agotó el tiempo de espera',
    detail: 'La consulta o descarga de audio tardó demasiado en responder.',
    hint: 'Vuelve a intentarlo. Si se repite, revisa la conexión a Internet del equipo donde corre el bot.',
  },
  NETWORK_ERROR: {
    title: 'No se pudo contactar con la plataforma',
    detail: 'Falló la conexión de red o la resolución del nombre del servidor.',
    hint: 'Revisa la conexión a Internet del equipo donde corre el bot y vuelve a intentarlo.',
  },
  VOICE_CONNECT_FAILED: {
    title: 'No se pudo conectar al canal de voz',
    detail: 'Discord no completó la conexión antes de agotar el tiempo de espera.',
    hint: 'Revisa los permisos Ver canal, Conectar y Hablar. Si persiste, prueba otra Anulación de región en los ajustes del canal de voz.',
  },
  VOICE_RECONNECT_FAILED: {
    title: 'Se perdió la conexión de voz',
    detail: 'El bot se desconectó y no pudo volver a entrar al canal.',
    hint: 'Revisa la conexión del bot y sus permisos; después vuelve a usar /play.',
  },
  VOICE_FULL: {
    title: 'El canal de voz está lleno',
    detail: 'El bot no puede entrar porque el canal alcanzó su límite de usuarios.',
    hint: 'Libera un lugar, aumenta el límite del canal o usa otro canal de voz.',
  },
  VOICE_MISSING_PERMS: {
    title: 'Faltan permisos de voz',
    detail: 'Discord no permite que el bot entre o hable en ese canal.',
    hint: 'Concede Ver canal, Conectar y Hablar al rol del bot y revisa las excepciones del canal.',
  },
  DISCORD_MISSING_PERMS: {
    title: 'Discord rechazó la acción por permisos',
    detail: 'El bot no tiene acceso o permisos suficientes para completar la acción.',
    hint: 'Revisa el rol del bot y los permisos del canal, incluidos Ver canal, Enviar mensajes e Insertar enlaces.',
  },
  DISCORD_INVALID_PAYLOAD: {
    title: 'Discord rechazó el formato del mensaje del bot',
    detail: 'El bot generó una respuesta con campos o componentes inválidos.',
    hint: 'Vuelve a abrir la cola con /queue. Si se repite, informa este código para corregir el formato de la respuesta.',
  },
  EMPTY_PLAYLIST: {
    title: 'La playlist no contiene canciones reproducibles',
    detail: 'La lista está vacía o sus canciones no están disponibles para el bot.',
    hint: 'Comprueba que la playlist sea pública y tenga canciones accesibles.',
  },
  EMPTY_FILTERED_PLAYLIST: {
    title: 'Todas las canciones de la playlist fueron filtradas',
    detail: 'No quedó contenido reproducible después de aplicar las restricciones del canal.',
    hint: 'Prueba una playlist con canciones públicas sin restricción de edad.',
  },
  CANNOT_GET_STREAM_URL: {
    title: 'No se pudo obtener el audio',
    detail: 'Se encontró la canción, pero la plataforma no entregó un enlace de audio reproducible.',
    hint: 'Prueba otra versión o fuente. Si ocurre con todas las canciones, revisa yt-dlp en la consola.',
  },
  UNPLAYABLE_FORMATS: {
    title: 'No hay un formato de audio compatible',
    detail: 'La plataforma no ofreció un formato que el bot pueda reproducir.',
    hint: 'Prueba otra versión de la canción o una fuente diferente.',
  },
  FFMPEG_NOT_INSTALLED: {
    title: 'El motor de audio no está disponible',
    detail: 'El bot no pudo encontrar o ejecutar FFmpeg.',
    hint: 'Quien administra el bot debe revisar la instalación de ffmpeg-static y reiniciarlo.',
  },
  FFMPEG_EXITED: {
    title: 'El motor de audio se detuvo',
    detail: 'FFmpeg terminó antes de completar la reproducción.',
    hint: 'Vuelve a pedir la canción o prueba otro enlace. Si se repite, revisa los registros de audio en la consola.',
  },
  ERR_STREAM_PREMATURE_CLOSE: {
    title: 'El audio se interrumpió',
    detail: 'La conexión de audio se cerró antes de completar la reproducción.',
    hint: 'Vuelve a pedir la canción. Si se repite, prueba otra fuente y revisa la conexión del bot.',
  },
  YTDLP_NOT_FOUND: {
    title: 'El buscador de música no está disponible',
    detail: 'El bot no pudo encontrar el ejecutable de yt-dlp.',
    hint: 'Quien administra el bot debe reinstalar las dependencias con npm install y reiniciarlo.',
  },
  NO_EXTRACTOR_PLUGIN: {
    title: 'El buscador de música no está configurado',
    detail: 'No hay un extractor disponible para resolver búsquedas por nombre.',
    hint: 'Quien administra el bot debe revisar la configuración de los plugins y reiniciarlo.',
  },
  NO_QUEUE: {
    title: 'No hay música en reproducción',
    detail: 'La cola ya terminó o todavía no se ha creado.',
    hint: 'Usa /play para iniciar una canción antes de controlar la reproducción.',
  },
  NO_UP_NEXT: {
    title: 'No hay una siguiente canción',
    detail: 'No quedan canciones en la cola para saltar.',
    hint: 'Añade una canción con /play o pide sugerencias con /recommend.',
  },
  UNKNOWN: {
    title: 'No se pudo completar la acción de música',
    detail: 'Ocurrió un error que el bot todavía no puede identificar.',
    hint: 'Inténtalo otra vez. Si persiste, comparte el código de abajo con quien administra el bot; el detalle completo está en la consola.',
  },
};

const CODE_ALIASES: Record<string, string> = {
  NO_STREAM_URL: 'CANNOT_GET_STREAM_URL',
  NOT_SUPPORTED_SONG: 'NOT_SUPPORTED_URL',
  NO_PLAYING_SONG: 'NO_QUEUE',
  QUEUE_STOPPED: 'NO_QUEUE',
  ETIMEDOUT: 'NETWORK_TIMEOUT',
  UND_ERR_CONNECT_TIMEOUT: 'NETWORK_TIMEOUT',
  UND_ERR_HEADERS_TIMEOUT: 'NETWORK_TIMEOUT',
  ECONNRESET: 'NETWORK_ERROR',
  ECONNREFUSED: 'NETWORK_ERROR',
  ENOTFOUND: 'NETWORK_ERROR',
  EAI_AGAIN: 'NETWORK_ERROR',
  '50013': 'DISCORD_MISSING_PERMS',
  '50001': 'DISCORD_MISSING_PERMS',
  '50035': 'DISCORD_INVALID_PAYLOAD',
};

// FFmpeg's negative AVERROR tags arrive as unsigned 32-bit exit codes on Windows.
// https://ffmpeg.org/doxygen/trunk/group__lavu__error.html
const FFMPEG_HTTP_ERRORS: Record<number, string> = {
  [-0x333034f8]: 'SOURCE_BLOCKED', // HTTP 403
  [-0x313034f8]: 'PRIVATE_CONTENT', // HTTP 401
  [-0x343034f8]: 'UNAVAILABLE_VIDEO', // HTTP 404
  [-0x393234f8]: 'SOURCE_RATE_LIMITED', // HTTP 429
  [-0x585835f8]: 'SOURCE_UNAVAILABLE', // HTTP 5xx
};

function classifyFFmpegExit(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined;
  const match = /^ffmpeg exited with code (-?\d+)$/i.exec(message);
  if (!match) return undefined;
  const exitCode = Number(match[1]);
  if (!Number.isInteger(exitCode) || exitCode < -0x80000000 || exitCode > 0xffffffff) return undefined;
  return FFMPEG_HTTP_ERRORS[exitCode | 0];
}

export function classifyMusicError(error: unknown): string {
  const messages: string[] = [];
  let fallbackCode = 'UNKNOWN';
  const visited = new Set<unknown>();
  for (let current = error; current && !visited.has(current) && visited.size < 5;) {
    visited.add(current);
    if (typeof current === 'string') {
      messages.push(current);
      break;
    }
    if (typeof current !== 'object') break;
    const candidate = current as { errorCode?: unknown; code?: unknown; message?: unknown; stderr?: unknown; cause?: unknown };
    const rawCode = candidate.errorCode ?? candidate.code;
    const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';
    const knownCode = Object.hasOwn(CODE_ALIASES, code) ? CODE_ALIASES[code]! : code;
    if (knownCode === 'FFMPEG_EXITED') {
      const httpError = classifyFFmpegExit(candidate.message);
      if (httpError) return httpError;
    }
    if (Object.hasOwn(ERROR_DESCRIPTIONS, knownCode)) return knownCode;
    if (/^[A-Z0-9_]{1,64}$/.test(code)) fallbackCode = code;
    if (typeof candidate.message === 'string') messages.push(candidate.message);
    if (typeof candidate.stderr === 'string') messages.push(candidate.stderr);
    current = candidate.cause;
  }

  const message = messages.join('\n');
  const patterns: [RegExp, string][] = [
    [/confirm you(?:'|’)?re not a bot|HTTP (?:Error |error )?403|403 Forbidden/i, 'SOURCE_BLOCKED'],
    [/HTTP (?:Error |error )?429|429 Too Many Requests/i, 'SOURCE_RATE_LIMITED'],
    [/age[- ]restricted|confirm your age|age verification/i, 'AGE_RESTRICTED'],
    [/private (?:video|playlist)|(?:video|playlist) is private|login required|sign in|log in|members[- ]only|requires authentication/i, 'PRIVATE_CONTENT'],
    [/not available in your country|not made .*available in your country|not available (?:in|from) your (?:region|location)|geo[- ]restrict/i, 'GEO_RESTRICTED'],
    [/video (?:is )?unavailable|video has been removed|video (?:is )?deleted|HTTP (?:Error |error )?404/i, 'UNAVAILABLE_VIDEO'],
    [/requested format (?:is )?not available|no (?:playable|video|audio) formats found/i, 'UNPLAYABLE_FORMATS'],
    [/timed? ?out|ETIMEDOUT|UND_ERR_(?:CONNECT|HEADERS)_TIMEOUT/i, 'NETWORK_TIMEOUT'],
    [/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|unable to resolve|name or service not known|temporary failure in name resolution/i, 'NETWORK_ERROR'],
    [/HTTP (?:Error |error )?5\d\d/i, 'SOURCE_UNAVAILABLE'],
    [/spawn .*yt-dlp.*ENOENT/i, 'YTDLP_NOT_FOUND'],
    [/did not return a playable stream URL|cannot resolve a stream URL/i, 'CANNOT_GET_STREAM_URL'],
  ];
  return patterns.find(([pattern]) => pattern.test(message))?.[1] ?? fallbackCode;
}

export function musicErrorTitle(error: unknown): string {
  return (ERROR_DESCRIPTIONS[classifyMusicError(error)] ?? ERROR_DESCRIPTIONS['UNKNOWN']!).title;
}

export function describeMusicError(error: unknown, context: MusicErrorContext = {}): string {
  const code = classifyMusicError(error);
  const description = ERROR_DESCRIPTIONS[code] ?? ERROR_DESCRIPTIONS['UNKNOWN']!;
  const source = context.source === 'youtube' ? 'YouTube y YouTube Music' : 'SoundCloud';
  const detail = code === 'CANNOT_RESOLVE_SONG' && context.source
    ? `La búsqueda no devolvió canciones; se probaron YouTube, YouTube Music y SoundCloud empezando por ${source}.`
    : description.detail;
  const song = context.songName ? `\nCanción: **${escapeMarkdown(context.songName.slice(0, 160))}**` : '';
  return `❌ **${description.title}**${song}\n${detail}\n\n💡 ${description.hint}\n\nCódigo: \`${code}\``;
}
