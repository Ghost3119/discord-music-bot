# Discord Music Bot

Bot privado de musica para Discord hecho con `discord.js`, `DisTube`, `yt-dlp` y TypeScript.

Incluye **SONORA**, un panel web privado con acceso mediante Discord, reproductor y cola en tiempo real, biblioteca de playlists, favoritos, diagnósticos y un modo inmersivo con letras y fondos derivados de la portada.

## Levantar toda la aplicación

Desde la raíz del proyecto, usa una sola terminal:

```powershell
npm run dev
```

Ese comando instala las dependencias que falten, compila el backend, inicia el bot con su supervisor y levanta la vista cuando Fastify está listo. Abre **http://127.0.0.1:5173**. **Ctrl+C cierra todo.** No necesitas ejecutar `dev:web` en otra terminal.

Configura una sola vez `.env` con `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `WEB_CLIENT_SECRET` y la [política de acceso del panel](#panel-web-privado): `allowlist` con `WEB_ALLOWED_USER_IDS`, o `guild_members` con `WEB_ALLOWED_GUILD_IDS`. Los IDs se separan por comas. En Discord OAuth2 registra exactamente `http://127.0.0.1:5173/auth/discord/callback`. El lanzador ajusta el origen y el callback de desarrollo en memoria; no modifica tu `.env` ni expone secretos a Vite.

Si falta configuración o un puerto está ocupado, el comando muestra el motivo antes de iniciar el bot. Si dejaste Vite abierto por separado, cierra esa terminal primero. Para comprobar sin arrancar ni instalar nada: `npm run dev:check`.

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
- El lanzador `npm run dev` instala automáticamente las dependencias que falten.

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

Opciones de operación (se aplican al siguiente arranque):

```env
AUDIO_WATCHDOG_ENABLED=true
AUDIO_BREAKER_ENABLED=true
LOG_MAX_BYTES=10485760
LOG_BACKUPS=5
```

El detector y el freno se pueden desactivar por separado con `false`. Los logs admiten tamaños de 1 a 104857600 bytes y de 1 a 20 archivos anteriores por proceso; valores inválidos usan los valores predeterminados. El bot y el supervisor escriben en archivos separados.

Sin ellas, el plugin intenta leer los datos públicos. Si no consigue un token, avisa que puede recuperar como máximo 100 canciones de una playlist o álbum. Las credenciales no garantizan acceso a listas privadas ni eliminan las restricciones de la API; el bot sigue buscando el audio en YouTube o SoundCloud. No publiques el archivo `.env`.

## Instalacion

Para desarrollo local, basta `npm run dev` después de configurar `.env`. Los pasos siguientes son para preparar manualmente la versión compilada:

```powershell
npm install
npm run setup:web
npm run build
```

Para reinstalar las versiones guardadas en `package-lock.json`, usa `npm ci`. El proyecto conserva un override de `tar` a `^7.5.22` porque el instalador nativo de Opus todavía declara la rama 6; esta versión incluye las correcciones de los [avisos de seguridad de node-tar](https://github.com/isaacs/node-tar/security/advisories). Después de cambiar dependencias, ejecuta `npm audit`, `npm test` y `npm run deploy:check`.

Registra los comandos slash en tu servidor:

```powershell
npm run deploy
```

Puedes comprobar antes las definiciones sin contactar con Discord ni iniciar el bot:

```powershell
npm run deploy:check
```

La comprobación muestra los 19 comandos y la huella SHA-256 del registro. El registro real verifica la respuesta de Discord y termina con código 1 si falla; no interpretes un registro fallido como permiso para continuar la activación. Su diagnóstico oculta credenciales y se conserva en `logs/deploy.jsonl`.

Inicia el bot:

```powershell
npm run start
```

Para levantar bot, backend y frontend juntos durante desarrollo:

```powershell
npm run dev
```

`npm run dev:bot` conserva el arranque anterior de solo el bot. `npm run start` conserva el supervisor de la versión compilada; el panel estático requiere `WEB_ENABLED=true` y la configuración del puerto 8080 descrita en la guía del dashboard.

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
/estado
/historial
/shuffle
/remove posicion:1
/clear
/move origen:3 destino:1
/loop modo:off
/seek segundos:90
```

El reproductor muestra la portada grande cuando está disponible, progreso, volumen, fuente de audio, estado y siguiente canción. Usa botones con texto para pausar/reanudar, saltar, ver la cola, detener y abrir el historial. Cuando la cola queda bloqueada por fallos, aparece Reintentar y se deshabilita Siguiente.

- Cada sesión mantiene un solo panel y lo edita al cambiar la canción o sus ajustes. El progreso se actualiza cada 20 segundos; no se repiten ediciones si el contenido sigue igual, por ejemplo durante una pausa.
- `/nowplaying` responde solo al usuario con un enlace al panel actual. Si el mensaje fue eliminado, intenta recrearlo; si no puede publicarlo, muestra una vista sin controles.
- `/queue` y el botón Cola muestran una lista privada, con páginas de diez canciones, posiciones, duración e inicio aproximado de cada canción. Con pausa, la espera se mide desde la reanudación. No se estima durante una recuperación, una repetición de canción ni después de audio de duración desconocida o en vivo. La repetición de cola muestra el ciclo actual; la radio no incluye canciones futuras.
- Al detenerse o terminar la cola, el panel queda marcado como finalizado y sus controles se desactivan. Los controles de mensajes anteriores al reinicio también se rechazan y se retiran al pulsarlos.
- Los cambios del panel se realizan en orden. Los fallos de Discord se registran sin detener el audio y dejan una espera de un minuto antes de volver a intentarlo; solo un mensaje confirmado como eliminado permite crear un reemplazo.

Los comandos que alteran la música y los controles del reproductor requieren estar en el canal de voz del bot. `/clear` retira únicamente las pendientes y conserva la canción actual; si la radio está activada seguirá buscando canciones. `/remove` y `/move` usan la numeración de `/queue`: la primera pendiente es la 1. Los cambios se ordenan con las demás operaciones de la cola y se guardan. Una recomendación o búsqueda terminada después de un cambio de sesión o de cola se descarta.

`/estado` responde en privado con conexión, tiempo activo, voz, fuente real, recuperación, racha de fallos, último avance de audio y último código con referencia. Consulta el estado local y funciona sin cola.

`/historial` muestra en privado canciones completadas, saltadas y fallidas, con fecha, fuente real y referencia de error. Guarda una entrada final por solicitud, incluyendo su versión alternativa, en `data/history.json`: hasta 100 por servidor durante siete días, 2000 en total y 2.5 MB. Un archivo dañado o un fallo de disco no detiene la música. Volver a intentar añade una nueva solicitud con audio fresco; requiere un enlace público de origen reconocido y estar en el canal del bot, o en un canal de voz si todavía no hay cola. Dos clics sobre la misma entrada se limitan a un reintento cada 30 segundos.

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
- El precalentamiento tiene prioridad secundaria y deja tres plazas de espera para solicitudes interactivas. Recibe turnos limitados incluso si siguen llegando búsquedas de usuarios.

Esto ayuda especialmente cuando se repite una playlist, hay canciones duplicadas o varios usuarios piden musica parecida.

## Preparación anticipada de audio

El Smart Audio Preloader resuelve la próxima canción mientras avanza la actual y, cuando faltan hasta 30 segundos, prepara un pequeño buffer Opus sin enviarlo a voz. Al cambiar de canción reutiliza ese mismo recurso, evitando repetir el arranque de FFmpeg. Si solo dispone de una URL válida o la preparación falla, conserva la reproducción convencional y su recuperación.

Hay como máximo dos FFmpeg anticipados y dos resoluciones anticipadas simultáneas; yt-dlp mantiene su pool global y la prioridad de reproducción. La precarga se cancela al detener, buscar otra posición, pausar o cambiar la próxima canción. Las emisiones en vivo y duraciones desconocidas solo preparan URL. Los recursos no se guardan entre reinicios.

`AUDIO_PRELOADER_ENABLED=false` desactiva esta función al siguiente arranque. Los logs `[Precarga]` incluyen tiempos, usos de buffer/URL, cancelaciones y el intervalo local entre canciones. La función reduce el trabajo pendiente en una transición; no garantiza reproducción perfectamente gapless en Discord. La [arquitectura y validación](docs/SMART_AUDIO_PRELOADER.md) incluyen 302 pruebas aprobadas y las comprobaciones manuales pendientes. Su activación sigue pendiente de autorización.

## Recuperación y operación en producción

`npm run start` ejecuta un supervisor que reinicia el proceso si termina inesperadamente. Usa esperas crecientes de 1 a 30 segundos para evitar un bucle de reinicios rápidos. También comprueba una señal de actividad del bot y lo reinicia si deja de responder durante más de 60 segundos. `Ctrl+C` detiene el supervisor y el bot sin volver a iniciarlo.

Este comando no vigila los archivos ni recarga cambios: compilar mientras está en uso deja la nueva versión preparada para el siguiente reinicio.

- Los errores de comandos, botones, eventos y notificaciones de Discord se capturan en su operación. Un mensaje rechazado por permisos o una interacción vencida no termina el proceso.
- Una excepción o promesa rechazada que escape de esas protecciones se registra, guarda el estado disponible y cierra el proceso. El supervisor inicia un proceso limpio. Esto produce una interrupción breve; continuar después de una excepción no controlada puede dejar el proceso en un estado inconsistente, según la [documentación de Node.js](https://nodejs.org/docs/latest-v24.x/api/process.html#warning-using-uncaughtexception-correctly).
- Las búsquedas prueban hasta cinco candidatos por fuente. Comparan título y artista y penalizan versiones en vivo, covers o remixes que no se pidieron. Las coincidencias débiles se descartan. El embed muestra la fuente que entrega el audio.
- Los fallos temporales de red o HTTP 5xx tienen como máximo dos reintentos con espera. No se insiste en contenido privado, eliminado o restringido, ni en HTTP 429. Los bloqueos 403/429 ponen esa fuente en pausa por un minuto y permiten probar otra.
- Cada extracción efectiva de yt-dlp tiene 20 segundos de límite desde que obtiene un slot; la espera por turno y los reintentos comparten los 60 segundos de la operación. Una búsqueda completa tiene 90 segundos. Los procesos agotados se cancelan; una cancelación del usuario conserva su causa y no se reintenta. Hay un máximo de tres extracciones simultáneas y 50 consultas esperando. Las playlists se limitan a 500 entradas de metadatos planos y su audio se extrae al necesitarlo.
- Si falla el stream por red, HTTP 403/5xx o un error del motor de audio, el bot invalida el enlace cacheado y reintenta hasta dos veces, intentando retomar cerca del punto de interrupción. Después busca una alternativa, empezando por otra plataforma y permitiendo otra subida de la misma plataforma. Esa búsqueda dura como máximo 45 segundos y consulta hasta seis candidatos completos. Excluye la subida que falló, compara título, artista cuando la entrada lo identifica y duración, y descarta covers, remixes u otras variantes que no se pidieron. Una alternativa comienza desde cero; si no existe o también falla, continúa con la siguiente canción o termina la cola vacía. No vuelve a iniciar otro ciclo de reintentos para esa alternativa.
- El detector comprueba el avance del recurso de audio cada dos segundos. Ocho segundos sin avance del audio que ya había comenzado inician la recuperación existente (aproximadamente entre ocho y diez segundos según el sondeo). Una canción nueva o un seek tienen doce segundos de margen para el primer audio. Las pausas manuales, las desconexiones y las extracciones pendientes no disparan otra recuperación. Este plazo detecta el atasco; los reintentos pueden necesitar más tiempo.
- Tres solicitudes fallidas dentro de cinco minutos bloquean el avance automático y la radio, conservando la canción fallida y las pendientes. Una canción completada o 30 segundos de audio continuo cortan la racha. Reintentar o `/resume` hacen una prueba con un presupuesto nuevo y limitado; si se agota, la cola vuelve a bloquearse. Detener sigue disponible. El bloqueo, la prueba en curso y la racha reciente se guardan y restauran antes de solicitar audio para evitar recorrer otra vez una playlist que está fallando.
- Cada recuperación usa un aviso compacto: amarillo durante el intento, verde cuando el recurso de audio avanza y rojo si se agotan las opciones. Se edita el mismo mensaje. Si pasan 30 segundos sin audio, descontando las pausas, el aviso indica que la recuperación todavía no se confirmó. Los fallos al enviar o editar el aviso se capturan sin generar mensajes de reemplazo repetidos.
- Siguiente y Detener cancelan la búsqueda pendiente antes de esperar el bloqueo interno de la cola. Un resultado tardío no reemplaza la siguiente canción ni revive una sesión terminada. Si Siguiente rechaza la operación después de cancelar la búsqueda, la canción fallida se retira para evitar dejarla bloqueada.
- Los registros `[Recuperación]` incluyen servidor, canción, fuente, intento, código y resultado, además de la canción alternativa cuando se seleccionó. Los errores tardíos de streams cerrados mantienen un listener para no convertirse en errores no controlados.
- La conexión de voz conserva un observador de errores tardíos después de terminar la cola. Los errores activos se manejan en una operación protegida, se deduplican por stream y respetan el bloqueo por fallos. Un evento de fin espera las operaciones de la cola y verifica que la canción y el recurso sigan vigentes, para no avanzar dos veces si coincide con Siguiente o seek. Detener no cuenta como completar la canción.
- La cola y su progreso se guardan en `data/queues.json` al cambiar canciones y cada diez segundos. Al reiniciar se recuperan hasta 500 canciones, volumen, repetición, radio y pausa, con una posición aproximada. No se guardan enlaces temporales de audio. Se descartan estados con más de 24 horas y solo se recuperan canales de voz accesibles que tengan personas conectadas. `/stop` elimina el estado de esa cola.
- Un archivo de estado dañado o un fallo al escribirlo se registra sin interrumpir la reproducción. Conserva el directorio `data` entre despliegues para recuperar las colas. Si corres el bot en un contenedor, monta ese directorio en almacenamiento persistente.
- Token, variables requeridas o intents inválidos detienen el supervisor con código 78: requieren corregir la configuración.
- Los registros salen por consola y por `logs/bot.jsonl` y `logs/supervisor.jsonl`, con fecha y nivel. Los incidentes incluyen servidor, sesión, canción, código, intento y referencia para relacionarlos con `/estado` y el historial. Se ocultan enlaces, tokens y cabeceras sensibles. Por defecto se conservan 10 MiB por archivo y cinco anteriores por proceso (unos 120 MiB entre ambos). Las escrituras son asíncronas, con una cola limitada; si falla el disco, se conserva la consola y se espera un minuto antes de volver a escribir.

El supervisor funciona mientras `npm run start` siga activo. Para arrancar después de reiniciar la máquina, configura ese comando en el servicio de tu entorno; en una PC, evita la suspensión mientras el bot deba estar disponible.

yt-dlp ya no se descarga al arrancar: evita que una actualización o una descarga fallida bloquee el inicio. Actualízalo durante mantenimiento con `npm run update:ytdlp` y reinicia el bot después de verificarlo.

## Activación y vuelta a la versión anterior

La implementación y las pruebas se pueden preparar mientras el bot está en uso. **No hay recarga automática** y los comandos nuevos requieren registro. La guía detallada está en [docs/OPERACION.md](docs/OPERACION.md); el alcance y la validación están en [docs/PLAN_MEJORAS.md](docs/PLAN_MEJORAS.md).

La [auditoría del 13 de octubre de 2026](docs/AUDITORIA_2026-10-13.md) documenta las correcciones de cancelación, concurrencia, restauración y saturación, con 256 pruebas locales aprobadas. Su activación en producción sigue pendiente.

Durante mantenimiento, guarda la versión anterior y una copia de `data`, ejecuta `npm test`, registra los comandos con `npm run deploy` y reinicia una sola instancia con `npm run start`. Comprueba `/estado`, reproducción, Cola, historial, Siguiente y Detener. Si necesitas volver atrás, usa la versión anterior y su copia de datos: una versión antigua no entiende el freno nuevo aunque pueda leer la cola. La prueba prolongada en un servidor de Discord sigue siendo una comprobación de activación; las simulaciones locales no la sustituyen.

## Otras mejoras posibles

Ideas buenas para seguir mejorando el bot:

- `/lyrics`: buscar letra de la cancion actual.
- Filtros de audio como bass boost, nightcore o vaporwave.
- Mejorar la resolucion de Spotify/Apple Music para reducir resultados incorrectos.
- Guardar colas favoritas por servidor.

## Panel web privado

El dashboard **SONORA** usa Discord OAuth2 y sincronización REST/SSE para mostrar reproducción, progreso, cola y diagnósticos. Permite buscar música, reordenar canciones, cargar playlists completas y gestionar playlists y favoritos personales por servidor en SQLite. Comparte la instancia de DisTube y las protecciones del bot.

Para el arranque independiente con `npm run start`, el panel está **desactivado por defecto** (`WEB_ENABLED=false`) y escucha en `127.0.0.1:8080` al habilitarlo. `npm run dev` lo habilita en memoria para su backend hijo y sirve la interfaz en el puerto 5173.

`npm run dev` levanta ambas partes en una sola terminal. Consulta [configuración OAuth, variables, endpoints, migraciones y validación](docs/DASHBOARD.md). `.env.example` contiene valores de ejemplo sin secretos. `npm run dev:web` queda disponible únicamente para iniciar Vite de forma independiente; necesita un backend ya activo.

### Acceso y permisos

Hay dos políticas de acceso:

- `WEB_ACCESS_MODE=allowlist` — predeterminada; requiere `WEB_ALLOWED_USER_IDS` con los usuarios autorizados.
- `WEB_ACCESS_MODE=guild_members` — acceso dinámico por membresía; requiere `WEB_ALLOWED_GUILD_IDS` con los servidores autorizados donde está el bot, sin agregar manualmente cada usuario.

Ejemplo de membresía dinámica, además de las variables del bot y `WEB_CLIENT_SECRET`:

```env
WEB_ACCESS_MODE=guild_members
WEB_ALLOWED_GUILD_IDS=id_de_tu_servidor_discord
# Opcional: administradores explícitos del panel.
WEB_ADMIN_USER_IDS=tu_id_de_usuario_discord
```

El backend verifica membresía y permisos en cada servidor; salir de un servidor o perder acceso revoca también su conexión SSE.

| Rol | Permisos |
| --- | --- |
| `member` | Consultar estado y cola; gestionar sus playlists y favoritos. |
| `voice` | Añade controles de reproducción y cola cuando cumple los requisitos del canal de voz. |
| `admin` | Añade acceso a salud, incidentes y configuración; también necesita cumplir los requisitos de voz para controlar música. |

Los administradores se configuran mediante `WEB_ADMIN_USER_IDS`. En modo `allowlist`, si se omite, se conserva la lista de usuarios autorizados como administradores. La [guía del dashboard](docs/DASHBOARD.md) detalla las condiciones de cada rol, OAuth, CSRF y revocación.

### Frontend modular

React, TypeScript, Vite, Tailwind y componentes shadcn/ui se organizan por responsabilidades:

```text
frontend/src/
├── App.tsx       Composición y selección de vistas
├── components/   Layout, reproductor, cola y componentes compartidos
├── features/     Autenticación, dashboard, biblioteca, favoritos y diagnósticos
├── hooks/        Coordinación de aplicación y reproducción
├── lib/          Cliente HTTP, sincronización REST/SSE y utilidades
├── types/        Contratos de navegación y editor
├── main.tsx      Entrada de React
└── styles.css    Estilos compartidos
```

`useSonoraApp` coordina sesión, servidor y operaciones; `useSession`, `useLibrary` y `usePlayback` mantienen sus responsabilidades propias. El cliente HTTP centraliza CSRF y errores; la sincronización evita que respuestas REST antiguas sobrescriban eventos SSE recientes. La [refactorización modular](docs/FRONTEND_REFACTOR.md) documenta los límites, componentes y decisiones, conservando el diseño existente.

### Editor de biblioteca

- Los refrescos asíncronos conservan los borradores de creación, renombrado y canciones, además de una playlist de destino mientras siga disponible.
- Al pegar un enlace se consultan metadatos para completar título, artista y portada. Los metadatos automáticos pertenecen a la URL y apertura actuales del editor; las respuestas canceladas o tardías se descartan.
- Las ediciones manuales se conservan y no reinician la consulta de metadatos.
- Los contratos TypeScript exigen propietario para filas de playlist y lo prohíben para cola y favoritos.

Guardar durante la resolución sigue permitido sin reutilizar datos de otra canción. Con título manual pueden faltar duración y portada si la consulta aún no termina. Si el título está vacío, el backend resuelve la URL actual y puede completar también el artista. Las [correcciones del editor y sus pruebas](docs/LIBRARY_EDITOR_INVARIANTS.md) explican estas garantías y límites.

## Validación y pruebas

Desde la raíz:

```powershell
npm run build
npm test
npm run deploy:check
git diff --check
```

La validación del **16 de octubre de 2026** aprobó **565 pruebas: 409 backend y 156 frontend**. Se conserva la suite previa y se añaden 104 pruebas para letras, identidad, reloj y lifecycle inmersivo. El build comprueba contratos TypeScript; deploy:check valida los 19 comandos sin contactar Discord. Consulta el [informe inmersivo](docs/IMMERSIVE_PLAYER.md) y las [invariantes del editor](docs/LIBRARY_EDITOR_INVARIANTS.md).

Para ejecutar únicamente las pruebas montadas del editor:

```powershell
npm --prefix frontend test -- --run test/library-editor.test.tsx
```

Las pruebas montadas utilizan jsdom como dependencia de desarrollo. Las comprobaciones automáticas simulan los servicios externos; OAuth y voz reales se verifican en una instancia de pruebas de Discord. `deploy:check` valida los 19 comandos sin registrarlos ni iniciar el bot.

Para revisar la interfaz con música simulada y SQLite en memoria, después de compilar:

```powershell
node test/helpers/dashboard-preview.cjs
```

Abre `http://127.0.0.1:4175`. El fixture utiliza los puertos locales 4174/4175, no conecta el bot a Discord y se detiene con Ctrl+C.

## Scripts

| Script | Descripcion |
| --- | --- |
| `npm run dev` | Prepara y ejecuta bot, Fastify y React juntos; Ctrl+C cierra todo. |
| `npm run dev:check` | Valida configuración, dependencias y puertos sin instalar ni iniciar procesos. |
| `npm run dev:bot` | Ejecuta únicamente el bot con `ts-node`, como antes. |
| `npm run build` | Compila el bot a `dist` y React a `frontend/dist`. |
| `npm run build:bot` | Compila únicamente el bot. |
| `npm run build:web` | Comprueba tipos y contratos del frontend y genera su build de producción. |
| `npm run setup:web` | Instala las dependencias bloqueadas del frontend. |
| `npm run dev:web` | Inicia Vite local en el puerto 5173. |
| `npm run start` | Ejecuta la versión compilada con supervisor y reinicio automático. |
| `npm run start:once` | Ejecuta un solo proceso, para usar con un supervisor externo. |
| `npm run update:ytdlp` | Actualiza yt-dlp durante mantenimiento, con un límite de 60 segundos. |
| `npm test` | Compila el bot y ejecuta pruebas backend y frontend. |
| `npm run test:bot` | Compila y ejecuta únicamente las pruebas del bot y backend. |
| `npm run test:web` | Ejecuta únicamente las pruebas del frontend con Vitest. |
| `npm run deploy` | Registra comandos slash en el servidor configurado. |
| `npm run deploy:check` | Valida y muestra los comandos sin registrarlos ni iniciar el bot. |

Solo puede arrancar una instancia por `CLIENT_ID` en el mismo equipo. Una segunda copia sale con código 79 y el supervisor no la reinicia. La reserva se libera automáticamente al terminar el proceso. `npm run build` no recarga el bot activo: para aplicar cambios, detén su terminal con `Ctrl+C`, espera a que termine y vuelve a ejecutar `npm run start`.

## Notas

- Los errores de `/play`, `/search` y reproducción incluyen una causa, una sugerencia y un código de diagnóstico. Distinguen búsquedas vacías, restricciones de acceso o región, límites de solicitudes, fallos de red, voz y audio. El error completo se conserva en la consola.
- El código de FFmpeg `3436169992` en Windows equivale a HTTP 403: la fuente rechazó el acceso al audio. Se renueva el enlace y se intenta una alternativa dentro de los límites anteriores. No indica por sí solo que FFmpeg esté mal instalado. Los últimos mensajes de FFmpeg se conservan en memoria y se imprimen al fallar, con enlaces y cabeceras sensibles ocultos. Un mismo fallo activo no se registra de nuevo como error tardío.
- DisTube limita sus eventos a un listener por defecto. El bot usa un límite finito de diez porque reproducción, guardado de colas y desconexión automática comparten eventos; los avisos por superar ese límite siguen habilitados.
- Si cambias opciones de comandos slash, corre `npm run deploy` otra vez.
- Si una plataforma falla, revisa si `yt-dlp` soporta ese enlace.
- Para playlists grandes, la resolucion puede tardar porque cada cancion necesita buscar una fuente reproducible.


## Reproductor inmersivo
El botón **Abrir reproductor inmersivo** de la barra musical muestra una portada grande, controles y letras, sin interrumpir audio ni crear otra conexión SSE. En móvil puedes alternar Portada y Letras; Escape o Volver regresan al dashboard conservando su estado.

Las letras se consultan en el backend mediante LRCLIB, con autorización, matching conservador, límites y caché temporal en memoria. No necesita claves nuevas. Distingue letras sincronizadas, texto normal, instrumental, sin coincidencia y fallos temporales. El navegador estima posición entre snapshots; el audio sigue en Discord. El progreso web es informativo: los saltos con /seek en Discord se reflejan al recibir un nuevo snapshot.

La [arquitectura, evidencias y pruebas manuales](docs/IMMERSIVE_PLAYER.md) documentan los límites: no se midió sincronización audible real ni se promete ausencia de desfase. El [informe de LRCLIB](docs/LYRICS_PROVIDER.md) registra condiciones consultadas y política prudente de retención.
