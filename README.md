# Discord Music Bot

Bot privado de musica para Discord hecho con `discord.js`, `DisTube`, `yt-dlp` y TypeScript.

## Que soporta

El bot puede reproducir musica usando enlaces directos y busquedas por nombre.

| Plataforma | Soporte | Notas |
| --- | --- | --- |
| YouTube | Si | Fuente inicial por defecto; prueba YouTube Music y SoundCloud si no encuentra una versión reproducible. |
| SoundCloud | Si | Soporta URLs directas y busqueda usando la opcion `fuente: SoundCloud`. |
| Spotify | Parcial | Lee metadata de canciones, albums y playlists, pero no reproduce audio directo desde Spotify. Busca una version reproducible en YouTube o SoundCloud. |
| Apple Music | Parcial | Lee informacion del enlace y busca una version reproducible en YouTube o SoundCloud. |
| Otros sitios | Parcial | URLs compatibles con `yt-dlp` pueden funcionar, dependiendo del sitio. |

Spotify y Apple Music se usan como entrada de metadata. El audio final viene de una fuente reproducible compatible con `yt-dlp`.

## Requisitos

- Node.js 22.12 o superior.
- Un bot de Discord creado en el Developer Portal.
- Permisos del bot para ver canales, conectarse y hablar en canales de voz.
- Dependencias instaladas con `npm install`.

## Configuracion

Crea un archivo `.env` en la raiz del proyecto:

```env
DISCORD_TOKEN=token_del_bot
CLIENT_ID=id_de_la_aplicacion
GUILD_ID=id_del_servidor
```

Spotify admite credenciales opcionales, distintas de las de Discord:

```env
SPOTIFY_CLIENT_ID=id_de_tu_aplicacion_de_spotify
SPOTIFY_CLIENT_SECRET=secreto_de_tu_aplicacion_de_spotify
```

Sin ellas, el plugin intenta leer los datos públicos. Si no consigue un token, avisa que puede recuperar como máximo 100 canciones de una playlist o álbum. Las credenciales no garantizan acceso a listas privadas ni eliminan las restricciones de la API; el bot sigue buscando el audio en YouTube o SoundCloud. No publiques el archivo `.env`.

## Instalacion

```powershell
npm install
npm run build
```

Registra los comandos slash en tu servidor:

```powershell
npm run deploy
```

Inicia el bot:

```powershell
npm run start
```

Para desarrollo:

```powershell
npm run dev
```

## Comandos

### `/play`

Reproduce una cancion, album, playlist o busqueda.

Opciones:

- `query`: nombre de la cancion o URL.
- `fuente`: fuente preferida para buscar una version reproducible. Si falla, el bot prueba las otras fuentes.

Ejemplos:

```text
/play query:never gonna give you up
/play query:https://www.youtube.com/watch?v=dQw4w9WgXcQ
/play query:https://soundcloud.com/artist/song fuente:SoundCloud
/play query:https://open.spotify.com/track/... fuente:YouTube
/play query:https://open.spotify.com/album/... fuente:SoundCloud
/play query:https://music.apple.com/... fuente:YouTube
```

### Controles

```text
/pause
/resume
/skip
/stop
/queue
/nowplaying
/volume valor:50
/autoplay
/recommend cantidad:5
```

El reproductor muestra la portada grande cuando está disponible, progreso, volumen, fuente de audio y siguiente canción. Usa botones con texto para pausar/reanudar, saltar, ver la cola y detener.

- Cada sesión mantiene un solo panel y lo edita al cambiar la canción o sus ajustes. El progreso se actualiza cada 20 segundos; no se repiten ediciones si el contenido sigue igual, por ejemplo durante una pausa.
- `/nowplaying` responde solo al usuario con un enlace al panel actual. Si el mensaje fue eliminado, intenta recrearlo; si no puede publicarlo, muestra una vista sin controles.
- `/queue` y el botón Cola muestran una lista privada, con páginas de diez canciones, posiciones y duración de las canciones en espera. Los botones de las páginas caducan cuando termina su sesión.
- Al detenerse o terminar la cola, el panel queda marcado como finalizado y sus controles se desactivan. Los controles de mensajes anteriores al reinicio también se rechazan y se retiran al pulsarlos.
- Los cambios del panel se realizan en orden. Los fallos de Discord se registran sin detener el audio y dejan una espera de un minuto antes de volver a intentarlo; solo un mensaje confirmado como eliminado permite crear un reemplazo.

`/autoplay` alterna la radio para la cola actual: al terminar, intenta añadir otra canción del YouTube Mix. `/recommend` añade de 1 a 20 sugerencias (5 por defecto) usando la canción actual y, si hace falta, la última de la cola. Evita repetir canciones que ya están en cola o en el historial reciente. Ambos dependen de que YouTube Mix esté disponible; no garantizan música infinita.

## Como funciona Spotify

Spotify no entrega audio directo para este tipo de bot. Cuando pasas un enlace de Spotify:

1. El bot lee la informacion del track, album o playlist.
2. Genera una busqueda con el nombre y artista.
3. Busca una version reproducible en YouTube o SoundCloud.
4. Agrega el resultado a la cola.

Esto significa que puede haber diferencias entre la version de Spotify y el resultado encontrado, por ejemplo remixes, videos oficiales, versiones en vivo o subidas por otros usuarios.

## Cache de busquedas

El bot cachea resultados de busqueda para que playlists grandes de Spotify o Apple Music no repitan tanto trabajo.

- Las busquedas se guardan por fuente y texto normalizado.
- El cache de busquedas dura 12 horas y guarda hasta 500 resultados.
- Los enlaces directos de stream se cachean por 25 minutos y guardan hasta 200 resultados.
- Cuando entra una playlist, el bot precalienta en segundo plano las primeras canciones de la cola.
- Durante la reproduccion, tambien precalienta las canciones siguientes.

Esto ayuda especialmente cuando se repite una playlist, hay canciones duplicadas o varios usuarios piden musica parecida.

## Recuperación y operación en producción

`npm run start` ejecuta un supervisor que reinicia el proceso si termina inesperadamente. Usa esperas crecientes de 1 a 30 segundos para evitar un bucle de reinicios rápidos. También comprueba una señal de actividad del bot y lo reinicia si deja de responder durante más de 60 segundos. `Ctrl+C` detiene el supervisor y el bot sin volver a iniciarlo.

- Los errores de comandos, botones, eventos y notificaciones de Discord se capturan en su operación. Un mensaje rechazado por permisos o una interacción vencida no termina el proceso.
- Una excepción o promesa rechazada que escape de esas protecciones se registra, guarda el estado disponible y cierra el proceso. El supervisor inicia un proceso limpio. Esto produce una interrupción breve; continuar después de una excepción no controlada puede dejar el proceso en un estado inconsistente, según la [documentación de Node.js](https://nodejs.org/docs/latest-v24.x/api/process.html#warning-using-uncaughtexception-correctly).
- Las búsquedas prueban hasta cinco candidatos por fuente. Comparan título y artista y penalizan versiones en vivo, covers o remixes que no se pidieron. Las coincidencias débiles se descartan. El embed muestra la fuente que entrega el audio.
- Los fallos temporales de red o HTTP 5xx tienen como máximo dos reintentos con espera. No se insiste en contenido privado, eliminado o restringido, ni en HTTP 429. Los bloqueos 403/429 ponen esa fuente en pausa por un minuto y permiten probar otra.
- Cada intento de yt-dlp tiene 20 segundos de límite; una operación tiene 60 segundos y una búsqueda completa 90 segundos. Los procesos agotados se cancelan. Hay un máximo de tres extracciones simultáneas y 50 consultas esperando. Las playlists extraídas con yt-dlp se limitan a 500 entradas.
- Si falla el stream, el bot invalida el enlace cacheado y reintenta hasta dos veces, intentando retomar cerca del punto de interrupción. Después continúa con la siguiente canción, si existe. Los errores tardíos de streams cerrados mantienen un listener para no convertirse en errores no controlados.
- La cola y su progreso se guardan en `data/queues.json` al cambiar canciones y cada diez segundos. Al reiniciar se recuperan hasta 500 canciones, volumen, repetición, radio y pausa, con una posición aproximada. No se guardan enlaces temporales de audio. Se descartan estados con más de 24 horas y solo se recuperan canales de voz accesibles que tengan personas conectadas. `/stop` elimina el estado de esa cola.
- Un archivo de estado dañado o un fallo al escribirlo se registra sin interrumpir la reproducción. Conserva el directorio `data` entre despliegues para recuperar las colas. Si corres el bot en un contenedor, monta ese directorio en almacenamiento persistente.
- Token, variables requeridas o intents inválidos detienen el supervisor con código 78: requieren corregir la configuración. Los registros completos salen por la consola; el servicio que lance el supervisor debe conservarlos.

El supervisor funciona mientras `npm run start` siga activo. Para arrancar después de reiniciar la máquina, configura ese comando en el servicio de tu entorno; en una PC, evita la suspensión mientras el bot deba estar disponible.

yt-dlp ya no se descarga al arrancar: evita que una actualización o una descarga fallida bloquee el inicio. Actualízalo durante mantenimiento con `npm run update:ytdlp` y reinicia el bot después de verificarlo.

## Mejoras recomendadas

Ideas buenas para seguir mejorando el bot:

- `/shuffle`: mezclar la cola.
- `/remove`: quitar una cancion por posicion.
- `/clear`: limpiar la cola.
- `/loop`: repetir cancion o cola.
- `/seek`: saltar a un minuto/segundo especifico.
- `/lyrics`: buscar letra de la cancion actual.
- Filtros de audio como bass boost, nightcore o vaporwave.
- Validar que el usuario este en el mismo canal de voz que el bot antes de controlar la musica.
- Mejorar la resolucion de Spotify/Apple Music para reducir resultados incorrectos.
- Guardar colas favoritas por servidor.

## Scripts

| Script | Descripcion |
| --- | --- |
| `npm run dev` | Ejecuta el bot con `ts-node`. |
| `npm run build` | Compila TypeScript a `dist`. |
| `npm run start` | Ejecuta la versión compilada con supervisor y reinicio automático. |
| `npm run start:once` | Ejecuta un solo proceso, para usar con un supervisor externo. |
| `npm run update:ytdlp` | Actualiza yt-dlp durante mantenimiento, con un límite de 60 segundos. |
| `npm test` | Compila y ejecuta las pruebas, incluidas recuperación y fallos simulados. |
| `npm run deploy` | Registra comandos slash en el servidor configurado. |

## Notas

- Los errores de `/play`, `/search` y reproducción incluyen una causa, una sugerencia y un código de diagnóstico. Distinguen búsquedas vacías, restricciones de acceso o región, límites de solicitudes, fallos de red, voz y audio. El error completo se conserva en la consola.
- El código de FFmpeg `3436169992` en Windows equivale a HTTP 403: la fuente rechazó el acceso al audio. Se renueva el enlace con los reintentos limitados existentes; después se continúa con la siguiente canción. No indica por sí solo que FFmpeg esté mal instalado. Los últimos mensajes de FFmpeg se conservan en memoria y se imprimen al fallar, con enlaces y cabeceras sensibles ocultos. Un mismo fallo activo no se registra de nuevo como error tardío.
- DisTube limita sus eventos a un listener por defecto. El bot usa un límite finito de diez porque reproducción, guardado de colas y desconexión automática comparten eventos; los avisos por superar ese límite siguen habilitados.
- Si cambias opciones de comandos slash, corre `npm run deploy` otra vez.
- Si una plataforma falla, revisa si `yt-dlp` soporta ese enlace.
- Para playlists grandes, la resolucion puede tardar porque cada cancion necesita buscar una fuente reproducible.
