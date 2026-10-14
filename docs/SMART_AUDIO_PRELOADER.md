# Smart Audio Preloader: arquitectura y validación

Implementación preparada el 13 de octubre de 2026 en `feat/smart-audio-preloader-20261013`, desde `f7b906f` de `fix/audit-playback-concurrency-20261013`. La carpeta estaba limpia al comenzar. No se desplegó, no se publicó y no se reinició el bot activo.

## Investigación y elección

Versiones comprobadas en el equipo: **DisTube 5.2.3**, **@discordjs/voice 0.19.2**, **@distube/yt-dlp 2.0.1**, **ffmpeg-static 5.3.0**, cuyo ejecutable informa **FFmpeg 6.1.1**, y Node.js 24.14.0.

La aplicación ya controla `QueueManager.playSong`, verifica la sesión después de extraer, construye un `DisTubeStream`, lo entrega a `DisTubeVoice.play` y comparte la recuperación con el watchdog. `DisTubeStream` construye el transformador de volumen y el recurso Raw→Opus en su constructor; FFmpeg comienza en `spawn`. La voz llama a `audioPlayer.play`, retira el stream anterior y ejecuta `spawn` otra vez. `kill` destruye el stream de entrada y termina FFmpeg.

Por tanto, cachear una búsqueda o una URL no deja audio preparado. La solución construye y alimenta el recurso de audio antes de necesitarlo, manteniéndolo completamente separado del reproductor de voz. La documentación de [DisTubeStream](https://distube.js.org/classes/DisTubeStream.html) describe los puntos públicos usados: recurso, proceso, spawn y kill. El comportamiento concreto se contrastó con el código instalado, no con la última versión de la documentación solamente.

El [AudioPlayer de voice 0.19.2](https://discord.js.org/docs/packages/voice/0.19.2/AudioPlayer:Class) sustituye y destruye el recurso anterior al reproducir otro. Se conserva ese único reproductor por conexión: tener dos procesos que decodifican no significa transmitir dos canciones a Discord. Cada servidor recibe su propio recurso; compartir uno entre reproductores sería incorrecto.

Se declara `@discordjs/voice: 0.19.2` como dependencia directa porque ahora se usa su API. Esa misma versión ya estaba instalada como dependencia de DisTube y continúa deduplicada: no se descargaron ni incorporaron bibliotecas nuevas.

## Flujo implementado

| Etapa | Comportamiento |
| --- | --- |
| Descubrimiento | Después de observar avance real del audio actual, un sondeo de un segundo identifica la siguiente solicitud. Empieza por resolverla aunque aún falte más de medio minuto. |
| Resolución | Obtiene metadata reproducible y URL mediante el plugin existente, con prioridad `background`, cancelación y deduplicación por consumidores. Spotify/Apple conservan su origen y usan la búsqueda existente. |
| Prebuffer | Cuando faltan hasta 30 segundos y ambas duraciones son conocidas, arranca FFmpeg y el encoder nativo. Añade una frontera de cinco paquetes Opus y espera audio legible sin consumirlo. |
| Entrega | `startSong` adquiere la preparación de la solicitud exacta. Si el buffer está listo, entrega ese mismo `DisTubeStream` a la voz; `spawn` es idempotente y no crea otro FFmpeg. |
| Degradación | Si solo existe URL válida, la reutiliza y construye audio convencionalmente. Si la preparación falló, caducó o dejó de pertenecer a la sesión, conserva la ruta normal de reproducción y recuperación. |

El volumen y los argumentos/filtros de FFmpeg forman parte de la identidad de la preparación, porque el buffer ya está codificado. Se vuelven a comprobar al entregarlo. Un cambio concurrente descarta el audio codificado y permite reutilizar únicamente la URL con los ajustes actuales.

Con loop de canción se prepara una instancia nueva de audio para la misma solicitud; con loop de cola se considera la siguiente entrada o el retorno a la única canción. La radio puede aprovechar canciones ya presentes. No se generan recomendaciones nuevas anticipadamente: si autoplay aún no ha elegido su siguiente canción, no existe una entrada que preparar.

## Límites y caducidad

| Recurso | Límite |
| --- | --- |
| Resoluciones anticipadas | Dos operaciones simultáneas, globales dentro del proceso. |
| FFmpeg anticipados | Dos recursos simultáneos, incluidos los que están cerrándose; su slot se libera al confirmar el cierre. Al entregarse a voz pasan a reproducción activa. |
| Seguimiento | Hasta 100 colas; una preparación por cola. Fuera de ese límite continúa la reproducción convencional. |
| URL preparada | Hasta dos minutos; se acorta por `expire`/`expires` Unix, reservando 15 segundos de margen. Se renueva la caché si vence, incluso al entregar antes del siguiente sondeo. |
| Buffer preparado | Hasta 45 segundos y mientras la sesión siga siendo válida. |
| Primer audio de FFmpeg | Ocho segundos por intento. |
| Operación especulativa | Hasta 45 segundos por etapa de resolución o prebuffer, incluyendo sus recuperaciones. |
| Datos de audio | Backpressure de los pipelines y un umbral conservador de 1 MiB por recurso para los buffers observables. Se destruyen preparaciones que lo excedan. |

El umbral de datos no representa el RSS total: FFmpeg, el codec y los buffers del sistema operativo tienen memoria adicional. El límite global de dos procesos limita ese coste. No se descarga una canción completa a un array ni a un archivo.

El pool de yt-dlp conserva sus tres extracciones activas y 50 pendientes, su reserva de plazas interactivas y la prioridad con equidad de las correcciones anteriores. La precarga no se salta ese pool. Una tarea ya ejecutándose no se preempta; una reproducción que necesita la misma extracción la comparte.

Para canciones actuales en vivo o de duración desconocida se prepara únicamente la URL. Lo mismo ocurre si la próxima canción es en vivo o no tiene duración conocida. Así se evita retener el comienzo de una emisión durante un tiempo indeterminado. Las pausas liberan la preparación; al reanudar se vuelve a evaluar la cola.

## Recuperación y concurrencia

`PlaybackRecovery.prepareAhead` reutiliza la política de errores recuperables y `findAlternative`, con los filtros existentes de título, artista, duración y versiones. Su presupuesto permite dos renovaciones y una alternativa, compartido entre las dos etapas. Nunca emite un fallo de reproducción, modifica la cola ni consume el probe del circuit breaker durante la especulación. Un fallo permanente o el agotamiento deja de insistir en esa preparación.

La alternativa solo sustituye la cabecera cuando va a reproducirse y pasó la preparación. El historial conserva su relación con la solicitud original. Una alternativa que también falló especulativamente no se incorpora. Los fallos reales posteriores siguen entrando en el watchdog y la recuperación habituales, con su presupuesto de reproducción.

Skip puede consumir un buffer listo. Si llega durante su construcción, cancela ese proceso y reutiliza la URL ya resuelta. Si la resolución de URL está en curso, comparte esa operación cancelable en lugar de duplicarla. Stop cancela antes de esperar el bloqueo de la cola. Seek invalida la preparación y conserva las comprobaciones de canción y sesión de la auditoría anterior.

Los cambios de shuffle/remove/move/clear se observan mediante los checkpoints existentes. Las incorporaciones de canciones/listas también invalidan inmediatamente una preparación desplazada. Loop, autoplay, volumen y filtros se comprueban de nuevo por identidad. Los resultados tardíos no se incorporan a una sesión reemplazada. Dos servidores pueden compartir una consulta o URL, pero nunca su `AudioResource`; cancelar un consumidor no termina el trabajo que otro necesita.

El cierre normal destruye los buffers y cancela las extracciones. Cada FFmpeg creado por la precarga registra su PID por el IPC privado del supervisor y comunica su cierre, incluso si ya fue entregado a voz. El supervisor termina los procesos registrados si muere el bot, si actúa su watchdog o si debe forzar un cierre. Solo se añaden los PID comunicados por su propio hijo; no se enumeran ni terminan otros bots. El formato de checkpoints no cambia y no se persisten recursos ni URLs temporales.

## Observabilidad

Los registros `[Precarga]` pasan por la rotación y redacción existentes. No incluyen URLs, argumentos completos de FFmpeg ni errores crudos.

- `url_ready`: servidor, tiempo de resolución, renovaciones y uso de alternativa.
- `audio_ready`: tiempo de preparación y estimación conservadora de datos retenidos.
- `acquired` / `used`: adquisición y entrega efectiva de buffer, URL o ruta convencional. Los contadores de uso se incrementan después de entregar a voz.
- `failed` / `cancelled`: código o motivo de la preparación, sin afectar al breaker.
- `transition`: `gapMs` entre el evento local de fin de A y el primer avance observado del recurso de B, con observación cada 50 ms durante esa transición.
- `transition_unconfirmed`: no se observó audio antes de 60 segundos.
- `summary`: solicitudes, URLs y buffers preparados, porcentaje de buffers correctos, usos, fallos, cancelaciones y tiempos agregados de transición. También se pueden consultar los contadores locales con `getAudioPreloader(distube).metrics`.

La medición de transición es local. No mide lo que oye un cliente remoto y no incluye el padding que precede al evento de fin. Sirve para comparar rutas con y sin preparación bajo las mismas condiciones; no certifica ausencia de silencio en Discord.

## Pruebas y resultados reales

Se añadieron **46 pruebas**: 39 de preparación/concurrencia, cuatro con FFmpeg real y tres del supervisor. Usan promesas controladas, eventos, relojes simulados, la cola/bloqueo reales de DisTube y servidores HTTP locales; no conectan un bot ni consultan plataformas musicales.

Cubren reutilización, fin natural y skip, seek, stop durante extracción y durante entrega, cambios reales de cola, loop/autoplay/volumen/filtros, metadata, TTL, procesos cerrándose, límites globales y de memoria, recuperación acotada, alternativas con historial, emisión en vivo, resultados tardíos, recursos aislados con extracciones compartidas y reinicio del supervisor.

Las pruebas con FFmpeg verifican un recurso Opus legible con `playbackDuration` todavía en cero, consumo posterior de un frame nativo de 20 ms, PID estable ante llamadas repetidas a spawn, cancelación, HTTP 403 y conservación de frames de fuentes cortas cuyo proceso ya terminó. Se reprodujo y corrigió esa pérdida de frames. También se reprodujo y corrigió la reutilización de una URL vencida cuando el cambio de canción precedía al sondeo de mantenimiento.

| Comando ejecutado | Resultado |
| --- | --- |
| `npm run build` | Correcto, código 0. |
| `npm test` | **302 aprobadas, 0 fallos, 0 canceladas, 0 omitidas**, código 0; conserva las 256 de la rama base. |
| `npm run deploy:check` | Correcto, código 0; 19 comandos, sin conectar a Discord ni iniciar el bot. |

La huella de comandos sigue siendo `3e86b2114dfce87c089fca414acbc597b3b22810bbb4f0273e3d576e927d168f`. La prueba local de audio muestra una advertencia DEP0169 de una dependencia por `url.parse`; no produjo fallos y no se ocultó para validar.

## Archivos y activación pendiente

Nuevos: `src/music/audioPreloader.ts`, `src/music/prebufferedStream.ts`, los tres archivos de pruebas y este informe. Modificados: `src/music/events.ts`, `playbackRecovery.ts`, `queueChanges.ts`, `ytDlpSearchPlugin.ts`, `scripts/supervise.cjs`, `package.json`, `package-lock.json`, README y documentación operativa.

`AUDIO_PRELOADER_ENABLED=false` desactiva la preparación al siguiente arranque; la reproducción, recuperación, watchdog y persistencia conservan sus rutas habituales. No cambia ningún comando slash.

La eliminación completa del silencio exigiría otra estrategia de pipeline continuo y cambios mayores en el reproductor. Se conservan la sustitución de recursos, la planificación de paquetes de Discord y el [padding predeterminado de cinco frames](https://discord.js.org/docs/packages/voice/0.19.2/CreateAudioResourceOptions:Interface), que con frames de 20 ms corresponde aproximadamente a 100 ms. Las fuentes HTTP pueden fallar después del primer audio o cerrar una conexión que estaba bajo backpressure; una URL válida y un buffer inicial no garantizan toda la canción. La [documentación de protocolos de FFmpeg](https://ffmpeg.org/ffmpeg-protocols.html) describe esas conexiones y opciones, mientras que sus límites de preparación se aplican aquí desde Node.

No se afirma una reducción porcentual de silencios reales: falta medir en Discord. Durante una activación autorizada conviene comparar `transition` para buffer/URL/fallback en una playlist larga, probar controles concurrentes, una pausa larga, loop, radio, dos servidores y un reinicio durante la preparación. El bot y el supervisor activos siguen usando su código anterior hasta un reinicio autorizado.
