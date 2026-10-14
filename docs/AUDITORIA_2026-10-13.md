# Auditoría de recuperación, persistencia y extracciones

Fecha: 13 de octubre de 2026. Rama: `fix/audit-playback-concurrency-20261013`.
Revisión inicial: `c57514c01dbcd7d0c610c4773a5d399312519469`.

La verificación usa los hallazgos A.1–C.2 incluidos en la solicitud adjunta, el README, ambos documentos de operación y el código y las pruebas del repositorio. El repositorio estaba limpio. Se creó la rama antes de modificarlo y se completó la investigación inicial de todos los hallazgos antes de editar producción. Cada defecto confirmado tuvo una reproducción fallida contra su implementación anterior.

## Estado por hallazgo

| Hallazgo | Clasificación y estado final | Evidencia y corrección |
| --- | --- | --- |
| A.1: cancelación de renovaciones 1 y 2 | Bug confirmado; corregido | Las seis combinaciones de renovación × skip/stop/seek no entregaban una señal a la extracción. Se captura la señal de la recuperación al preparar el stream y se transmite al plugin. La espera de backoff también es cancelable. |
| A.1: solicitudes compartidas por caché | Riesgo reproducido; corregido | Cancelar un servidor debe soltar su espera sin cancelar la de otro. La extracción compartida cuenta consumidores, cancela el proceso solo al retirarse el último y evita que un resultado cancelado sobrescriba la caché o elimine una solicitud posterior. |
| A.2: interacciones vencidas | Bug confirmado; corregido | Los cinco controles ejecutaban operaciones que pueden esperar el bloqueo o extraer audio antes de responder. Ahora difieren la respuesta antes de la operación y terminan mediante `editReply`. Revalidan sesión y canal después del reconocimiento. |
| A.2: diagnóstico de skip | Bug confirmado; corregido | Su catch convertía errores de red, bloqueo e incluso de la respuesta de Discord en «No hay más canciones». Se conserva la causa y se usa la frontera de errores existente. |
| B.1: reinicio del circuit breaker | Bug confirmado parcialmente; corregido | El campo `blocked` ya se persistía y restauraba antes del audio. Faltaban `probe` y los fallos recientes: una prueba en curso perdía su condición de prueba y una racha de dos fallos volvía a cero. Ambos se guardan y restauran antes de reproducir. Se conservan como máximo tres marcas válidas de los últimos cinco minutos. |
| B.2: stop durante restauración | Bug confirmado; corregido | `DELETE_QUEUE` ignoraba cualquier eliminación de la cola que se estaba restaurando. Una detención explícita ahora cancela ese intento y elimina inmediatamente su checkpoint. Se conserva la distinción con el cierre del almacén y un fallo automático de arranque. |
| B.2: volumen, repetición y radio | Bug confirmado; corregido | Los ajustes se aplicaban en `INIT_QUEUE` y otra vez después de esperar `play`. La segunda asignación sobrescribía cambios del usuario. Se aplican una sola vez antes de reproducir; el checkpoint final conserva los cambios. |
| C.1: timeout en FIFO | Bug confirmado; corregido | La espera consumía el timeout de 20 segundos y provocaba reintentos sin ejecutar yt-dlp, perdiendo el turno. Ese reloj comienza al adquirir un slot. La espera y el backoff consumen el presupuesto total de 60 segundos. |
| C.1: cancelación y timeout confundidos | Bug confirmado; corregido | Una cancelación del usuario se convertía en `ETIMEDOUT`. Ahora conserva su razón y no provoca reintentos. Los límites efectivos y totales siguen identificándose como timeout. |
| C.2: playlists grandes | Coste innecesario confirmado en código y simulación; optimizado | Resolver 500 entradas hacía extracción completa de todas antes de elegir audio. Se obtiene metadata plana, conservando nombre, URL, fuente, artista, duración, portada y estado en vivo; el audio se extrae al solicitar una canción. |
| C.2: precalentamiento frente a interacción | Bug confirmado; corregido | Varias tandas de dos workers ocupaban el FIFO global delante de una búsqueda interactiva. El pool ofrece prioridad interactiva y un turno de fondo después de hasta tres concesiones interactivas. La admisión reserva capacidad para interacción y mantiene el límite global. |
| Seek concurrente con skip | Bug adicional confirmado; corregido | El seek nativo leía la cabecera después de esperar y podía aplicar la posición de A a B. Se conserva la canción destinataria y se comprueba bajo el mismo bloqueo antes de modificarla. Se rechaza con `SESSION_CHANGED` y se libera el bloqueo. |
| Skip rechazado durante una renovación | Bug adicional reproducido en la integración; corregido | Al cancelar la renovación de una única canción, `NO_UP_NEXT` podía dejar esa cabecera sin audio. La limpieza de una recuperación cancelada se aplica también a renovaciones, conserva el diagnóstico y termina la cola vacía. |

## Protecciones existentes y afirmaciones que no se confirmaron

- No había concurrencia ilimitada de procesos: el pool ya limitaba a tres extracciones y 50 consultas pendientes. Los dos workers por precalentamiento eran un límite por tanda, no una prioridad global.
- No faltaba toda cancelación: las alternativas ya recibían una señal y skip/stop/seek cancelaban la recuperación antes de esperar el bloqueo. El defecto afectaba a las renovaciones y su espera de backoff.
- El código ya verificaba propiedad de la cola después de extraer. Evitaba gran parte de las reproducciones tardías; no detenía el trabajo innecesario ni resolvía el seek dirigido a una cabecera antigua.
- Una cola con `blocked: true` ya conservaba el bloqueo al reiniciar. La pérdida reproducida afectaba a una prueba manual en curso y al historial reciente, no al campo bloqueado.
- Los errores Discord 10062/40060 ya estaban capturados sin reenviar la respuesta ni terminar el proceso. Esta protección no sustituía el reconocimiento temprano de los controles.
- Ya existían protecciones contra sesiones sustitutas, eventos antiguos, restauraciones duplicadas y cierre durante consultas. Se conservaron y sus regresiones siguen formando parte de la validación.
- Conservar el checkpoint durante el cierre del almacén, o tras un fallo automático de arranque, es intencional. Una detención explícita debe eliminarlo.

## Pruebas y reproducción

Las pruebas nuevas usan promesas controladas, eventos, relojes simulados y procesos locales cuando corresponde. No conectan el bot a Discord ni consultan plataformas musicales. Las pruebas de concurrencia de comandos usan también el bloqueo y la cola de la versión instalada de DisTube.

| Archivo nuevo | Cobertura principal |
| --- | --- |
| `test/controlCommandsAudit.test.js` (24) | Reconocimiento de los cinco controles antes de una espera, errores de red/Discord/cola, cambios de canal y sesión, seek/skip, skip rechazado y liberación de bloqueos. |
| `test/streamCancellationAudit.test.js` (9) | Renovaciones canceladas por los tres controles, backoff, consumidores compartidos, cancelación total y resultados tardíos. |
| `test/queueRecoveryAudit.test.js` (7) | Probe y racha de fallos tras reiniciar, stop durante restauración, ajustes del usuario, checkpoints antiguos, caducidad y preservación ante fallo automático. |
| `test/ytDlpRunnerAudit.test.js` (13) | FIFO, reloj efectivo y presupuesto total, reintentos, cancelaciones, prioridades, equidad, límites del pool y terminación real de un proceso local. |
| `test/playlistPoolAudit.test.js` (3) | Metadata de 500 entradas, extracción diferida, varias tandas de precalentamiento y prioridad/admisión interactiva. |

Antes de corregir, las reproducciones iniciales dieron: persistencia **4 fallos de 5**, comandos **9 fallos de 10**, cancelación **7 fallos de 7**, runner **4 fallos de 6** y playlists/prioridad **2 fallos de 2**. Los casos de protección que pasaban se conservaron. Se añadieron después regresiones para las correcciones y sus límites.

Se ajustaron fixtures existentes de `operations.test.js` y `voiceLifecycle.test.js` para simular también la nueva ruta explícita de renovación. Se corrigió la expectativa de cancelación en `resilience.test.js`: una cancelación del usuario debe conservar su razón, no presentarse como timeout.

La primera ejecución de la suite original obtuvo **199/200**, con timeout de diez segundos en el proceso de prueba de `deploy --dry-run`. Su repetición aislada pasó **4/4** sin cambiar código ni aumentar ese timeout. La ejecución integral final también pasó ese caso.

## Resultado integral final

| Comprobación ejecutada | Resultado real |
| --- | --- |
| `npm run build` | Correcto, código de salida 0. |
| `npm test` | **256 aprobadas, 0 fallos, 0 canceladas, 0 omitidas**, código 0. Incluye las 200 anteriores y 56 nuevas. |
| `npm run deploy:check` | Correcto, código 0; validó 19 comandos sin contactar con Discord ni iniciar el bot. |
| `git diff --check` | Correcto, código 0. |

Huella SHA-256 de las definiciones: `3e86b2114dfce87c089fca414acbc597b3b22810bbb4f0273e3d576e927d168f`.

## Archivos de producción modificados

- `src/commands/{skip,seek,pause,resume,stop}.ts`
- `src/music/events.ts`
- `src/music/playbackRecovery.ts`
- `src/music/playbackHealth.ts`
- `src/music/queueRecovery.ts`
- `src/music/ytDlpRunner.ts`
- `src/music/ytDlpSearchPlugin.ts`

También se actualizaron este informe y las descripciones operativas del README. No se añadieron dependencias ni se cambiaron las definiciones slash. Los campos nuevos del checkpoint son opcionales; los archivos anteriores siguen siendo válidos. Una versión anterior del bot puede ignorar esos campos: una vuelta atrás debe usar su respaldo de datos, como indica la guía de operación.

## Validación manual pendiente y límites

La suite local no certifica disponibilidad de YouTube/SoundCloud, latencia real de Discord ni calidad de todo el metadata plano que pueda devolver cada extractor. En un servidor de pruebas deben comprobarse skip/stop/seek durante una renovación, seek simultáneo con skip, stop durante restauración, reinicio con bloqueo o probe activo y playlists reales de YouTube y SoundCloud con varios servidores. La prueba prolongada de reproducción sigue siendo una validación de activación.

Los presupuestos de búsqueda y alternativa siguen en 90 y 45 segundos; cada operación yt-dlp tiene 60 segundos totales y cada extracción efectiva hasta 20. El precalentamiento es de mejor esfuerzo y puede descartarse por saturación. El pool mantiene sus límites; la prioridad no garantiza respuesta inmediata si los tres procesos ya están ejecutando trabajo.

Una búsqueda interactiva que coincide con otra ya precalentándose comparte esa tarea; no se implementó promoción dinámica de prioridades. Las extracciones iniciales ajenas a una recuperación mantienen el presupuesto global y la comprobación de propiedad posterior; la cancelación individual de esta entrega cubre las renovaciones y alternativas investigadas. Los metadatos no disponibles en una entrada plana siguen representándose como desconocidos.

No se desplegó, registró ni publicó nada, y no se reinició el bot de producción. La compilación prepara la versión para una activación posterior autorizada.
