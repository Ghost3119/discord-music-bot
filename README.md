# Discord Music Bot

Bot privado de musica para Discord hecho con `discord.js`, `DisTube`, `yt-dlp` y TypeScript.

## Que soporta

El bot puede reproducir musica usando enlaces directos y busquedas por nombre.

| Plataforma | Soporte | Notas |
| --- | --- | --- |
| YouTube | Si | Fuente principal para busquedas por defecto; prueba YouTube Music si no hay resultados. |
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
- `fuente`: fuente usada cuando el bot necesita buscar una version reproducible.

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

Tambien hay botones en el embed de reproduccion para pausar/reanudar, saltar, detener y ver la cola.

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
| `npm run start` | Ejecuta la version compilada. |
| `npm run deploy` | Registra comandos slash en el servidor configurado. |

## Notas

- Los errores de `/play`, `/search` y reproducción incluyen una causa, una sugerencia y un código de diagnóstico. Distinguen búsquedas vacías, restricciones de acceso o región, límites de solicitudes, fallos de red, voz y audio. El error completo se conserva en la consola.
- Si cambias opciones de comandos slash, corre `npm run deploy` otra vez.
- Si una plataforma falla, revisa si `yt-dlp` soporta ese enlace.
- Para playlists grandes, la resolucion puede tardar porque cada cancion necesita buscar una fuente reproducible.
