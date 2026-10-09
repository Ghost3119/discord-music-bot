# Plan de mejoras del bot de música

Estado al 8 de octubre de 2026: las entregas 1 a 6 están implementadas y compiladas. La entrega 7 tiene pruebas locales y guía de operación; el registro de comandos, el reinicio y la validación prolongada en Discord quedan pendientes de mantenimiento. No se ha reiniciado el bot en uso.

## Objetivo y punto de partida

Completar las siete mejoras propuestas, dando prioridad a la continuidad de la música, la conservación de la cola y los errores recuperables. Mantener el panel con portada elegido y preparar cada entrega para un reinicio de mantenimiento.

El repositorio ya tiene supervisor del proceso, recuperación de colas, búsquedas alternativas, reintentos limitados del audio, avisos editables y un panel por sesión. `/shuffle` y `/remove` también existen: necesitan mejoras, no una segunda implementación. La cola ya muestra duración pendiente; falta estimar cuándo empieza cada canción y representar los nuevos estados.

La referencia inicial fue de 113 pruebas aprobadas. La implementación añade pruebas del detector, bloqueo, historial, gestión simultánea, permisos, persistencia y límites de disco. El resultado final y los pasos de activación se documentan en [OPERACION.md](OPERACION.md).

## Orden de trabajo

| Entrega | Mejoras incluidas | Depende de |
| --- | --- | --- |
| 1 | Registros con rotación y estado compartido de reproducción | Código actual |
| 2 | Detector de audio atascado y freno de fallos consecutivos | 1 |
| 3 | Comando privado `/estado` | 1 y 2 |
| 4 | Gestión de cola: reforzar `/shuffle` y `/remove`; añadir `/clear` y `/move` | 2 |
| 5 | Historial y botón Volver a intentar | 1, 2 y 4 |
| 6 | Estados visuales y tiempos estimados | 2, 4 y 5 |
| 7 | Validación integrada y despliegue gradual | Todas |

Los valores numéricos siguientes son los implementados. Podrán ajustarse tras la validación en el servidor de pruebas.

## Resultado de implementación

- Registros JSONL asíncronos con rotación, redacción de credenciales y referencias de incidentes; archivos separados para bot y supervisor.
- Estado por sesión, detector de 8/12 segundos y freno de tres solicitudes fallidas en cinco minutos. Reintento manual controlado y bloqueo conservado al reiniciar.
- `/estado` privado, `/historial` paginado y reintentos desde enlaces públicos, con límites de retención y deduplicación.
- `/clear` y `/move`, además de `/shuffle` y `/remove` reforzados. Comprobaciones del canal de voz, operaciones ordenadas y descarte de resultados tardíos.
- Portada grande conservada, estados del audio, historial y Reintentar en el panel, inicio aproximado de pendientes y tiempo restante del ciclo actual.
- Pruebas de recuperación integrada, dos servidores, pausas, callbacks tardíos, componentes de Discord, errores de disco, restauración bloqueada y una hora de avance de audio con reloj simulado. La hora simulada no equivale a una hora de reproducción real en Discord.
- Preparación de activación reforzada: `deploy:check` comprueba los 19 comandos sin contactar con Discord. El registro real falla con código 1 si hay problemas y verifica la respuesta de la API. La suite completa tiene 185 pruebas aprobadas; registro real, reinicio y validación prolongada siguen pendientes y aplazados por indicación del usuario.
- Doce pruebas adicionales con la cola y el bloqueo reales de DisTube, y voz simulada, cubren errores tardíos de voz, cierre fallido, errores y finales duplicados, Siguiente y seek simultáneos con el fin del audio, sesiones reemplazadas y cien sesiones sucesivas. Se corrigieron los fallos reproducidos: una excepción tardía sin manejador y el avance indebido de la cola por eventos antiguos.
- Diez pruebas adicionales de persistencia y restauración cubren cierre durante consultas pendientes, sesiones manuales que sustituyen o cancelan la restauración, eventos antiguos, solicitudes de restauración concurrentes y limpieza de manejadores. Se comprobó además el método real `Queue.setRepeatMode`: aplicar el mismo modo dos veces lo desactiva; la restauración ahora conserva el ajuste.
- Nueve pruebas adicionales de persistencia del historial cubren fallos de disco y reemplazo atómico, recuperación sin nuevas canciones, cambios durante una escritura y cierre. Un error conserva los cambios pendientes y programa un reintento a los 60 segundos, con un solo temporizador. Al cerrar se cancela y se realiza un último intento; el temporizador no mantiene vivo el proceso.

La configuración y la secuencia de activación y vuelta atrás están en [OPERACION.md](OPERACION.md). Se mantienen a continuación el alcance y los criterios de aceptación de cada entrega.

## Entrega 1: registros y estado compartido

- Crear un registro común de eventos con fecha, nivel, servidor, sesión, canción, operación, código y resultado. Asignar una referencia de incidente para relacionar `/estado`, historial y consola.
- Guardar registros en `logs/`, además de conservar la salida de consola. Proponer archivos de hasta 10 MB y cinco archivos anteriores, con límites configurables.
- Ocultar tokens, cookies, cabeceras, enlaces de webhooks y parámetros sensibles. No guardar objetos completos de interacciones ni enlaces temporales de audio.
- Hacer las escrituras fuera de la ruta crítica de reproducción, con una cola de escritura limitada. Si el disco falla o se llena, continuar por consola sin recursión ni acumulación ilimitada.
- Incluir los fallos fatales y los reinicios del supervisor; definir un cierre de logs con tiempo máximo para que nunca bloquee el cierre del bot.
- Mantener un estado por sesión: preparando, reproduciendo, pausado, recuperando, bloqueado por fallos, finalizado o desconectado. Compartirlo entre recuperación, diagnóstico y panel.
- Liberar temporizadores, referencias y tareas cuando termina una sesión. Distinguir cada incorporación a la cola, aunque dos canciones tengan la misma URL.

**Aceptación:** un error se puede seguir por su referencia; los registros rotan dentro del límite; un fallo al escribirlos no afecta al audio; una sesión nueva no hereda operaciones de la anterior.

## Entrega 2: continuidad del audio

### Detector de reproducción atascada

- Comprobar cada dos segundos si avanza el recurso de audio, incluso cuando DisTube no emite un error. Detectar falta de frames, no silencio musical.
- Proponer ocho segundos sin avance para iniciar la recuperación de audio que ya estaba reproduciéndose; con el intervalo de comprobación, la detección ocurre aproximadamente entre ocho y diez segundos. Al arrancar una canción o cambiar el recurso por un seek, permitir hasta doce segundos para recibir el primer audio, sin sumar después otra espera de ocho segundos. Descontar las pausas manuales y reconocer desconexiones.
- Distinguir el plazo de detección del tiempo de los reintentos: detectar el atasco inicia la recuperación existente, no garantiza que la música vuelva dentro de ocho segundos.
- Si ya hay una extracción o recuperación pendiente, respetar su plazo y no iniciar otra en paralelo.
- Conectar el detector al mismo mecanismo de recuperación existente: dos renovaciones y una búsqueda de alternativa, sin multiplicar presupuestos ni crear ciclos nuevos.
- Una recuperación agotada salta la canción o termina la cola vacía. Una sesión que queda sin voz se informa como desconectada.
- Siguiente, Detener, seek y los cambios de sesión deben invalidar las observaciones anteriores. El detector no debe reiniciar todo el proceso por un fallo de una sola cola.

### Freno de fallos consecutivos

- Contar canciones que agotaron su recuperación, una sola vez por solicitud. No contar cada reintento como una canción fallida.
- Proponer el bloqueo tras tres canciones fallidas consecutivas dentro de cinco minutos. Una canción completada correctamente, o 30 segundos de audio continuo, corta la racha.
- Al bloquear, conservar las canciones pendientes y frenar el avance automático y la radio. Integrar ese freno en el inicio de reproducción; pausar únicamente el reproductor no basta para detener los manejadores automáticos de DisTube.
- Mostrar un único aviso con la causa y las opciones Reintentar y Detener. Reintentar permite una prueba controlada; si vuelve a fallar, mantener el bloqueo.
- Mantener Detener disponible y distinguir este bloqueo de una pausa manual. Guardar el estado bloqueado con el checkpoint para que un reinicio no vuelva a recorrer una playlist que está fallando.
- Respetar la espera por fuente que ya existe para HTTP 403/429.

**Aceptación:** no hay recuperaciones simultáneas de una misma solicitud; la pausa no dispara alarmas; una playlist con fallos deja de consumirse; otras colas del bot siguen funcionando; ningún temporizador revive una cola detenida.

## Entrega 3: `/estado`

- Añadir una respuesta privada con conexión a Discord, tiempo activo, conexión de voz del servidor, canción, fuente real y estado de reproducción.
- Mostrar recuperación en curso, intento, último progreso de audio, racha de fallos y último error con su referencia y hora.
- Usar el estado local, sin lanzar búsquedas ni comprobaciones externas cada vez que se consulte.
- Mostrar solo información del servidor actual y omitir secretos, trazas completas y rutas del equipo. Informar claramente cuando una medida no esté disponible.

**Aceptación:** el comando responde aunque no exista una cola o la fuente esté fallando; sus datos coinciden con los del panel y los registros.

## Entrega 4: gestión de la cola

- Reforzar `/shuffle` y `/remove` con validación de usuario en el canal de voz del bot, respuestas tempranas, actualización del panel y guardado del cambio.
- Añadir `/clear` para quitar solo las canciones pendientes. La canción actual continúa; `/stop` conserva su función de detener toda la sesión.
- Añadir `/move origen destino` para mover canciones pendientes, con la misma numeración que muestra `/queue`: la primera pendiente es la posición 1.
- Proteger la canción actual y la cabecera retenida durante una recuperación. Realizar cambios de forma ordenada respecto a Siguiente, búsquedas y otros comandos.
- Evitar que trabajos de precalentamiento o recomendaciones terminados tarde vuelvan a añadir elementos retirados.
- Revisar la política de permisos en todos los comandos que alteran reproducción. Validar de nuevo la sesión y las posiciones al ejecutar una acción que haya esperado.
- Mantener el guardado de cola consistente y ajustar las páginas después de quitar o mover canciones.

**Aceptación:** ningún cambio afecta a otra sesión ni elimina la canción actual por confusión de índices; dos operaciones simultáneas producen un orden válido; el nuevo orden se conserva al reiniciar.

## Entrega 5: historial y reintento manual

- Añadir `/historial` privado, paginado, con las últimas canciones completadas, saltadas y fallidas, su hora y motivo.
- Conservar hasta 100 entradas por servidor durante siete días, con un límite global de almacenamiento. Guardar de forma atómica y tolerar archivos dañados.
- Registrar una sola entrada final por solicitud. Relacionar una alternativa con la canción originalmente solicitada y mostrar qué fuente llegó a reproducirse.
- Añadir Volver a intentar para incorporar una nueva solicitud al final de la cola, con un presupuesto nuevo y limitado. Obtener audio fresco; no reutilizar enlaces temporales.
- Si no hay sesión, permitir crear una desde el canal de voz del usuario con las mismas comprobaciones que `/play`. Si existe, exigir que esté en el canal del bot.
- Usar identificadores de entrada estables en los botones, controlar dobles clics y rechazar entradas vencidas o de otro servidor.
- Guardar únicamente los datos necesarios y enlaces públicos de origen. Desactivar el reintento cuando no se conserve un origen reproducible seguro.

**Aceptación:** un fallo con varios reintentos deja una sola entrada; dos clics simultáneos no duplican la solicitud; un archivo de historial dañado no impide iniciar ni reproducir.

## Entrega 6: mejoras visuales

- Conservar portada grande, un panel por sesión y los controles actuales.
- Mostrar estados coherentes con el audio: preparando, reproduciendo, pausado, buscando alternativa, bloqueado por fallos o desconectado. Evitar mostrar Reproduciendo solo porque arrancó FFmpeg.
- Integrar acceso al historial y a la recuperación bloqueada sin repetir controles ni crear identificadores duplicados.
- Mostrar espera aproximada por canción: tiempo restante de la actual más la duración de las anteriores. Actualizar al saltar, mover, mezclar, quitar o buscar otra versión.
- Identificar la estimación como aproximada. Con pausa, mostrar tiempo desde la reanudación; con duración desconocida, emisión en vivo, recuperación o repetición que impide avanzar, indicar que no se puede estimar.
- Conservar la duración total pendiente que ya existe y distinguirla del tiempo total restante de la sesión. No inventar una duración para futuras canciones de la radio.
- Mantener ediciones agrupadas, evitar escrituras si no cambia el contenido y respetar el intervalo y la espera tras fallos de Discord del panel actual.

**Aceptación:** portada y controles siguen funcionando; los tiempos se recalculan correctamente; los botones viejos caducan; los fallos de edición no frenan la música ni generan mensajes repetidos.

## Entrega 7: pruebas y activación

1. Ejecutar la suite actual como referencia y añadir pruebas de los comportamientos nuevos en cada entrega. Usar relojes controlados para esperas largas.
2. Probar audio detenido sin evento de error, pausas largas, seek, fuentes bloqueadas, agotamiento de alternativas y rachas de fallos.
3. Probar Siguiente, Detener, edición de cola y reintento mientras hay búsquedas pendientes; incluir dos servidores y sesiones reemplazadas.
4. Probar permisos de Discord, mensajes borrados, interacciones vencidas y límites de componentes. Simular disco lleno, errores de rotación y datos guardados dañados.
5. Probar reinicio con una cola normal y con una cola bloqueada. Comprobar que no se pierden pendientes ni se generan nuevas tormentas de solicitudes.
6. Realizar una prueba prolongada en un bot o servidor de pruebas con logs acotados, temporizadores estables y reproducción controlada. Un segundo bot necesita sus propias credenciales.
7. Preparar la compilación, la documentación de configuración y los nuevos comandos. Registrar estos con `npm run deploy` durante la activación acordada.
8. Activar en mantenimiento: conservar la versión anterior y los datos, detener la instancia, iniciar la nueva y verificar `/estado`, `/play`, Cola, Siguiente y Detener. No ejecutar dos instancias del mismo bot para simular una actualización sin corte.
9. Permitir desactivar el detector y el freno automático por configuración. Mantener formatos de datos compatibles o una migración que permita volver a la versión anterior.

La implementación se puede preparar y probar mientras el usuario usa el bot. `npm run start` no recarga archivos; aplicar el código requerirá un reinicio cuando el usuario esté listo. Las comprobaciones y las recuperaciones reducen interrupciones, pero las restricciones de las plataformas pueden seguir impidiendo reproducir una canción.
