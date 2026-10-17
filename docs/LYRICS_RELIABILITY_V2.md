# Lyrics Reliability V2

Fecha local: 16 de octubre de 2026 (America/Mexico_City). Rama `fix/sonora-lyrics-reliability-v2`, base limpia `main` / `1ea233d`, con las mejoras anteriores de letras e inmersivo. Se aplicaron `AGENTS.md`, `targeted-patch` y la skill global `frontend-design`. No se modificó el motor de audio, FFmpeg, DisTube, reloj ni intervalo SSE.

## Fallos y evidencia real

Las consultas fueron secuenciales, identificadas como SONORA y limitadas a los casos reportados. Solo se imprimieron metadatos, conteos, estados y firmas de comparación; no letras completas.

| Caso | Evidencia | Resultado |
| --- | --- | --- |
| Used To Be My Girl / The Last Shadow Puppets | HTTP 200, JSON de 85.317 bytes, 13 registros. Siete candidatos de ~175 s tienen el mismo texto y tres juegos de timestamps. La consulta de 175 s reproducía `ambiguous`. | Ahora `plain`, ID 1532914, con advertencia de sincronizaciones distintas. Selección manual disponible. No se adivinan timestamps. |
| Facts (Charlie Heat Version) / Kanye West | HTTP 200, JSON de 309.418 bytes, 20 registros; dos duraciones `null`. El límite anterior de 256 KiB rechazaba el lote; `every(isLyricsRecord)` también rechazaba las duraciones desconocidas. | Límite de búsqueda de 1 MiB y duración nullable validada; con duración de prueba 201 s devuelve `synced`, ID 33356286, 63 líneas. `/api/get/33356286` también validado realmente. |
| Maripilili (EZYA RemixXx) / EZYA - Topic | HTTP 200 y `[]`, tanto con el canal como con artista limpio EZYA. No hubo DNS, timeout, 429 ni 503 en estas consultas. | `not_found`; no se reprodujo el error histórico de conexión. Se mejoraron preventivamente la clasificación DNS/socket y los mensajes. |

Consulta inicial: 17-10-2026 00:12:13–16 UTC (16-10 18:12 local). Validación del servicio corregido: 00:16:55–57 UTC y 00:20:02 UTC (18:16 y 18:20 local). Los originales de YouTube, URL, duración y álbum históricos no fueron proporcionados: 175/201 s se tomaron de registros públicos para validar, y 180 s en C fue un valor de prueba, no una medición de reproducción. No se afirma reconstruir esos snapshots históricos.

## Regresiones antes de corregir

Baseline: 30 pruebas backend de letras y 29 de interfaz/reloj, todas aprobadas. Las primeras ocho regresiones nuevas del proveedor tuvieron siete fallos antes del parche. También se confirmó fallando la regresión específica de texto idéntico con timestamps diferentes, y la de contenido vacío legítimo clasificado como respuesta inválida. La revisión final añadió una regresión de scroll al cambiar de letras a mitad de canción.

Los fixtures usan metadatos públicos y texto sintético original, sin catálogo de letras reales. Las pruebas originales del proveedor se conservaron intactas; en las antiguas de UI solo cambiaron expectativas de mensajes solicitados. La prueba de metadatos autoritativos ahora verifica también `durationReliable:false` para YouTube.

## Matching y normalización

1. Consulta con título/artista originales y álbum presente; duración evalúa candidatos localmente. Una segunda consulta, como máximo, limpia etiquetas cuando aporta una variante distinta.
2. Normalización Unicode, puntuación, espacios, etiquetas oficiales, Topic/VEVO y prefijo artista conocido. `featuring`/`feat` se normalizan conservando al colaborador. No se infiere artista a partir de cualquier canal.
3. Título/artista exactos normalizados; versión compatible en título y álbum. Remix, live, festival, cover, acoustic, instrumental, nightcore, demo, remaster, radio edit, slowed y sped up se conservan. Las versiones con nombre distinto siguen siendo diferentes por título.
4. Timestamps: diferencia máxima de 2 s. Álbum informado debe coincidir. Duplicados equivalentes: cercanía de duración e ID. Palabras distintas: `ambiguous`.
5. Texto/orden de líneas idénticos con timestamps contradictorios: texto normal y advertencia. Duración aproximada de YouTube: texto normal solo si todos los candidatos compatibles cercanos tienen el mismo texto y duración conocida, dentro de `max(15 s, 10%)`. Es una heurística conservadora explícita para texto, sin rebajar el umbral sincronizado.

`diagnostics` describe etapa, decisión y conteos; no incluye texto, URLs musicales ni errores internos. Una duración desconocida no adquiere sincronización automáticamente. Se omiten candidatos malformados individuales; un lote no vacío completamente malformado sigue siendo `invalid_response`.

## Búsqueda manual y seguridad

El diálogo Radix conserva la paleta/tipografía inmersiva, permite editar canción/artista y muestra álbum, duración y formato. Incluye carga, resultados vacíos, errores, foco, Escape, advertencia y confirmación explícita antes de usar una versión incompatible. La compatibilidad se calcula contra la canción real, aunque la búsqueda editada sea diferente. Permite volver a automático y buscar desde texto normal.

`GET /api/guilds/:guildId/lyrics/search` y `/selection` exigen sesión y acceso al servidor, revalidados tras la espera; comprueban canción/playback antes y después. Parámetros acotados y estructurados; no aceptan URLs arbitrarias. Selección exclusivamente de IDs devueltos en una búsqueda de esa sesión/guild/canción/playback/URL, válida 2 min, máximo 128 entradas RAM. Cada ruta tiene límite de 20 peticiones/minuto. La respuesta usa `no-store`.

El estado manual del cliente es temporal, por guild/track/playback, compartido entre consumidores. Se descartan búsquedas/selecciones tardías al cerrar o cambiar identidad. Reabrir y reconectar SSE conservando identidad permite recuperar la selección; repetir usa nuevo playback. Navegar a otro guild con el inmersivo cerrado y regresar exactamente al mismo playback puede conservar la selección válida. No hay persistencia en disco ni preferencias para futuras reproducciones.

Se revisaron [documentación oficial](https://lrclib.net/docs) y [repositorio oficial](https://github.com/tranxuanthang/lrclib). MIT corresponde al código del servidor, sin demostrar una licencia general de letras. Ante esa incertidumbre no se amplió almacenamiento persistente de texto ni referencias.

## Caché, concurrencia y errores

Una cola compartida para automático, búsqueda y registro: 1 HTTP activo, 300 ms de espaciado, máximo 8 trabajos, timeout de 8 s y plazo total de 20 s; ruta de 12 s. Fetch fijo HTTPS, sin redirecciones; límites de bytes recibidos: 1 MiB búsqueda, 256 KiB registro, máximo 20 registros y límites individuales de texto existentes.

Deduplicación, cancelación por suscriptor y clonación defensiva se preservan. Claves separan operaciones y fiabilidad de duración. Caché RAM de 64 entradas: positivas 10 min, negativas/ambiguas 60 s. Errores técnicos nunca se guardan como ausencia. 429/503 respetan `Retry-After` y cooldown global; no hay reintentos automáticos en bucle. El hook automático sigue compartiendo vuelos y tolerando StrictMode.

Se conservan `synced`, `plain`, `instrumental`, `not_found`, `ambiguous`, `temporary_error`, `idle`, `stale`; los errores técnicos usan `reason`: `rate_limited`, `timeout`, `connection`, `unavailable`, `invalid_response`, `busy`. DNS y socket interrumpido son conexión; 503 es disponibilidad; contenido vacío válido es ausencia. La UI ofrece acciones sin trazas internas.

## Archivos

- Backend: `src/web/lyrics/{contracts,matching,service}.ts`, `src/web/server.ts`.
- Frontend: `features/lyrics/{use-lyrics,manual-lyrics,ManualLyricsDialog,LyricsPanel}`, `features/immersive/immersive.css`.
- Pruebas: nuevas `test/lyricsReliability.test.js`, `frontend/test/manual-lyrics.test.tsx`; extendida `test/lyricsEndpoint.test.js`; mensajes de `immersive-lyrics` y `immersive-lifecycle`.
- Fixture: `test/helpers/dashboard-preview.cjs`, escenarios manuales sintéticos; documentación de proveedor y este documento.

## Validación

Validación final tras la regresión de scroll: `npm run build` aprobado (TypeScript backend, typecheck frontend y Vite); `npm test`: **438 backend + 183 frontend = 621 aprobadas**, sin fallos ni omitidas. Las 36 pruebas focalizadas del proveedor incluyen las 22 anteriores intactas y 14 nuevas; endpoints: 19; selección manual: 16. `npm run deploy:check`: 19 comandos válidos, sin contactar Discord. `git diff --check`: aprobado. Revisión completa del diff y revisión QA independiente sin hallazgos bloqueantes. Sin dependencias nuevas ni ciclos nuevos en imports.

Visual: fixture aislado en 4180/4181, SQLite en memoria, snapshots/letras originales simulados. Revisión de escritorio 1280×720 y 1280×900, móvil 390×844: búsqueda desde `not_found`/`ambiguous`, resultados, advertencia Live y confirmación, selección plain/synced, Portada/Letras, pausa/reanudación, skip y regreso automático. Escape restauró el foco al botón de búsqueda; sin desbordamiento horizontal en las medidas revisadas ni errores/advertencias de consola. Cerrar/reabrir la selección mantuvo 1 SSE activo, 2 conexiones totales y 6 consultas de proveedor, sin incremento. No es una prueba de audio real. La sesión simulada caducó durante la pausa de la tarea; se reinició únicamente el fixture de QA para terminar, sin tocar el bot.

Capturas sin edición: [búsqueda escritorio](screenshots/lyrics-v2/desktop-search.png), [búsqueda móvil](screenshots/lyrics-v2/mobile-search.png), [inmersivo móvil sincronizado](screenshots/lyrics-v2/mobile-synced.png). Pruebas montadas verifican StrictMode, cancelación, selección tardía/cambio de servidor, conflictos de versión, reintento, denegación, HTTP 429, reapertura, retorno automático y seguimiento al seleccionar letras a mitad de canción; suites de reloj existentes cubren seek/repeat/reconexión.

## Limitaciones y prueba pendiente con Discord

No se probó Discord real, OAuth real ni sincronización audible y no se reinició el bot activo. No se garantiza catálogo, metadatos correctos ni timing perfecto del proveedor. Álbum/canal desconocido y versiones sin datos suficientes pueden seguir siendo ambiguos; búsqueda manual requiere candidatos existentes.

Comprobación humana pendiente en Discord: reproducir los tres casos con sus URLs reales; comprobar pausa/reanudación, seek, skip, repeat y cambio de servidor; elegir un resultado LRC/normal; cerrar/reabrir y reconectar SSE; confirmar que no aparecen letras antiguas ni se altera audio. El reloj existente se verificó mediante pruebas deterministas, sin medir latencia audible.

Commits de implementación: `9310fe0` (proveedor, matching, API y pruebas backend) y `0b8ae25` (selección manual, interfaz y pruebas montadas). La documentación/capturas quedan en un tercer commit local.

Cambios exclusivamente locales en la rama solicitada. Sin push, merge ni despliegue.
