# Operación y activación de las mejoras

La nueva versión se activó con autorización del usuario el 8 de octubre de 2026 a las 20:24 (Ciudad de México): se respaldaron código y datos, Discord confirmó los 19 comandos y se cerró ordenadamente la instancia anterior antes de arrancar una sola instancia nueva. Se confirmó la recuperación de siete canciones. `npm run start` usa un supervisor de proceso, sin recarga de archivos.

El supervisor actual funciona en segundo plano (PID 20556), con el bot hijo PID 25824. El respaldo está en `C:\Users\picud\Repos\discord-music-backup-20261008-202303`; contiene el código, historial Git, `dist` preparado y datos después del cierre, además de los metadatos de activación. La revisión cargada es `2d539846eb84d0ba96b031f44c76759002709dc5`.

La observación inicial confirmó cinco minutos de avance real, actualización del panel y checkpoints, sin errores ni advertencias nuevos en los registros y sin reemplazo del proceso. Esto no equivale a una prueba prolongada ni confirma que todos los controles funcionen. El usuario detuvo Computer Use con Esc durante la comprobación de Discord; no se continuó con entradas en la aplicación. Quedan pendientes las pruebas interactivas y prolongadas, y la recuperación real de una cola bloqueada.

Se encontró además pérdida de la portada al restaurar. El ajuste posterior ya está en el código y en `dist`, con pruebas aprobadas: conserva imágenes públicas y usa una portada de YouTube por ID para checkpoints antiguos. Este ajuste aún no está cargado en el proceso activo; requiere otro reinicio de mantenimiento.

## Validación local

Resultado al 8 de octubre de 2026: **187 pruebas aprobadas, cero fallos**, con compilación TypeScript correcta mediante `npm test`.

La suite cubre el detector a 8 y 12 segundos, pausas y seek, tres solicitudes agotadas con la recuperación real, reintento manual, dos servidores, edición simultánea, recomendaciones tardías, historial con límites de almacenamiento, permisos, fallos de disco, rotación y restauración de colas normales y bloqueadas. También comprueba FFmpeg ante un HTTP 403 de un servidor local y el reinicio del supervisor con procesos de prueba.

Se simula una hora de progreso y la limpieza repetida de sesiones y observadores. La suite local no inicia un bot ni conecta a Discord con las credenciales del usuario. El registro y la activación reales se hicieron después, como se describe arriba; sigue pendiente la prueba prolongada en un servidor. Las pruebas locales no garantizan disponibilidad de YouTube ni SoundCloud.

`npm run deploy:check` también pasó: valida localmente las 19 definiciones, comprueba que sus nombres sean únicos y muestra una huella SHA-256 del contenido. No realiza llamadas a Discord ni requiere credenciales válidas. El registro real devuelve código 1 ante errores de configuración o API, oculta credenciales en los diagnósticos y comprueba que Discord devuelva los comandos esperados. Los casos de éxito y rechazo de la API se probaron con respuestas simuladas, sin registrar comandos reales.

### Validación del ciclo de voz y operaciones simultáneas

Se añadieron 12 pruebas con `QueueManager`, `Queue` y el bloqueo de tareas reales de DisTube, usando una conexión de voz simulada. No se conectan a Discord ni descargan audio. Esta capa permitió reproducir y corregir los siguientes casos:

| Caso | Resultado verificado |
| --- | --- |
| Error de voz después de detener la cola | Lo absorbe un observador permanente; no se convierte en una excepción sin manejador ni revive la reproducción. |
| Error al cerrar el audio de una solicitud agotada | La frontera del evento captura el fallo y la cola se retira incluso si falla `voice.stop`. |
| Errores duplicados del mismo stream | Se consume un solo intento y no se adelanta la cola. |
| Fin de audio antiguo durante Siguiente o seek | Se vuelve a comprobar canción, recurso y sesión después de esperar las operaciones pendientes; no se salta una segunda canción ni se termina el recurso nuevo. |
| Eventos de fin duplicados | Comparten una sola transición pendiente, sin dejar tareas bloqueadas. |
| Cola bloqueada o sesión reemplazada | Los callbacks antiguos no retiran la cabecera ni afectan a la sesión siguiente. |
| Detector, pausa y seek | El detector usa el mismo presupuesto de recuperación; la pausa no cuenta y seek concede los doce segundos para audio nuevo. |
| Cien sesiones sucesivas | Se liberan los manejadores de cola, las tareas y el estado del monitor; queda un único observador de errores tardíos por voz. |

Detener manualmente ya no registra la canción como completada por un evento de fin tardío. Cancelar una recuperación para pasar a otra canción limpia su indicador de intento; los callbacks de una cola cerrada no vuelven a incorporarla al monitor.

Estos resultados amplían la validación local y no sustituyen las pruebas interactivas pendientes ni la prueba prolongada de reproducción real.

### Validación de persistencia y restauración

Se añadieron diez casos de regresión con checkpoints en directorios temporales y consultas controladas, sin conectar el bot. Las 18 pruebas de restauración verifican también el método real `Queue.setRepeatMode` de la versión instalada de DisTube: repetir una asignación del mismo modo lo desactiva. La recuperación aplica ese ajuste solo cuando difiere.

- Cerrar durante la consulta de un canal o plugin impide iniciar después la reproducción guardada y conserva el checkpoint.
- Una sesión manual creada durante la consulta conserva canciones y ajustes propios. Si se detiene antes de terminar la consulta, la restauración pendiente queda cancelada; si se cierra el proceso, se guarda esa sesión manual.
- Una cola sustituta no recibe ajustes ni pausas de una recuperación anterior. Los eventos tardíos de reproducción, incorporaciones y fin no sobrescriben su checkpoint.
- Dos solicitudes simultáneas de restauración comparten una operación. Cerrar el almacén varias veces es seguro y retira sus seis manejadores de eventos, sin acumularlos en las siguientes inicializaciones.

Estas comprobaciones cubren la lógica local de restauración. La activación confirmó la recuperación de una cola normal con conexión real a Discord; sigue pendiente probar una cola bloqueada en un entorno de pruebas.

### Recuperación del guardado del historial

Se corrigió un caso en el que el historial permanecía en memoria después de un fallo de escritura, aunque el disco volviera a estar disponible. Ahora mantiene los cambios pendientes y vuelve a intentar guardarlos a los 60 segundos sin necesitar otra canción. Los errores consecutivos respetan esa espera; las entradas siguen sujetas a los límites de retención y se revisan antes de cada escritura.

El cierre cancela el temporizador, espera la escritura en curso y hace un último intento si quedan cambios pendientes, incluso dentro de la espera de 60 segundos. Si el disco sigue fallando, informa del fallo sin programar más reintentos. El límite general de cierre del proceso sigue siendo de cinco segundos.

Nueve pruebas con archivos temporales y reloj simulado comprueban recuperación automática, fallos persistentes, conservación del archivo anterior si falla el reemplazo, escrituras simultáneas con el cierre y caducidad tras una interrupción prolongada. Una prueba adicional dentro de esos nueve casos usa un proceso local para verificar que el temporizador pendiente no impide su salida; no conecta un bot a Discord.

## Configuración

| Variable | Predeterminado | Efecto |
| --- | --- | --- |
| `AUDIO_WATCHDOG_ENABLED` | `true` | `false` desactiva solo la detección de falta de avance. |
| `AUDIO_BREAKER_ENABLED` | `true` | `false` desactiva solo el bloqueo por fallos consecutivos. |
| `LOG_MAX_BYTES` | `10485760` | Tamaño por archivo; entero de 1 a 104857600. |
| `LOG_BACKUPS` | `5` | Archivos anteriores por proceso; entero de 1 a 20. |

Las variables se leen al arrancar desde el entorno o `.env`. Si desactivas el freno, una cola que ya estaba bloqueada sigue esperando Reintentar o Detener: la configuración no debe reanudarla sin una acción explícita.

El detector observa cada dos segundos el avance del recurso, sin analizar el volumen musical. Permite ocho segundos sin avance después de empezar y doce segundos para el primer audio, también después de seek. Durante una extracción respeta los límites existentes. Detectar no significa completar todos los reintentos dentro de ese plazo.

El freno cuenta solicitudes agotadas, no cada intento. Tres fallos en cinco minutos bloquean la cola. Una canción completada o 30 segundos de audio continuo cortan la racha. Reintentar o `/resume` permiten una solicitud nueva con dos renovaciones y una alternativa; si se agota, vuelve a bloquearse inmediatamente.

## Datos y diagnóstico

- `data/queues.json`: orden, posición aproximada, ajustes y bloqueo. Se conserva al cerrar normalmente; `/stop` elimina esa cola. Un canal vacío no se recupera automáticamente.
- `data/history.json`: completadas, saltadas y fallidas. Hasta 100 por servidor durante siete días, 2000 globales y 2.5 MB. Conserva enlaces públicos de origen reconocidos, nunca enlaces temporales de audio.
- `logs/bot.jsonl` y `logs/supervisor.jsonl`: fecha, nivel y mensajes con enlaces y credenciales ocultos. Cinco archivos anteriores y 10 MiB por archivo de forma predeterminada, unos 120 MiB entre ambos procesos. Una cola de escritura limitada evita acumular memoria si el disco falla.
- `logs/deploy.jsonl`: diagnóstico separado de comprobación y registro de comandos, con la misma rotación (hasta unos 60 MiB adicionales con los valores predeterminados).
- `/estado`: privado, con fuente real, conexión, progreso e incidente. La referencia relaciona diagnóstico, historial y registros `[Incidente]`.
- `/historial`: privado, con páginas de cinco entradas. Volver a intentar añade una solicitud nueva, exige canal de voz y limita dobles clics a uno cada 30 segundos por entrada y servidor.

Conserva `data` entre versiones. No publiques `.env` ni las copias de datos. Un disco que no permite guardar deja disponible el estado en memoria y la consola, pero no asegura persistencia tras un cierre.

## Activación durante mantenimiento

1. Conserva una revisión o copia verificada de la versión anterior. Guarda el estado del repositorio con `git status` y la referencia con `git rev-parse HEAD`; comprueba que esa referencia corresponde a la versión que quieres poder restaurar.
2. Ejecuta `npm test` y `npm run deploy:check`. No arrancan el bot de Discord ni registran comandos. Si hay fallos, corrígelos antes de activar. Conserva la huella mostrada por la comprobación para compararla con el registro real.
3. Cuando puedas interrumpir brevemente la música, detén el supervisor actual con `Ctrl+C`. Espera a que termine. Esto guarda el checkpoint; no uses `/stop` si deseas recuperar la cola.
4. Copia `data` a una carpeta de respaldo fuera del repositorio. Por ejemplo, desde la raíz, con la instancia detenida:

   ```powershell
   $musicBackup = Join-Path (Split-Path -Parent (Get-Location).Path) ("discord-music-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
   New-Item -ItemType Directory -Path $musicBackup
   if (Test-Path -LiteralPath .\data) { Copy-Item -LiteralPath .\data -Destination $musicBackup -Recurse }
   git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $musicBackup "revision.txt")
   ```

5. Registra los comandos nuevos en el servidor configurado: `npm run deploy`. Comprueba que muestre la misma huella y confirme el registro. Si falla, termina con código 1: revisa el motivo antes de continuar o restaura la versión anterior. No necesita iniciar otra instancia del bot. La API tiene un límite de 15 segundos por intento y dos reintentos ante fallos temporales; los límites de solicitudes se rechazan para permitir decidir cuándo volver a intentar.
6. Inicia una sola instancia con `npm run start`. Comprueba la conexión y `/estado`; reproduce una canción y prueba Cola, historial, Siguiente y Detener. Las posiciones de `/remove` y `/move` empiezan en 1 para la primera pendiente. `/clear` conserva la canción actual.
7. En un servidor de pruebas, comprueba pausas largas, seek y una reproducción prolongada; vigila referencias repetidas, crecimiento de logs y desconexiones. No uses una playlist de producción para provocar fallos de forma deliberada.

El estado guardado conserva un bloqueo al reiniciar y solo recupera canales accesibles con personas. Si una plataforma rechaza el acceso, la nueva versión puede conservar la cola y ofrecer alternativas, pero no garantiza reproducir ese contenido.

## Volver a la versión anterior

1. Detén la nueva instancia con `Ctrl+C` y espera a que termine. Conserva una copia aparte de sus datos y registros para diagnosticar el problema.
2. Recupera la revisión o copia verificada anterior en un directorio preparado para ella; instala sus dependencias con `npm ci` y compila con `npm run build`. No descartes cambios locales para hacer la vuelta atrás.
3. Restaura la copia de `data` tomada antes de activar. El campo `blocked` es opcional y el nuevo código acepta checkpoints antiguos. Una versión anterior puede ignorar ese campo, por lo que usar un checkpoint nuevo bloqueado podría hacer que vuelva a recorrer la cola fallida. Mantén aparte el historial nuevo si la versión anterior no lo utiliza.
4. Ejecuta `npm run deploy` desde esa versión para restaurar su conjunto de comandos y arranca una sola instancia con `npm run start`.
5. Comprueba conexión, reproducción y controles. Las posiciones del checkpoint son aproximadas y restaurar una copia anterior pierde los cambios hechos después de esa copia.

Para aislar un problema del detector o del freno sin volver atrás, puedes desactivar la opción correspondiente y reiniciar durante mantenimiento. Los errores operativos siguen capturados y el supervisor mantiene la protección del proceso.
