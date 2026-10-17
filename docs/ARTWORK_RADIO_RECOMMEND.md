# Portadas, Radio y Recommend

Rama: `fix/sonora-artwork-radio-recommend`. Base limpia: `main` / `9b83204`, con Lyrics Reliability V2 integrado. Trabajo acotado siguiendo `AGENTS.md`, `targeted-patch` y `frontend-design`. Sin cambios en FFmpeg, DisTube, Smart Audio Preloader, reloj o intervalo SSE; sin dependencias ni migraciones nuevas.

## Portadas: causa y corrección

La extracción de álbumes/playlists usa `flatPlaylist:true` (máximo 500 entradas); YouTube Mix también es plano (máximo 60 candidatos). `createSong` solo tomaba `thumbnail` o el primer `thumbnails[].url`. Si ambos faltaban, la canción quedaba sin imagen aunque tuviera un ID de video válido. La extracción individual suele traer esa imagen; la diferencia se reproduce con fixtures en la normalización, antes de REST/React. DisTube conserva la portada recibida de cada canción: su constructor Playlist no sustituye imágenes por la del álbum.

Nuevo helper puro `src/music/artwork.ts`: conserva metadatos presentes; cuando falta la imagen, construye `https://i.ytimg.com/vi/{id}/hqdefault.jpg` exclusivamente para fuentes YouTube y un ID válido de 11 caracteres. Comprueba identidad entre ID y URL, hosts/esquemas reconocidos y rechaza contradicciones. Nunca hereda la portada padre a las entradas, inventa un ID, descarga imágenes o resuelve audio para obtenerlas. Las listas parciales, entradas nulas y estructuras de miniaturas inesperadas ya no rompen el álbum.

Las tres regresiones iniciales (álbum, Mix y biblioteca) fallaron antes de corregir. Además, una prueba montada confirmó que React reutilizaba el mismo `<img>`: un error tardío anterior ocultaba la portada siguiente. Ahora el elemento usa la URL como `key`; la prueba falló antes y pasó después.

La revisión visual descubrió que un JPEG de miniatura inexistente puede decodificarse correctamente sin `onError`. Para URLs YouTube `mqdefault`, `hqdefault`, `sddefault` y `maxresdefault`, un JPEG/WebP de 120×90 se trata como respaldo del proveedor, en dashboard e inmersivo. Es una heurística acotada a esos hosts/rutas y dimensiones; `default.jpg` de 120×90, otros proveedores y miniaturas de calidad superior reales se conservan. Una regresión montada falló antes y pasa después. No se reintenta desde los snapshots SSE mientras la URL fallida siga siendo la misma en el componente.

## Cola, restauración y biblioteca

Las canciones de playlists y Mix comparten `createSong`, por lo que Radio y Recommend reciben el mismo respaldo individual. MusicBridge también puede proyectar una referencia para canciones antiguas sin imagen. Conserva el filtro de imágenes públicas y la exclusión de URLs firmadas.

Los checkpoints ya soportaban `thumbnail`: se guarda/restaura su referencia y se recupera una faltante desde identidad YouTube. El esquema SQLite también tenía el campo; nuevas altas normalizadas incluyen el respaldo. Las filas históricas con `NULL` obtienen la referencia al leerlas, sin modificar la fila ni iniciar un enriquecimiento masivo. La prueba comprueba explícitamente que el `NULL` continúa en SQLite.

## Radio: es `/autoplay`

No existe ni se creó `/radio`. `/autoplay` no recibe argumentos: exige canción actual y mismo canal de voz, alterna `queue.toggleAutoplay()` y DisTube busca relacionados cuando termina la cola. Su lógica de cambio se comparte mediante `updateRadio`; el comando conserva nombre, descripción y mensajes.

El snapshot REST/SSE publica el verdadero `queue.autoplay` (false sin cola activa). El dashboard envía `{action:'autoplay',enabled:boolean}` por `/actions`; expresar el estado deseado evita invertirlo dos veces al repetir una petición. Toma el bloqueo nativo y revalida acceso/voz/cancelación. No hay estado Radio optimista ni un sistema de radio adicional.

## Recommend: mismo YouTube Mix

`/recommend` admite `cantidad` opcional 1–20, por defecto 5. El dashboard usa una acción directa de 5, sin formulario obligatorio. La API admite `amount` validado con los mismos límites.

`src/music/recommendations.ts` extrae el algoritmo existente: semillas de canción actual y última de cola, segunda semilla si hace falta, exclusión de IDs/URLs presentes e historial y límite solicitado. El comando conserva sus opciones y respuestas, y reexporta `selectRecommendations` por compatibilidad. No se añadió otro algoritmo.

La búsqueda se realiza fuera del bloqueo de audio. La incorporación final usa el bloqueo nativo; vuelve a comprobar sesión, cola, revisión, canciones originales, voz y permisos. Una búsqueda pendiente por cola evita incorporaciones concurrentes duplicadas. Los Mix conservan su caché y ahora comparten cancelación por consumidor: cancelar uno no cancela los demás; salir el último libera la extracción. La ruta web distingue todos los extractores fallidos (503) de una consulta válida sin novedades (0); Discord conserva su comportamiento de aviso sin resultados cuando no logra obtener candidatos.

## Contratos, interfaz y seguridad

- `PlaybackSnapshot.autoplay`; `MusicAction` añade `autoplay`/`recommend`, `enabled` y `amount`; `MusicControlResult` devuelve `autoplay` o `recommendationsAdded`. Adaptadores antiguos que devuelven void siguen siendo compatibles; Radio sin estado se muestra deshabilitada.
- Se reutilizan POST `/api/guilds/:guildId/actions`, sesión, membresía, permisos de voz, CSRF, límites y deadlines existentes. No se añadió SSE, endpoint de proxy ni destino externo arbitrario.
- `MusicTools` aparece bajo los controles de la canción y en el inmersivo; mantiene colores/tipografía SONORA. Estado real, carga, falta de permisos y nombres accesibles; sin formulario ni animaciones adicionales y con reduced-motion.
- `useSonoraApp` bloquea doble clic de forma síncrona y envía AbortSignal. Cambio de guild, logout, expiración y desmontaje abortan la operación; respuestas tardías no publican mensajes en otra sesión. Resultado/ausencia/error se anuncian en dashboard y también dentro del inmersivo.

## Pruebas y validación

Baseline focalizado backend: **61 aprobadas** antes de modificar. No se eliminaron pruebas. Las anteriores de restauración ahora esperan la miniatura recuperada y siguen comprobando ausencia de secretos; el contrato antiguo de acciones verifica además el nuevo AbortSignal.

Validación final del 17 de octubre de 2026: `npm run build` aprobado (TypeScript backend/frontend y Vite); `npm test`: **457 backend + 191 frontend = 648 aprobadas**, sin fallos ni omitidas; `npm run deploy:check`: 19 comandos existentes, sin contactar Discord; `git diff --check` aprobado. No hay `/radio`, nuevas dependencias o ciclos nuevos de imports. Una ejecución encontró `ECONNRESET` en la prueba existente de socket de 20 ms; también falló una vez aislada y luego aprobó aislada y en la suite completa sin cambios de código/test ni relajación del timeout. Se documenta como intermitencia observada, sin atribuirle una causa no demostrada.

Cobertura nueva: portadas individuales/listas planas/Mix/Radio, duplicados, IDs inválidos y contradictorios, metadata parcial, persistencia sin reescritura; flags Radio e idempotencia; REST/SSE, auth/CSRF/guild, límites de parámetros; bloqueo nativo, cambios de voz/membresía/cola, abort y concurrencia; fallos de extractor frente a vacío. React montado con StrictMode comprueba estado autoritativo, doble clic, cambio de servidor, mensajes, permisos, errores tardíos de imagen y JPEG de respaldo.

Preview aislado 4190/4191, SQLite en memoria y música/portadas sintéticas. Revisados dashboard, cola, biblioteca, inmersivo, Radio activo/inactivo, recomendaciones con resultados/vacías/error, miembro sin voz y portada inexistente. Escritorio 1280×720/900, móvil 390×844 y compacto 390×667: sin desbordamiento horizontal ni controles fuera del viewport. Las imágenes normales cargaron y la consola normal no mostró errores/advertencias; los escenarios de fallo generan las respuestas HTTP esperadas sin trazas internas. El JPEG de respaldo dejó cero imágenes dentro de la carátula inmersiva y mostró SONORA.

Capturas sin edición: [dashboard](screenshots/artwork-radio-recommend/desktop-dashboard.png), [biblioteca](screenshots/artwork-radio-recommend/desktop-library.png), [inmersivo móvil](screenshots/artwork-radio-recommend/mobile-immersive.png) y [respaldo](screenshots/artwork-radio-recommend/desktop-fallback.png).

Comprobación de red limitada: HEAD al CDN oficial el 17-10-2026 05:54:50 UTC (16-10 23:54:50 local). Video público `dQw4w9WgXcQ`: 200, image/jpeg; ID sintético `AAAAAAAAAAA`: 404, image/jpeg. No se descargó el cuerpo. La [documentación oficial de miniaturas](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails) describe tamaños default/high y su disponibilidad variable. Estas consultas comprueban el destino y el manejo de ausencia, no una reproducción real de álbum.

## Límites y prueba pendiente en Discord

No se proporcionó el enlace de álbum histórico ni se hizo una extracción real de álbum de YouTube Music. El fallo y el flujo corregido se verificaron con entradas deterministas del extractor. No se probó Discord/OAuth/audio real ni se reinició el bot activo. Los IDs sintácticamente válidos pueden referir a videos privados, eliminados o inexistentes; la URL del CDN no garantiza contenido. Las imágenes firmadas/no admitidas continúan filtradas. El respaldo 120×90 es una heurística específica, no un detector general de contenido de imágenes.

Prueba humana: `/play` con el álbum real; comparar carátulas por canción en cola/biblioteca/inmersivo; ejecutar `/recommend` y el botón web; comprobar que ambos usan el mismo Mix; alternar `/autoplay` y Radio en web y observar REST/SSE; verificar cola vacía, permisos de voz, skip/cambio de servidor durante Mix y restauración del checkpoint. Confirmar continuidad del audio sin atribuir los resultados simulados a Discord.

Commits de implementación: `c123261` (metadatos, servicios compartidos, contratos/API y pruebas backend) y `b926bee` (interfaz, cancelación cliente y pruebas React). Documentación/capturas en un tercer commit. Sin push, merge ni despliegue; commits exclusivamente locales en la rama solicitada.

## Corrección tras la captura real de Recommend

El seguimiento del 17-10-2026 confirmó por REST, en la sesión local abierta del usuario, que las cinco recomendaciones de la captura tenían `thumbnail: null`. Una extracción de metadatos del Mix de `BbHnh72wRWQ` devolvió miniaturas `i.ytimg.com/vi/<id>/hqdefault.jpg` con parámetros `sqp` y `rs`, incluyendo `SeyrvkjarmY` y `oz3LxqoyQFQ`, presentes también en esa cola. No se descargó audio ni se modificó la cola activa.

La causa era el orden de evaluación: `artwork(song.thumbnail || youtubeThumbnail(...))` elegía primero la referencia con parámetros y luego el filtro la rechazaba, sin intentar el respaldo. Ahora se valida la miniatura original y, si se rechaza, se deriva y valida la referencia pública de la misma canción. La captura de checkpoints aplica el mismo orden. Se conservan los filtros de secretos, hosts y coincidencia entre ID/URL; las referencias públicas existentes mantienen prioridad.

Las regresiones fallaron antes del parche (Mix, validación, privacidad y checkpoint). Después: **98 pruebas focalizadas** y `npm test` completo, **459 backend + 191 frontend = 650 aprobadas**, sin fallos ni omitidas; `npm run build:bot` y `git diff --check` aprobados. Las cinco referencias públicas de la captura respondieron HEAD 200 `image/jpeg` y cargaron en SONORA a 480×360 en una vista aislada con SQLite en memoria, sin respaldo SONORA. [Captura de esa vista aislada](screenshots/artwork-radio-recommend/recommend-covers-recovered.png). Esa captura verifica las imágenes recuperadas; el proceso del bot activo conserva el código cargado hasta un reinicio autorizado. No se reinició ni se hizo push, merge o despliegue.

## Archivos principales

- Backend: `src/music/artwork.ts`, `recommendations.ts`, `ytDlpSearchPlugin.ts`, `queueRecovery.ts`, `webBridge.ts`; comandos `autoplay.ts`/`recommend.ts`; `src/web/{contracts,validation,database,server}.ts`.
- Frontend: `MusicTools.tsx`/`music-tools.css`, `artwork.tsx`, helper `lib/artwork.ts`, `NowPlaying`, `PlayerExperience`, `ImmersiveArtwork`, `ImmersiveControls`, `ImmersivePlayer`, `use-sonora-app` y paso de avisos en `App`.
- Pruebas: nuevas `test/artwork.test.js`, `frontend/test/music-tools.test.tsx`; ampliadas `recommend`, `webBridge`, `webDashboard`; expectativas de restauración y AbortSignal; fixture `test/helpers/dashboard-preview.cjs` y capturas.
