# Proveedor de letras de SONORA

Revisión de documentación: **16 de octubre de 2026**. Integración privada y de solo lectura; el motor musical no depende de este servicio.

## Documentación y condiciones consultadas

La [documentación oficial de LRCLIB](https://lrclib.net/docs) permite consultas anónimas sin clave; el registro de aplicaciones es opcional actualmente. Exige identificar el cliente con nombre, versión y proyecto/contacto, efectuar solicitudes secuenciales, dejar 200–500 ms entre ellas y respetar `Retry-After` cuando responde 429. No publica una cuota numérica garantizada. La respuesta 429 puede provenir del edge y no ser JSON.

`GET /api/search` admite título, artista y álbum y devuelve hasta 20 registros sin paginación. Se utilizan `instrumental`, `plainLyrics` y `syncedLyrics`; campos adicionales como `lyricsfile` y `hasWordSync` se ignoran. Esta implementación sincroniza líneas, nunca palabras. El endpoint `/api/get` recomienda duración y aplica una tolerancia de ±2 segundos; SONORA usa ese mismo margen conservador para evaluar sus resultados de búsqueda. [Especificación de campos y endpoints](https://lrclib.net/docs).

El [repositorio del proveedor](https://github.com/tranxuanthang/lrclib) licencia su software bajo MIT. No se encontró en las páginas oficiales consultadas una licencia general que permita almacenar indefinidamente o redistribuir todas las letras. La licencia del código no demuestra derechos sobre su contenido. Se mantiene esta incertidumbre explícita: no hay catálogo, exportación ni almacenamiento persistente de letras. La caché breve descrita abajo es una decisión prudente de SONORA, no una autorización jurídica atribuida al proveedor.

## Búsqueda y coincidencias

`LyricsProvider.findLyrics(query, signal?)` recibe metadatos autoritativos del backend. No admite destinos HTTP proporcionados por el navegador. La consulta inicial utiliza los metadatos originales; solo se hace una segunda consulta cuando quitar etiquetas de presentación puede aportar una variante útil.

Se normalizan Unicode, mayúsculas, acentos, puntuación y espacios; se reconocen etiquetas de video oficial y sufijos de canal Topic/VEVO. Se puede quitar un prefijo «Artista -» únicamente si coincide con el artista conocido. No se borran indicadores musicales como live, remix, cover, acoustic, sped up, slowed o nightcore.

La selección sincronizada requiere título y artista normalizados exactos, indicadores de versión compatibles (también en álbum), duración conocida con diferencia máxima de 2 s y, cuando se conoce, álbum coincidente. No acepta coincidencias parciales. Registros compatibles con contenido diferente producen `ambiguous`. Duplicados idénticos se resuelven determinísticamente por cercanía de duración e ID. Texto y líneas idénticas con timestamps distintos se muestran como `plain`, con advertencia. Para duración de YouTube marcada aproximada, solo puede recuperar texto normal unánime dentro de `max(15 s, 10%)`; ese margen es una heurística propia y nunca autoriza timestamps. Una duración desconocida no se inventa.

Las rutas autenticadas `/lyrics/search` y `/lyrics/selection` permiten editar título/artista y seleccionar un ID devuelto por la búsqueda. Usan la misma cola y cooldown que la consulta automática. La advertencia compara contra la reproducción real. Los IDs admitidos se conservan en RAM 2 minutos, con un máximo de 128 búsquedas, por sesión/guild/canción/playback. La selección de interfaz es temporal y puede recuperarse al reabrir exactamente la misma reproducción. [Diagnóstico y validación V2](LYRICS_RELIABILITY_V2.md).

El contrato distingue `synced` con líneas `{timeMs,text}`, `plain`, `instrumental`, `not_found`, `ambiguous` y `temporary_error` con espera para reintentar. Un LRC inválido utiliza texto normal si existe; si tampoco hay texto fiable, devuelve error temporal. Los registros instrumentales contradictorios se rechazan.

## Límites propios de SONORA

| Recurso | Valor predeterminado |
| --- | --- |
| Destinos | `https://lrclib.net/api/search` y `/api/get/{id entero}` exclusivamente |
| Redirecciones | Rechazadas |
| Solicitudes HTTP simultáneas | 1 por servicio |
| Espaciado | 300 ms tras finalizar cada petición |
| Consultas por búsqueda | Máximo 2 |
| Búsquedas pendientes | Máximo 8, incluidas las activas |
| Timeout HTTP y lectura del cuerpo | 8 s |
| Deadline total de búsqueda, incluida cola | 20 s |
| Deadline de la ruta autenticada | 12 s |
| Cuerpo remoto | Búsqueda: 1 MiB; registro individual: 256 KiB; comprobados por bytes recibidos |
| Resultados remotos | Máximo 20; validación individual; duración `null` admitida como desconocida |
| Texto normal / LRC por registro | 50.000 / 100.000 caracteres |
| Caché RAM | Máximo 64 entradas |
| TTL encontrado / negativo | 10 min / 60 s |

Son límites de SONORA; no son cuotas prometidas por LRCLIB. La ruta además utiliza el límite existente de Fastify (20 solicitudes/minuto para letras), sesión y autorización de servidor.

Las búsquedas idénticas comparten un vuelo. Cancelar un consumidor no cancela a otros; al salir el último, se aborta la búsqueda. La cancelación, el cierre del servidor y los timeouts liberan suscriptores. La caché se borra al cerrar el servicio; no se guarda en SQLite, archivos o logs. Las respuestas API llevan `Cache-Control: no-store` y atribución LRCLIB cuando hay contenido.

429 y 503 aplican un cooldown global respetando segundos o fecha HTTP de `Retry-After`; no se reintenta automáticamente. Los demás fallos externos tienen backoff global acotado y el cliente recibe `temporary_error`. Nunca se cachea ese estado como «letras no encontradas».

## Validación realizada

`test/lyricsProvider.test.js` utiliza exclusivamente respuestas sintéticas y texto original. Cubre matching, versiones, ambigüedad, estados, metadata inválida, normalización, caché, límites de cuerpo y cola, deduplicación, cancelación compartida, cierre, reapertura, timeouts de fetch y stream, errores HTTP, cooldown 429/503 y destino/redirecciones.

Consulta real única realizada el **2026-10-16 a las 18:28:45 UTC** con los metadatos públicos del ejemplo oficial: resultado `synced`, 47 líneas y registro `3396226`. Solo se imprimieron estos datos de estado; no se guardó su texto. Esta comprobación confirma conectividad y compatibilidad del proveedor en ese momento. No mide sincronización audible con Discord ni garantiza disponibilidad o precisión para todas las pistas.


## Diagnóstico de errores y comprobación adicional
Las respuestas `temporary_error` incluyen opcionalmente `reason` (`rate_limited`, `timeout`, `connection`, `unavailable`, `invalid_response`, `busy`), sin detalles internos ni contenido del proveedor. DNS y conexiones interrumpidas se distinguen de HTTP 503. Una respuesta válida sin contenido es `not_found`. El plazo de la ruta es efectivo incluso si un adaptador tarda en aceptar cancelación. Los diagnósticos de matching solo incluyen etapa, decisión y conteos.

Una comprobación real adicional de QUEMAROPA/SINAKA (136s) confirmó50 líneas sincronizadas del registro28481733. La normalización del sufijo Topic seleccionó la versión136s y descartó la141s. Solo se inspeccionaron estado, metadatos públicos, conteos e ID; no se guardaron letras. Los tests de regresión utilizan letras sintéticas originales con esos metadatos públicos.
