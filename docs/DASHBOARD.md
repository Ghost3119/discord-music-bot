# Discord Music Dashboard

El panel privado vive dentro del proceso del bot. React consulta REST y recibe snapshots por SSE; `MusicBridge` proyecta el estado de la única instancia de DisTube. Las operaciones web comparten búsquedas, bloqueos, validación de voz, cancelaciones y checkpoints con Discord. Supervisor, watchdog, circuit breaker, historial y precarga permanecen activos.

## Estructura

```text
frontend/                 React + TypeScript + Vite + Tailwind + componentes shadcn
src/web/contracts.ts      DTO públicos, sin recursos ni credenciales de Discord
src/web/config.ts         Configuración opt-in y validación de origen
src/web/server.ts         Fastify, OAuth, sesiones, CSRF, REST, SSE y estáticos
src/web/schema.ts         Esquema Drizzle
src/web/database.ts       Repositorios SQLite y migraciones
src/music/webBridge.ts    Autorización y adaptador al reproductor existente
src/music/playbackRequest.ts  Entrada compartida de reproducción
src/music/controlAccess.ts    Revalidación dentro del bloqueo nativo
src/runtime/webDashboard.ts   Arranque y cierre aislados del servidor
migrations/0001_dashboard.sql Migración versionada inicial
test/                     Pruebas del bot y backend
frontend/test/            Pruebas del cliente
```

## Instalación y ejecución local

Requiere Node.js **22.12 o superior**, npm y las dependencias existentes del bot. `better-sqlite3` utiliza un módulo nativo: ejecuta `npm ci` con la versión de Node que vayas a usar para arrancar. Si no hay un binario precompilado para tu plataforma, su instalador necesitará herramientas de compilación nativas.

```powershell
cd C:\Users\picud\Repos\discord-music-bot
git switch feat/discord-music-dashboard
npm ci
npm run setup:web
npm run build
npm test
npm run deploy:check
```

Conserva tu `.env` existente y añade las variables web tomando `.env.example` como referencia. En la aplicación del [Discord Developer Portal](https://discord.com/developers/applications) registra exactamente `http://127.0.0.1:8080/auth/discord/callback` como OAuth2 redirect. Configura `WEB_CLIENT_SECRET` y los IDs de usuarios permitidos, y establece `WEB_ENABLED=true` cuando vayas a activar el panel.

El flujo usa un cliente confidencial con `client_secret`, el scope `identify` y `state` aleatorio ligado a una cookie de un solo uso. No se guardan access/refresh tokens. Discord documenta este flujo en su [referencia de OAuth2](https://docs.discord.com/developers/topics/oauth2); no se presupone soporte PKCE en el flujo confidencial documentado.

Para usar el frontend compilado, inicia **una sola instancia del bot** con `npm run start` y abre `http://127.0.0.1:8080`. El servidor sirve `frontend/dist` y aplica migraciones al abrir SQLite. El build por sí solo no reinicia el bot ni activa el panel.

Para desarrollar React, configura `WEB_ORIGIN=http://127.0.0.1:5173` y `WEB_REDIRECT_URI=http://127.0.0.1:5173/auth/discord/callback`; registra también ese redirect en Discord. Ejecuta el bot de pruebas en una terminal y `npm run dev:web` en otra. Vite reenvía `/api` y `/auth` al puerto 8080 conservando el origen. Abre siempre el host exacto configurado; `localhost` y `127.0.0.1` son orígenes diferentes.

## Variables

| Variable | Predeterminado / propósito |
| --- | --- |
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | Configuración existente del bot; solo backend. |
| `WEB_ENABLED` | `false`; no abre HTTP ni SQLite hasta habilitarlo. |
| `WEB_HOST` | `127.0.0.1`; escucha local. |
| `WEB_PORT` | `8080`. |
| `WEB_ORIGIN` | `http://127.0.0.1:8080`; origen público exacto para cookies y CSRF. |
| `WEB_CLIENT_ID` | Opcional; utiliza `CLIENT_ID` si no se define. |
| `WEB_CLIENT_SECRET` | Secreto OAuth2 de la aplicación de Discord. |
| `WEB_REDIRECT_URI` | `${WEB_ORIGIN}/auth/discord/callback`. |
| `WEB_ALLOWED_USER_IDS` | IDs de Discord separados por comas; lista obligatoria al habilitar. |
| `WEB_DATABASE_PATH` | `data/dashboard.sqlite`. |
| `WEB_SESSION_TTL_HOURS` | `168`; expiración absoluta, máximo 30 días. |

Fuera de localhost se exige un origen HTTPS y cookies Secure. Si se utiliza un proxy inverso, termina TLS y reenvía al listener local. No se habilita CORS ni se confía en roles o canales enviados por React. Cada consulta de servidor comprueba membresía; cada control comprueba voz y sesión también después de esperar el bloqueo. Los secretos nunca tienen prefijo `VITE_`.

## Persistencia

SQLite usa integridad referencial, WAL, transacciones cortas y migración versionada `0001_dashboard.sql`, aplicada automáticamente una sola vez. Los IDs Discord son TEXT.

| Tabla | Contenido |
| --- | --- |
| `users` | ID, nombre y avatar público del usuario. |
| `web_sessions` | Hash de token y CSRF, propietario, creación y expiración. |
| `guild_settings` | Servidor conocido por la biblioteca. |
| `playlists` | Nombre, propietario y servidor. |
| `playlist_tracks` | Fuente, URL pública, título, artista, duración, portada y posición. |
| `favorites` | Canciones favoritas por propietario y servidor, sin duplicados por URL. |
| `web_migrations` | Registro de versiones aplicadas. |

El reordenamiento exige todos los IDs exactamente una vez y cambia posiciones dentro de una transacción. Borrar una playlist elimina sus pistas por FK. La biblioteca acepta enlaces públicos de origen admitidos y rechaza URLs temporales de streaming. No se migran `data/queues.json` ni `data/history.json`.

## Endpoints

| Método y ruta | Resultado |
| --- | --- |
| `GET /auth/discord` | Inicio OAuth y cookie de state. |
| `GET /auth/discord/callback` | Intercambio del código, allowlist y sesión. |
| `POST /auth/logout` | Revoca la sesión y elimina cookie. |
| `GET /api/session` | Perfil y token CSRF de la sesión. |
| `GET /api/guilds` | Servidores del bot accesibles al usuario. |
| `GET /api/guilds/:guildId/state` | Canción, pendientes, progreso, volumen, voz y diagnóstico reales. |
| `GET /api/guilds/:guildId/events` | SSE `state`, snapshot inicial y actualizaciones. |
| `POST /api/guilds/:guildId/actions` | Play, pause, resume, skip, stop, volume, shuffle, repeat, remove y move. |
| `GET/POST /api/guilds/:guildId/playlists` | Listar/crear playlists propias. |
| `PATCH/DELETE /api/guilds/:guildId/playlists/:playlistId` | Renombrar/eliminar. |
| `POST /api/guilds/:guildId/playlists/:playlistId/tracks` | Añadir metadatos de una canción. |
| `DELETE /api/guilds/:guildId/playlists/:playlistId/tracks/:trackId` | Retirar pista. |
| `PUT /api/guilds/:guildId/playlists/:playlistId/tracks/order` | Orden transaccional mediante `trackIds`. |
| `POST /api/guilds/:guildId/playlists/:playlistId/load` | Cargar URLs de origen en la cola con autorización por pista. |
| `GET/POST /api/guilds/:guildId/favorites` | Listar/guardar favoritos propios. |
| `DELETE /api/guilds/:guildId/favorites/:trackId` | Eliminar favorito. |

Todas las mutaciones autenticadas requieren `x-csrf-token` y el origen configurado. Las acciones reciben `{action, query?, volume?, mode?, index?, from?, to?}`. `queue` contiene solo pendientes: remove/move usan posiciones desde **1**, igual que Discord; repeat usa 0=off, 1=canción, 2=cola. Los errores HTTP se presentan de forma controlada y no terminan la reproducción.

## Límites y comprobaciones manuales

La biblioteca admite hasta 100 playlists por usuario/servidor, 500 pistas por playlist y 1000 favoritos. Una carga admite entre 1 y 50 pistas, en orden. Si se cancela, falla una fuente o cambia la sesión, se detiene la carga; las pistas ya incorporadas permanecen en la cola. Detener entre pistas impide que la carga recree la sesión.

SSE publica snapshots iniciales y aproximadamente cada dos segundos, con reconexión y sincronización REST. Hay hasta cuatro conexiones por usuario y 128 globales, con reservas durante la apertura y cierre por backpressure. Las sesiones o permisos revocados cierran el stream y el cliente retira su estado. La comprobación de membresía usa Discord REST; un error de Discord deniega acceso y la latencia puede retrasar una actualización. Actualmente se realizan dos comprobaciones de membresía por actualización SSE; reducir esa duplicación queda como optimización posible.

Las pruebas automáticas no autentican una cuenta real ni conectan el bot a Discord. Antes de activar en tu servidor de pruebas, comprueba login/logout y expiración, usuario fuera de allowlist, dos servidores, cambio de canal durante un control, reproducción real y fallback de fuentes, SSE tras corte de red, reinicio con SQLite/checkpoint y una cola bloqueada. Configurar OAuth y ejecutar estos casos requiere tus credenciales privadas; no se modifican durante el desarrollo.

No se ha iniciado ni reiniciado el bot de producción, registrado comandos, publicado Git ni desplegado el panel. Guarda `data` al actualizar. Para volver atrás, desactiva `WEB_ENABLED` y utiliza el commit anterior con el respaldo de datos descrito en `OPERACION.md`.

## Validación ejecutada

Resultado del 15 de octubre de 2026, Windows y Node.js 24.14.0:

| Comprobación | Resultado real |
| --- | --- |
| Baseline antes de modificar | 302 pruebas originales aprobadas. |
| `npm run build` | Bot TypeScript y frontend Vite compilados, código 0. |
| `npm test` | **355 pruebas bot/backend + 12 frontend = 367 aprobadas**, sin fallos, cancelaciones ni omisiones. |
| `npm run deploy:check` | 19 comandos válidos, código 0; sin registro ni conexión a Discord. |
| `npm audit` | 0 vulnerabilidades. |
| `npm audit --prefix frontend` | 0 vulnerabilidades. |
| `git diff --check` | Sin errores de whitespace. |
| Bundle React | Sin referencias a `DISCORD_TOKEN`, `WEB_CLIENT_SECRET` ni `SPOTIFY_CLIENT_SECRET`. |

La huella de comandos permanece `3e86b2114dfce87c089fca414acbc597b3b22810bbb4f0273e3d576e927d168f`. Se añadieron 53 pruebas backend y 12 frontend. Las nuevas pruebas cubren OAuth state/replay/allowlist/CSRF/rate limit, sesiones y SQLite persistentes, aislamiento entre usuarios y servidores, restricciones de voz tras esperas, concurrencia Discord/web con el bloqueo nativo real, búsqueda/extracción/autoplay tardíos, cancelación durante conexión de voz, protección de una cola sucesora, Stop entre pistas de una carga, SSE y cierre HTTP, reordenamiento transaccional y respuestas antiguas del cliente. El runtime mínimo 22.12 se declara en ambos paquetes; esta ejecución se realizó en Node 24.14.0, no en cada versión soportada.

## Interfaz comprobada

La revisión en navegador utilizó el servidor real Fastify, endpoints REST/SSE reales, SQLite en memoria y un adaptador musical simulado mediante `test/helpers/dashboard-preview.cjs`. No hubo conexión a Discord. El fixture solo se ejecuta explícitamente, no forma parte del arranque del bot ni de la interfaz normal.

Se verificaron pausa/reanudación, creación de playlist, reordenamiento y persistencia tras recargar la página, favoritos, búsqueda desde móvil, cambio de volumen, navegación, diagnóstico y logout. Se inspeccionaron escritorio 1440×1000 y móvil 390×844; el móvil no presentó desbordamiento horizontal. La navegación cerrada se retira del árbol accesible y los controles por icono conservan su nombre. No se capturaron errores ni advertencias en la consola del navegador. El fixture se detuvo al terminar la revisión.

Capturas **con datos simulados de QA**, no evidencia de reproducción real:

- [Reproductor en escritorio](screenshots/dashboard-desktop.jpg).
- [Reproductor en móvil](screenshots/dashboard-mobile.jpg).
- [Biblioteca](screenshots/dashboard-library.jpg).
- [Diagnóstico](screenshots/dashboard-diagnostics.jpg).
- [Inicio de sesión](screenshots/dashboard-login.jpg).

Para repetir la revisión aislada después de compilar, ejecuta `node test/helpers/dashboard-preview.cjs` y abre `http://127.0.0.1:4175`. Usa exclusivamente memoria y los puertos locales 4174/4175. Detén el fixture con Ctrl+C; la música y los metadatos son deliberadamente simulados.

## Archivos y commits

La lista exacta de archivos añadidos/modificados respecto de `main` está en [DASHBOARD_CHANGED_FILES.txt](DASHBOARD_CHANGED_FILES.txt). Los cambios están separados en commits locales: verificación inicial, infraestructura y biblioteca, operaciones musicales compartidas, interfaz y documentación/validación. Ninguno se publicó a un remoto.
