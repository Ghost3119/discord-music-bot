# SONORA: reproductor inmersivo

## Preparación y baseline (2026-10-16)
Base limpia: main 5cf7de1, sincronizada con origin/main. Integrados refactor modular (PR5), correcciones de editor y propiedad de metadatos (PR6), documentación (PR7). Rama exclusiva: feat/sonora-immersive-lyrics. Sin merges, push, despliegue ni reinicio de producción.

Antes de modificar código: npm run build correcto; npm test correcto: **380 backend +81 frontend =461 pruebas**. Vite: CSS47.61kB, JS350.21kB (gzip111.27kB). Logs preservados en la carpeta local de evidencias de esta sesión (no versionados).

## Diseño: dos pasadas antes de implementar
Skill leída completa: C:\Users\picud\.agents\skills\frontend-design\SKILL.md. Agentes UX/UI y frontend/sincronización también deben leerla. No se modificó ni reinstaló.

Primera pasada: escenario continuo de escucha, portada protagonista izquierda y letras expresivas derecha. Tokens: tinta #0C0E12, velo #14171C, texto #F3F3F1, secundario #B4B8BD, verde #C7F57A, aviso #E8BD8A. Se conserva Segoe UI/Inter/system por continuidad con SONORA. Letras 40–54px escritorio, 28–34px móvil, alineadas izquierda, peso600. Tipografía y portada sustituyen tarjetas decorativas.

    SONORA                                      Cerrar
    [       portada       ]    Letras              LRCLIB
    [                     ]    Línea anterior
    Título / artista           Línea actual
    Progreso / controles       Línea siguiente

En móvil se alterna Portada/Letras dentro de una región común; controles permanecen accesibles abajo. Dos columnas comprimidas perjudicarían lectura y tamaño táctil. Safe areas y objetivos44px.

Segunda pasada crítica: oscuro+verde podía repetir un dashboard genérico. Se retiraron tarjetas, etiquetas superiores y numeraciones decorativas. El verde queda en controles/foco; la portada aporta ambiente cromático apagado. Letra activa blanca con mayor peso, sin escalar ni relayout. Fondo con velo oscuro constante para contraste. Apertura/cierre200ms, portada240ms, fondo800ms, líneas160ms; reduced-motion elimina movimiento y scroll suave. Scroll manual suspende seguimiento hasta acción explícita.

## Límites acordados
Un solo SSE existente. App y useSonoraApp conservan su alcance; presentación y efectos viven en features/immersive y features/lyrics. El audio continúa en Discord. El navegador usa un reloj monotónico reconciliado con snapshots, nunca HTMLAudioElement. No se añaden acciones musicales: no hay seek ni anterior en el contrato actual; progreso informativo, reloj reacciona a cambios de posición autoritativos. Las letras no disparan seek.


## Implementación y arquitectura
El reproductor se abre con **Abrir reproductor inmersivo** en la barra persistente (también móvil). Un Dialog de Radix cubre la página; no requiere Fullscreen API. El dashboard permanece montado: no se recrea su SSE, no se pierden borradores ni se interrumpe audio. Escape y Volver cierran; el foco regresa al botón de apertura. Un editor de biblioteca abierto deshabilita la apertura y evita diálogos anidados.

| Módulo | Responsabilidad |
| --- | --- |
| components/player/PlayerExperience | Estado de apertura y coordinación exclusiva de presentación |
| features/immersive/ImmersivePlayer | Dialog, escenario y metadatos; subtree local del reloj |
| ImmersiveControls | Acciones musicales y borrador de volumen existentes |
| ImmersiveArtwork | Portada, transición de salida y fallback ante error |
| AmbientBackground / use-artwork-palette | Dos capas cromáticas con velo estable y extracción única |
| features/lyrics/use-lyrics | Consulta REST, identidad, cancelación, deduplicación y caché RAM |
| LyricsPanel / LyricsLine | Estados, texto plano, línea activa y seguimiento manual |
| playback-clock / use-lyrics-clock | Reloj puro y lifecycle visible local |
| lib/playback-receipt | WeakMap del instante monotónico de recepción original |
| lib/playback-stream | Única conexión existente; orden REST/SSE y epochs retiradas |
| src/web/lyrics | Contratos, proveedor intercambiable, matching y parser puro LRC |
| src/web/playback-identity | Observador de playSong sin mutar colas o reproducción |

App cambia únicamente la composición. useSonoraApp conserva su responsabilidad y no recibe lógica de letras. Se reutilizan api(), CSRF, PlaybackBindings, acciones, favoritos y permisos del snapshot. No se añadió dependencia, store, servidor, proxy de imágenes ni segundo cliente SSE.

### Identidad y seguridad
El bridge publica playbackId UUID estable durante una instancia y distinto tras playSong, repetición o nueva cola; Song y Queue mantienen identidades separadas del título. sampledAt (epoch de servidor), sequence y snapshotEpoch ordenan snapshots. El frontend rechaza secuencias viejas y hasta ocho epochs retiradas; un reinicio de backend puede empezar una nueva secuencia sin congelar el reloj.

GET /api/guilds/:guildId/lyrics/current exige sesión y acceso con las reglas existentes de WEB_ACCESS_MODE. Obtiene metadatos del bridge, no de query strings. Tras esperar al proveedor revalida sesión, membresía y reproducción; si cambió devuelve stale sin texto. La ruta es de solo lectura, no permite destinos externos ni acciones. Lleva no-store y límite20/min; espera total12s. Revocación y cancelación usan el lifecycle existente de operaciones.

### Proveedor LRCLIB
Ver [LYRICS_PROVIDER.md](LYRICS_PROVIDER.md) para fuentes oficiales revisadas, condiciones, límites y comprobación real. Matching conservador de título/artista/versión, duración±2s y álbum cuando existe; ambiguo antes que texto incorrecto. Distingue synced, plain, instrumental, not_found, ambiguous y temporary_error, además idle/stale de reproducción.

Proveedor: un HTTP a la vez, 300ms entre solicitudes, máximo dos consultas y ocho búsquedas pendientes; HTTPS fijo, redirecciones rechazadas, cuerpo256KiB, esquema validado, timeout8s, deadline de servicio20s. 429/503 respetan Retry-After sin tormentas de reintentos. Cache RAM64 entradas, TTL10min encontrado/60s negativo; no SQLite, catálogo o logs de letras. Frontend comparte vuelos y conserva máximo24 respuestas por120s (negativas30s), respetando identidad y tiempo de reintento; StrictMode y reapertura reutilizan solicitudes. Cancelar un consumidor no cancela a otro; al salir el último se aborta.

No se encontró una licencia general de letras en las fuentes oficiales consultadas. La licencia MIT del software no demuestra derechos sobre el contenido. Esta versión privada usa retención breve prudente, atribución LRCLIB y ningún almacenamiento persistente; revisar condiciones antes de distribución pública.

Consulta real única: 2026-10-16 18:28:45UTC, resultado synced,47 líneas, registro3396226. Se imprimieron únicamente estado/conteo/ID; no se guardó el texto. Las pruebas y capturas usan letras originales escritas para QA.

## Sincronización
La fuente autoritativa es currentTime del bot, en segundos. Receipt, anchor e interpolación usan performance.now() en milisegundos. sampledAt solo se compara con muestras anteriores del mismo servidor; jamás se resta a performance.now(). No se estima latencia de transporte como si ambos relojes compartieran origen.

- Reproducción live: avance local entre snapshots, limitado a duración conocida.
- Deriva hasta750ms: corrección lineal durante2s, acotada; diferencias mayores y cambios de instancia: salto inmediato.
- Pausa, recuperación, bloqueo o desconexión: congelación. Reabrir SSE por sí solo no reanuda; se espera una muestra nueva.
- Sin confirmación durante8s: se detiene la estimación.
- Seek recibido: salto inmediato, nueva línea y scroll instantáneo para evitar recorrer visualmente posiciones lejanas.
- Cambio de canción/servidor: nueva identidad y descarte de letras, errores y referencias anteriores.
- Reapertura: WeakMap conserva el recibo original para no anclar incorrectamente una muestra antigua al momento de apertura.
- Pestaña oculta: sin timer; vuelve a reconciliar al mostrarla. Timer100ms solo en la región abierta, visible y avanzando; cleanup al desmontar. App no se actualiza a60FPS.

Parser LRC: mm:ss y fracciones variables redondeadas a milisegundos, múltiples timestamps, Unicode, metadatos y último offset global. Orden estable; duplicados exactos eliminados, mismos tiempos con textos distintos conservados (activa la última línea). Líneas temporizadas vacías indican pausa musical; inválidas se ignoran. Límites256k caracteres/5000 líneas.

No se promete sincronización audible perfecta: buffering y cliente de voz de Discord añaden incertidumbre no medida. El navegador no reproduce audio. No se añade calibración sin datos.

## Diseño, accesibilidad y revisión
Agentes reales: immersive_design (UX/UI y revisión de capturas), immersive_frontend (componentes, fondos, lifecycle React), lyrics_backend (investigación/proveedor y revisión independiente), lyrics_sync (parser/reloj). El agente principal integró contratos, API, identidad, pruebas completas, fixture, navegador y documentación. El límite de concurrencia se resolvió por etapas; la revisión QA independiente se asignó al agente backend. Los agentes de UX/UI, componentes y sincronización confirmaron la lectura completa de la skill.

Principios aplicados: una composición continua, portada como elemento protagonista, letras expresivas alineadas izquierda, ausencia de tarjetas decorativas y fuentes nuevas, verde limitado a acciones/foco. La paleta proviene de una muestra24×24 una vez por imagen; cache48 paletas, timeout5s, cancelación y fallback índigo/púrpura ante falta de imagen/CORS/canvas. Luminancia limitada antes del velo oscuro. No hay procesamiento de imagen continuo ni movimiento ambiental infinito. Se animan opacidad y transform, sin blur móvil animado.

Ajustes de QA: seguimiento44px, trigger44px en móvil, grid con altura dinámica para que feedback/controles no se superpongan a letras, ResizeObserver local para seguir la línea pausada al alternar Portada/Letras o redimensionar. Los observers se desconectan al desmontar. La captura intermedia inicialmente recortada se sustituyó por una de1024×768 verificada.

Accesibilidad verificada: Dialog con título/aria-modal, foco inicial y retorno al disparador, Escape y confinamiento de foco; nombres de controles, progreso informativo, objetivos44px y foco visible. Texto activo usa aria-current sin anuncios continuos. Scroll por rueda/touch/teclado suspende seguimiento hasta Seguir reproducción. Texto plano no simula sincronía. Ninguna línea dispara seek.

prefers-reduced-motion elimina animaciones/transiciones y scroll suave; comprobado en CSS cargado y pruebas montadas de matchMedia. El navegador de QA reportó preferencia false y su API no ofrece emulación de medios: activar preferencia real del sistema y revisar visualmente sigue pendiente. No se afirma una auditoría completa con lector de pantalla.

## Validación ejecutada
| Comprobación | Resultado real |
| --- | --- |
| Baseline npm run build / npm test | Correcto;380 backend+81 frontend=461 |
| Final npm run build | Correcto; incluye tsc backend y tsc --noEmit frontend |
| Final npm test | **409 backend+156 frontend=565;104 nuevas,0 fallos** |
| npm run deploy:check | Correcto;19 comandos, dry-run local sin Discord |
| git diff --check | Correcto |
| Dependencias / ciclos | Sin nuevas dependencias; imports nuevos revisados sin ciclos |
| Bundle frontend | JS371.48kB/gzip117.40kB; CSS62.43kB/gzip14.15kB |

JS gzip aumenta6.13kB respecto al baseline. No se hicieron mediciones de FPS/batería ni perfiles exhaustivos de memoria; no se inventan resultados de rendimiento.

Pruebas nuevas:29 backend (proveedor20, endpoint8, identidad1) y75 frontend (parser/reloj/lifecycle33, UI/letras/paleta37, integración3, orden SSE2); contratos TypeScript adicionales rechazan estados inválidos. Se conserva completa la suite previa, incluidas invariantes del editor.

Cobertura: matching/versiones/duración/ambigüedad, HTTP429/503/timeout/cuerpo/esquema, cache/dedup/cancelación compartida/close; sesión/membresía/revocación/cambio de canción; parser/deriva/seek/pausa/reanudación/epochs/recepción/reapertura/pestaña oculta; React montado real con StrictMode, A→B/errores tardíos/cambio de guild/desmontaje; foco/teclado/permisos/scroll/paletas/fallback/CORS/timeout.

### Navegador real, con snapshots simulados
Preview existente ampliado (Node fixture, Fastify real, SQLite en memoria); no inicia Discord. Revisado1440×900,390×844 y1024×768. Estados: sincronizadas, texto normal, instrumental, sin resultados, sin portada, pausa, skip, cambio de fondo, error temporal, vacío y member sin control. Sin desbordamiento horizontal ni solapamientos en las vistas revisadas. Consola sin errores ni warnings de aplicación en esos escenarios.

Pausa mantuvo posición44s y línea estable al redimensionar/cambiar pestaña; Escape devolvió foco al trigger. Scroll manual mostró Seguir reproducción y su botón reanudó seguimiento. Skip cambió título/paleta y reinició posición0; verde del control se mantuvo. Fondo observado pasó de rgb(51,113,116)/rgb(34,62,80) a rgb(76,43,80)/rgb(116,89,61).

El borrador del buscador permaneció intacto tras abrir/cerrar. Tres cierres/aperturas no incrementaron conexiones SSE ni consultas de letras; la siguiente navegación de escenario incrementó ambos solo una vez. Métricas del fixture: una conexión activa.1200 líneas renderizadas y desplazables sin overflow. Esto no mide FPS ni sincronización audible real.

## Evidencias
Capturas en [screenshots/immersive](screenshots/immersive), generadas mediante navegador y sin edición:
- escritorio1440×900, móvilPortada/Letras390×844, intermedio1024×768;
- dashboard original, pausa, letra normal, instrumental, sin resultado/carátula, error, idle y member;
- fondo cálido tras cambio de canción.

## Prueba local y procedimiento manual
Con la configuración Discord ya existente: npm run dev; abrir la URL indicada, iniciar sesión y usar el botón inmersivo de la barra. No requiere nuevas variables ni claves de LRCLIB.

QA independiente de Discord: npm run build; node test/helpers/dashboard-preview.cjs; abrir http://127.0.0.1:4175/scenarios. SONORA_QA_PORT permite otro puerto (login=puerto+1). Credenciales y biblioteca son ficticias/en memoria. No confundir esas letras/snapshots con producción.

Antes del merge:
1. Con bot de prueba o sesión real autorizada, iniciar OAuth, seleccionar servidor y entrar a voz.
2. Reproducir una canción con metadatos fiables; abrir inmersivo, comprobar coincidencia/atribución y comparar resaltado con audio audible.
3. Pausar/reanudar y cambiar de pista (incluida repetición de la misma); no debe aparecer texto anterior.
4. Ejecutar /seek en Discord hacia delante/atrás y comprobar el salto al siguiente snapshot. La API web no expone seek ni anterior; el progreso no simula un slider.
5. Desconectar/reconectar temporalmente la red del navegador: el reloj debe congelarse y resincronizar con muestra nueva.
6. Cerrar y reabrir; conservar música, editor y una sola SSE. Verificar roles member/voice/admin con cuentas reales.
7. Activar reducción de movimiento del sistema, probar teclado/lector de pantalla, zoom200% y dispositivo móvil real.
8. Medir desfase audible antes de decidir si se necesita una calibración futura.

## Limitaciones y alcance
Validación automatizada y de navegador completa con fixtures, proveedor real consultado una vez. **No se probó audio ni OAuth de Discord real durante este trabajo y no se reinició producción.** La cobertura LRCLIB depende de metadatos, duración y catálogo; los canales de YouTube no siempre identifican al artista. El matching rechaza resultados dudosos. El audio no suena en el navegador.

La revisión visual real de preferencia reducida activada y con lector de pantalla queda manual. No se realizaron perfiles exhaustivos de rendimiento ni se promete sincronización perfecta. La rama queda local para prueba del usuario, sin push, merge o despliegue.


## Inventario y commits locales
Inventario completo frente a main: [IMMERSIVE_CHANGED_FILES.txt](IMMERSIVE_CHANGED_FILES.txt). Incluye fuentes, pruebas, documentación y capturas; sin cambios en dependencias, lockfiles o variables de entorno.

Commits de implementación: dcdfb9c (baseline/diseño),1b546cf (proveedor/API),4842176 (reloj),048fe93 (epochs retiradas),0da8fc0 (vista/fondo/letras). El commit final agrega documentación, fixture y capturas. No se ejecutó push desde esta tarea. Al finalizar se detectó que origin ya referenciaba el commit de documentación; se preservó su historial y la corrección de formato se añadió en un commit separado.

El preview de QA se cierra al terminar la revisión. Los logs de baseline/build/test/deploy se conservan fuera del checkout en la carpeta local de evidencias.
