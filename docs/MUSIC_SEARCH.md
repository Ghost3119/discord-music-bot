# SONORA — Music Search 1.0

Buscador musical multiproveedor integrado en el dashboard web de SONORA para descubrir, reproducir, encolar y guardar canciones de **YouTube Music**, **YouTube** y **SoundCloud** sin copiar enlaces externos.

## 1. Arquitectura

- **Backend (`src/web/musicSearch.ts`, `src/web/server.ts`)**:
  - `createMusicSearchService` implementa una capa de proveedores (`MusicSearchProvider`) que consulta los extractores existentes de `yt-dlp` en modo `flatPlaylist` (solo metadatos, sin resolver ni descargar streams de audio ni invocar FFmpeg).
  - Los resultados se normalizan al contrato `MusicSearchTrack` (`src/web/contracts.ts`), compatible directamente con `Track` (`source: 'youtube' | 'soundcloud'`, `url` pública canónica) para que funcionen sin adaptadores paralelos con Cola, Reproducción, Favoritos, Playlists y `Artwork`.
  - Cuando el usuario reproduce o añade a la cola un resultado (`POST /api/guilds/:guildId/actions` con `action: 'play'` y `track`), `validation.ts` valida `trackMetadata` y `webBridge.ts` siembra `urlInfoCache` (`seedTrackInfo`), evitando una segunda consulta de metadatos antes de encolar en DisTube.
- **Frontend (`frontend/src/features/dashboard/PlayerView.tsx`, `frontend/src/features/search/SearchView.tsx`)**:
  - Buscador unificado directamente en la barra superior de **Ahora suena** (`PlayerView.tsx`), sin requerir una pestaña adicional en la barra lateral.
  - Conforme el usuario escribe (con debounce de 320 ms, o al pulsar `Enter`), se despliega el panel `.unified-search-panel` con sugerencias rápidas, selector de plataforma accesible (`role="radiogroup"` con navegación por teclado), resultados en vivo con portadas, cancelación automática de búsquedas obsoletas mediante `AbortController` y renderizado diferido (`.track-row-deferred`) a partir de la fila 25. Si se pega un enlace directo (YouTube, Spotify, Apple Music, SoundCloud), el botón `+ Agregar` lo envía directo a la cola.

## 2. Proveedores implementados

| Plataforma | Identificador | Mecanismo de consulta | Notas de comportamiento |
| --- | --- | --- | --- |
| **Todas** | `all` | Ejecución paralela acotada de los 3 proveedores | Intercala resultados por relevancia, deduplica videos compartidos entre YouTube Music y YouTube fusionando su duración, y tolera fallos individuales (`partial: true`). |
| **YouTube Music** | `youtube_music` | `yt-dlp` sobre `https://music.youtube.com/search?q=…#songs` (`flatPlaylist: true`) + enriquecimiento ligero de autor vía YouTube `oEmbed` | Prioriza la estantería de canciones (`#songs`) de YouTube Music. Como el modo plano de `YoutubeTabIE` no incluye `uploader` ni `duration`, se enriquece el artista mediante `oEmbed` (con caché TTL y concurrencia máxima de 4) limpiando el sufijo `- Topic`. |
| **YouTube** | `youtube` | `yt-dlp` con `ytsearchN:<query>` (`flatPlaylist: true`) | Devuelve título, canal/artista, duración, miniatura, ID de 11 caracteres y URL canónica `https://www.youtube.com/watch?v=<id>`. |
| **SoundCloud** | `soundcloud` | `yt-dlp` con `scsearchN:<query>` (`flatPlaylist: true`) | Devuelve título, artista (`artists` / `uploader`), duración, URL pública `https://soundcloud.com/<user>/<slug>` y miniatura `t500x500` de `sndcdn.com`. |

## 3. Normalización de metadatos

- **Artista vs. canal**: Se elimina automáticamente el sufijo `- Topic` de canales autogenerados (`Feid - Topic` → `artist: "Feid"`, conservando `channel: "Feid - Topic"`). Si el canal es distinto del artista (ej. `FeidVEVO`), la interfaz muestra `Artista · Canal`.
- **Preservación de versiones**: Nunca se recortan etiquetas de versión (`Remix`, `Live`, `Acoustic`, `Cover`, `Instrumental`).
- **Miniaturas**: Se validan contra la lista blanca HTTPS (`sanitizeThumbnailUrl`). En YouTube/YouTube Music se usa fallback por ID (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`) solo cuando el ID de 11 caracteres es válido. En SoundCloud se prioriza la portada `500×500` (`t500x500`) y, si una pista carece de portada, se mantiene `null` (mostrando el fallback visual de `Artwork` sin reutilizar portadas ajenas).

## 4. Endpoint REST

### `GET /api/guilds/:guildId/search`

- **Parámetros query**:
  - `q` (o `query`): texto de búsqueda (`1–200` caracteres).
  - `platform`: `all` (por defecto) | `youtube_music` | `youtube` | `soundcloud`.
  - `limit`: `1–15` (por defecto `8` en plataforma individual y `5` por proveedor en `all`).
- **Respuesta `200 OK`**:
  ```json
  {
    "query": "Feid Luna",
    "platform": "all",
    "results": [
      {
        "id": "youtube_music:aqs0aXBBC8g",
        "url": "https://www.youtube.com/watch?v=aqs0aXBBC8g",
        "title": "LUNA",
        "artist": "Feid",
        "channel": "Feid - Topic",
        "duration": 197,
        "thumbnail": "https://i.ytimg.com/vi/aqs0aXBBC8g/hqdefault.jpg",
        "source": "youtube",
        "sourceId": "aqs0aXBBC8g",
        "platform": "youtube_music"
      }
    ],
    "providers": [
      { "platform": "youtube_music", "ok": true, "count": 1 },
      { "platform": "youtube", "ok": true, "count": 1 },
      { "platform": "soundcloud", "ok": true, "count": 1 }
    ],
    "partial": false
  }
  ```

## 5. Seguridad y permisos

- **Autenticación y aislamiento de servidor**: Requiere sesión OAuth2 válida (`401`) y membresía activa en `:guildId` (`403`), revalidando sesión y acceso al finalizar la consulta antes de entregar resultados.
- **Permisos de voz desacoplados para lectura**: Consultar resultados y guardarlos en Favoritos o Playlists solo requiere pertenecer al servidor. Las acciones de reproducción (`Reproducir`, `A la cola`) validan permisos de canal de voz y CSRF en `POST /api/guilds/:guildId/actions`.
- **Protección contra SSRF e inyección**: `validateMusicSearchQuery` rechaza esquemas de URL (`https://`, `file://`, `//`, dominios directos), caracteres de control y prefijos arbitrarios de `yt-dlp`.
- **Presupuestos y límites**: Rate limit de 30 consultas/minuto por ruta, límite de concurrencia de 6 búsquedas simultáneas, deduplicación de consultas idénticas en vuelo y caché en memoria con TTL de 5 minutos.

## 6. Limitaciones conocidas

- El extractor plano de búsqueda de YouTube Music (`https://music.youtube.com/search?q=…#songs` con `flatPlaylist: true`) no expone la duración de cada pista sin resolver cada video individualmente. Cuando la búsqueda se realiza en modo `Todas` y el mismo video aparece en YouTube, la duración se fusiona automáticamente; en búsquedas exclusivas de YouTube Music sin duración plana, la interfaz muestra `—` sin inventar valores `0:00`.

## 7. Pruebas y pasos de uso

- **Pruebas**:
  - Backend: `node --test test/musicSearch.test.js`
  - Frontend: `npm --prefix frontend test -- test/music-search.test.tsx`
- **Uso en el dashboard**:
  1. Abre **Buscar música** en la barra lateral izquierda.
  2. Escribe el nombre de una canción, artista o versión y elige la plataforma (**Todas**, **YouTube Music**, **YouTube** o **SoundCloud**).
  3. Pulsa **Enter** o **Buscar**.
  4. Usa **Reproducir**, **A la cola**, el icono de **Favoritos** o **+** (**Guardar en playlist**) sobre cualquier resultado.
