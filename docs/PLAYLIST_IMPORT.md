# SONORA — Importador de playlists (`docs/PLAYLIST_IMPORT.md`)

## 1. Arquitectura del importador

El importador de playlists permite incorporar colecciones públicas de **YouTube Music** y **YouTube** directamente a la biblioteca de SONORA en dos fases desacopladas:

1. **Fase de vista previa (`POST /api/guilds/:guildId/playlists/import/preview`)**:
   - Valida que el enlace pertenezca a una plataforma permitida y que el usuario tenga sesión activa, token CSRF válido y membresía en el servidor (`guildId`).
   - Invoca el servicio `PlaylistImportService` (`src/web/playlistImport.ts`) con un `AbortSignal` vinculado al ciclo de vida de la petición HTTP (`beginOperation` en `src/web/server.ts`).
   - Extrae únicamente los metadatos de la playlist y de sus canciones mediante `yt-dlp` en modo plano (`--flat-playlist`), sin resolver flujos de audio ni interferir con el `Smart Audio Preloader`.
   - Devuelve un objeto `ImportedPlaylistPreview` con título, autor/canal, portada, contadores (`totalCount`, `importedCount`, `omittedCount`, `truncated`) y la lista ordenada de canciones (`ImportedPlaylistTrack[]`).

2. **Fase de guardado por lotes (`POST /api/guilds/:guildId/playlists/import`)**:
   - Recibe el nombre elegido por el usuario, las canciones seleccionadas y un identificador de idempotencia (`requestId`).
   - Valida cada pista con `trackMetadata` (`src/web/validation.ts`), asegurando URLs canónicas públicas HTTPS y miniaturas limpias de hosts autorizados (`IMAGE_HOSTS`).
   - Persiste la playlist y todas sus pistas en una única transacción SQLite (`createPlaylistWithTracks` en `src/web/database.ts`), insertando las canciones en bloques de 50 filas.

```
[Cliente React: PlaylistImportDialog]
       │
       ├─ 1. POST /playlists/import/preview ──► [PlaylistImportService]
       │                                              │
       │                                              ├─► YouTubePlaylistImportAdapter ('youtube')
       │                                              ├─► YouTubePlaylistImportAdapter ('youtube_music')
       │                                              └─► SpotifyPlaylistImportStubAdapter ('spotify')
       │                                                        │
       │                                            runYtDlp(--flat-playlist, paginado)
       │
       └─ 2. POST /playlists/import ──────────► [WebDatabase.createPlaylistWithTracks]
                                                      │
                                            Transacción SQLite (lotes de 50 filas)
```

---

## 2. Extractores utilizados

- **Extractor principal**: `yt-dlp` a través del ejecutor compartido `runYtDlp` (`src/music/ytDlpRunner.ts`), que aplica el `ExtractionPool` (límite de concurrencia de 3 procesos simultáneos, cola máxima de 50 y timeout por intento de 20 s).
- **Flags utilizados**:
  - `flatPlaylist: true` (`--flat-playlist`): obtiene los metadatos de las entradas del catálogo sin consultar los formatos de vídeo/audio individuales.
  - `playlistStart` y `playlistEnd`: paginación por ventanas (`DEFAULT_IMPORT_PAGE_SIZE = 100`) hasta alcanzar el total de la lista o el tope (`DEFAULT_IMPORT_MAX_TRACKS = 500`).
  - `skipDownload: true`, `simulate: true`, `noWarnings: true`.
- **Resolución diferida de audio**: cuando el usuario reproduce una canción o carga la playlist en la cola, el motor existente (`YtDlpSearchPlugin` + `Smart Audio Preloader`) resuelve el stream bajo demanda y aprovecha `seedTrackInfo` con los metadatos ya guardados.

---

## 3. Formatos de URL aceptados y rechazados

### Aceptados (`youtube` y `youtube_music`)

- `https://www.youtube.com/playlist?list=<ID>`
- `https://youtube.com/playlist?list=<ID>`
- `https://m.youtube.com/playlist?list=<ID>`
- `https://music.youtube.com/playlist?list=<ID>`
- `https://www.youtube.com/watch?v=<VIDEO_ID>&list=<ID>`
- `https://music.youtube.com/watch?v=<VIDEO_ID>&list=<ID>`
- `https://youtu.be/<VIDEO_ID>?list=<ID>`

*(Para `music.youtube.com`, el importador preserva `platform: 'youtube_music'` y normaliza la consulta de extracción a `https://www.youtube.com/playlist?list=<ID>` para garantizar compatibilidad total con el extractor `youtube:tab` de `yt-dlp`).*

### Reconocidos con aviso (adaptador preparado)

- `https://open.spotify.com/playlist/<22-base62-id>` (incluyendo variantes `/intl-xx/playlist/…`): detecta la plataforma `spotify` y devuelve `501 Not Implemented` con un mensaje claro en la interfaz.

### Rechazados (`400 Bad Request` / `403 Forbidden`)

- Enlaces HTTP sin TLS, o con credenciales (`user:pass`), puertos explícitos o fragmentos (`#hash`).
- Enlaces de canciones individuales sin parámetro `list=` (`/watch?v=…` o `youtu.be/…`).
- Playlists privadas ligadas a la cuenta del usuario: `WL` (*Watch Later*), `LL` (*Liked Videos*) y `LM` (*Liked Music* en YouTube Music).
- Cualquier dominio externo o IP privada/local (`127.0.0.1`, `localhost`, `file://`, etc.).

---

## 4. Metadatos y sistema de portadas

Para cada entrada disponible se importa:

- `title`: título limpio de caracteres de control (hasta 300 caracteres).
- `artist`: obtenido de `artist`, `uploader`, `channel` o `creators[0]`, eliminando el sufijo automático ` - Topic` de YouTube Music. Si no existe, usa `Artista desconocido`.
- `duration`: duración en segundos (entero `0..604800`).
- `url`: URL canónica pública `https://www.youtube.com/watch?v=<ID>`.
- `source`: `'youtube'` (compatible con el contrato `Track` de SONORA).
- `sourceId`: identificador de 11 caracteres del vídeo.
- `platform`: `'youtube'` o `'youtube_music'`.
- `position`: índice secuencial basado en cero.
- `thumbnail`: miniatura individual de la canción validada contra `IMAGE_HOSTS` y sin query strings (`?sqp=…`), o fallback `youtubeThumbnail('youtube', sourceId, url)`.
  - **Invariante de portadas**: nunca se asigna la carátula general de la playlist a las canciones individuales. En el navegador, el componente `Artwork` (`frontend/src/components/artwork.tsx`) mantiene la detección de placeholders `120x90` de YouTube (`unavailableYouTubeImage`).

---

## 5. Persistencia y política frente a fallos parciales

### Durante la extracción (vista previa)
- Las entradas eliminadas o privadas (`[Deleted video]`, `[Private video]`, `availability: 'private'`) se omiten automáticamente e incrementan el contador `omittedCount`, permitiendo al usuario revisar e importar todas las canciones válidas restantes.
- Si **todas** las entradas son inaccesibles o la playlist está vacía, el backend responde con `422 Unprocessable Entity` y no permite guardar una playlist vacía.

### Durante el guardado (commit en SQLite)
- Se reutilizan las tablas `playlists` y `playlist_tracks` existentes (`src/web/schema.ts`), sin migraciones destructivas ni esquemas paralelos.
- **Política atómica todo-o-nada**: `WebDatabase.createPlaylistWithTracks` valida primero todas las pistas seleccionadas y ejecuta la creación de la playlist y la inserción por lotes (bloques de 50 filas) dentro de una única transacción SQLite (`this.orm.transaction(...)`). Si cualquier canción incumple el contrato o se alcanza el límite de playlists, la transacción completa hace rollback y nunca queda una playlist incompleta o corrupta.
- **Protección contra doble clic**: el cliente bloquea envíos concurrentes (`savingLockRef`) y envía un `requestId` único por operación. El servidor rechaza importaciones simultáneas del mismo usuario/servidor (`409 Conflict`) y devuelve de forma idempotente la playlist ya creada si recibe el mismo `requestId`.

---

## 6. Límites y rendimiento

| Parámetro | Valor | Propósito |
| --- | --- | --- |
| `DEFAULT_IMPORT_PAGE_SIZE` | `100` pistas | Tamaño de página por invocación `--flat-playlist` |
| `DEFAULT_IMPORT_MAX_TRACKS` | `500` pistas | Tope máximo de canciones por playlist en SONORA |
| `MAX_PLAYLISTS_PER_USER_GUILD` | `100` playlists | Límite de colecciones por usuario y servidor |
| Cedido al event loop | Cada `50` pistas | `setImmediate` durante la normalización para no bloquear Node.js |
| `content-visibility: auto` | A partir de la fila 13 | Diferido de renderizado DOM en `PlaylistImportDialog` (`contain-intrinsic-size: auto none auto 48px`) |
| Timeout de vista previa | `60 000 ms` | Cancelación automática y propagación de `AbortSignal` a `yt-dlp` |
| Body limit en `/playlists/import` | `524 288 bytes` (512 KB) | Permite recibir lotes de hasta 500 canciones con metadatos |

---

## 7. Pruebas ejecutadas

### Automatizadas con fixtures deterministas
- **Backend (`test/playlistImport.test.js`)**:
  - Validación de URLs de YouTube, YouTube Music (`/playlist` y `/watch?v=…&list=…`), Spotify y rechazo de enlaces inválidos, privados (`WL`, `LL`, `LM`) o de dominios no autorizados.
  - Extracción paginada de playlists de más de 100 canciones (120 pistas simuladas en 3 páginas), preservación de duplicados intencionales, fallback de miniaturas ausentes, metadatos incompletos y omisión contabilizada de vídeos eliminados.
  - Manejo de playlists privadas (`403`), vacías (`422`), adaptador stub de Spotify (`501`), timeout (`504`) y cancelación por cierre de conexión HTTP (`AbortSignal`).
  - Guardado atómico en SQLite de 121 canciones, verificación de orden secuencial (`0..120`), rollback completo ante fallos en una entrada intermedia e idempotencia ante doble clic (`requestId`).
  - Seguridad: autenticación OAuth2, verificación CSRF, permisos de servidor y aislamiento de datos entre usuarios y servidores.
- **Frontend (`frontend/test/playlist-import.test.tsx`)**:
  - Detección instantánea de plataforma y estado del enlace (`inspectPlaylistUrl`).
  - Botón «Importar playlist» en `LibraryView`.
  - Flujo completo montado en DOM (`PlaylistImportDialog`): pegar URL de YouTube Music, analizar, revisar vista previa, deseleccionar canciones, renombrar la playlist, protección contra doble clic, guardar y abrir la playlist recién importada.
  - Cancelación en vuelo al pulsar «Cancelar», al cambiar de servidor (`guildId`) o al cerrar y reabrir el diálogo.

### Consulta real controlada
- Se verificó en vivo `PlaylistImportService.previewPlaylist` contra la playlist pública oficial de YouTube Music `https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i` (*Top 100 Songs Global* de *YouTube Music Global Charts*), comprobando la extracción real con `yt-dlp --flat-playlist`, limpieza de URLs de miniaturas, duración y nombres de artistas.

---

## 8. Procedimiento manual de uso

1. Abre el dashboard de SONORA e inicia sesión con tu cuenta de Discord autorizada.
2. En la barra lateral izquierda, entra en **Mi biblioteca**.
3. En la esquina superior derecha, junto a **Nueva playlist**, pulsa **Importar playlist**.
4. Pega el enlace público de una playlist de YouTube Music o YouTube y pulsa **Analizar**.
5. Revisa la ficha de la playlist (portada, autor, plataforma y número de canciones disponibles).
6. *(Opcional)* Cambia el nombre bajo **Nombre en tu biblioteca** y marca o desmarca las canciones que quieras incluir.
7. Pulsa **Importar (N)** y espera a que termine el guardado por lotes.
8. Pulsa **Abrir playlist importada** para ver tu nueva colección o enviarla a la cola de reproducción con **Escuchar**.

---

## 9. Importación desde Spotify y archivo CSV (Viabilidad e Implementación Controlada)

### 9.1 Análisis de viabilidad oficial de Spotify Web API
De acuerdo con la documentación oficial vigente de Spotify for Developers:
1. **Endpoints de lectura**: `GET /v1/playlists/{playlist_id}` y `GET /v1/playlists/{playlist_id}/tracks` (con paginación de hasta 100 elementos por página).
2. **Restricciones en Development Mode**:
   - Las playlists algorítmicas y editoriales propiedad de Spotify devuelven `404 Not Found` para aplicaciones en Development Mode.
   - El límite de usuarios autorizados en Development Mode es de **5 usuarios** dados de alta manualmente en el panel de desarrolladores de Spotify (`403 Forbidden` para usuarios fuera de la lista).
   - El propietario de la aplicación en Development Mode debe mantener una suscripción **Spotify Premium** activa; si caduca, el acceso a la API se suspende inmediatamente.
3. **OAuth2 y Client Credentials**:
   - `grant_type=client_credentials` no incluye contexto de usuario, por lo que no permite leer playlists privadas, colaborativas ni listas restringidas en Development Mode.
   - La lectura autorizada de playlists de usuario requiere **Authorization Code Flow** con los scopes `playlist-read-private` y `playlist-read-collaborative`.
4. **Políticas y restricciones de metadatos**:
   - Los términos de Spotify prohíben descargar o extraer flujos de audio de Spotify. SONORA nunca descarga audio de Spotify: almacena únicamente metadatos públicos y enlaces canónicos (`https://open.spotify.com/track/<id>`) o consultas de búsqueda reproducibles por el motor existente.

### 9.2 Adaptador `SpotifyPlaylistImportAdapter` (Fase B)
- Implementado en `src/web/playlistImport.ts` cumpliendo `PlaylistImportAdapter`.
- Cuando se proporciona un token o credenciales autorizadas (`SpotifyPlaylistImportAdapterOptions`), consulta `GET /v1/playlists/{id}` y pagina `GET /v1/playlists/{id}/tracks`, omitiendo pistas locales (`is_local === true`) y episodios de podcast (`type !== 'track'`).
- Mapea estados de error de forma explícita:
  - `401` (`SPOTIFY_NOT_CONNECTED`): sesión expirada o no conectada.
  - `403` (`SPOTIFY_INSUFFICIENT_PERMISSIONS`): falta de permisos o límite de 5 usuarios en Development Mode.
  - `404` (`SPOTIFY_PLAYLIST_INACCESSIBLE`): playlist privada, editorial o restringida por Development Mode.
  - `429` (`SPOTIFY_RATE_LIMITED`): límite de solicitudes alcanzado.
  - `501` (`SPOTIFY_IMPORT_UNSUPPORTED`): credenciales directas no configuradas, ofreciendo cambio en un clic a la pestaña **Archivo CSV**.

### 9.3 Importación controlada por CSV (Fase C — Siempre disponible)
- Endpoint: `POST /api/guilds/:guildId/playlists/import/csv` (`parsePlaylistImportCsv` en `src/web/playlistImport.ts`).
- Compatible con archivos `.csv` exportados desde **Exportify**, **TuneMyMusic**, **Soundiiz** o creados manualmente:
  - **Título** (obligatorio): `Title`, `Track Name`, `Título`, `Track`, `Song`.
  - **Artista** (obligatorio): `Artist`, `Artist Name(s)`, `Artista`, `Artists`.
  - **Álbum** (opcional): `Album`, `Album Name`, `Álbum`.
  - **Duración** (opcional): `Duration`, `Duration (ms)`, `Duración` (acepta segundos, milisegundos o `mm:ss` / `hh:mm:ss`).
  - **Origen / URL** (opcional): `Spotify URI` (`spotify:track:<id>`), `Track URI`, `Track ID`, `URL` (`open.spotify.com/track/…`, `youtube.com/watch?v=…`, `soundcloud.com/…`, `music.apple.com/…`). Si la fila no incluye URL ni ID, SONORA genera una referencia de búsqueda canónica (`source: 'csv'`) que se resuelve automáticamente al reproducir.
- **Seguridad**: límite de `256 KB` (`413`), validación de UTF-8 (`400`), parser RFC-4180 con soporte de delimitadores `,`, `;` y `\t`, y cero ejecución de solicitudes de red sobre URLs del CSV (prevención total de SSRF).
