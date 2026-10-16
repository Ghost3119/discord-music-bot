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

Configura una sola vez `.env` con los valores privados del bot, `WEB_CLIENT_SECRET` y la política de acceso deseada (`WEB_ACCESS_MODE=allowlist` con `WEB_ALLOWED_USER_IDS`, o `WEB_ACCESS_MODE=guild_members` con `WEB_ALLOWED_GUILD_IDS`). En la aplicación del [Discord Developer Portal](https://discord.com/developers/applications) registra exactamente **`http://127.0.0.1:5173/auth/discord/callback`** como OAuth2 redirect. No pegues los secretos en React ni en variables `VITE_*`.

Después, cada vez que quieras usar la app, basta un comando desde la raíz del repositorio:

```powershell
npm run dev
```

El lanzador valida primero las variables requeridas, instala dependencias faltantes, compila el bot y arranca su supervisor. Solo inicia Vite cuando Fastify confirma que ya escucha; muestra **http://127.0.0.1:5173** cuando la vista responde. **Ctrl+C detiene la vista, el backend y el bot.** Si uno termina, el lanzador cierra el conjunto. El supervisor conserva sus reinicios ante fallos del bot.

No necesitas cambiar manualmente `WEB_ENABLED`, `WEB_ORIGIN` ni `WEB_REDIRECT_URI` para este modo: se ajustan en memoria, solo para el backend hijo. Vite recibe el destino del proxy y variables básicas del sistema, sin tokens o secretos del bot. `WEB_PORT` controla el backend (8080) y `WEB_DEV_PORT` la vista (5173). Si cambias el segundo, registra también su nuevo callback en Discord. Se usan puertos fijos; no se cambia silenciosamente a otro puerto que invalide OAuth.

Para revisar sin iniciar el bot ni instalar dependencias, usa `npm run dev:check`. Un puerto ocupado se informa sin terminar el proceso que lo utiliza. Cierra la terminal de Vite o del bot anterior antes de volver a arrancar. Abrir solamente `dev:web` con el backend apagado produce los errores de proxy HTTP 500 vistos en `/api/session` y `/auth/discord`.

En modo estático por lista de usuarios (`allowlist`, predeterminado para compatibilidad):

```env
WEB_CLIENT_SECRET=secreto_oauth2_de_tu_aplicacion_discord
WEB_ACCESS_MODE=allowlist
WEB_ALLOWED_USER_IDS=tu_id_de_usuario_discord
```

En modo dinámico por membresía de servidor (`guild_members`, sin necesidad de agregar cada usuario manualmente):

```env
WEB_CLIENT_SECRET=secreto_oauth2_de_tu_aplicacion_discord
WEB_ACCESS_MODE=guild_members
WEB_ALLOWED_GUILD_IDS=id_de_tu_servidor_discord
WEB_ADMIN_USER_IDS=tu_id_de_usuario_admin_opcional
```

`WEB_CLIENT_SECRET` es el **Client Secret** de OAuth2, distinto del token del bot. `WEB_ALLOWED_USER_IDS` contiene IDs de personas autorizadas y `WEB_ALLOWED_GUILD_IDS` contiene IDs de servidores de Discord donde está el bot. Conserva los valores reales únicamente en `.env`.

El flujo usa un cliente confidencial con `client_secret`, el scope `identify` y `state` aleatorio ligado a una cookie de un solo uso. No se guardan access/refresh tokens ni se descargan listas completas de miembros del servidor. Discord documenta este flujo en su [referencia de OAuth2](https://docs.discord.com/developers/topics/oauth2); no se presupone soporte PKCE en el flujo confidencial documentado.

**Versión compilada, como alternativa:** instala con `npm ci` y `npm run setup:web`, compila con `npm run build`, configura `WEB_ENABLED=true`, `WEB_ORIGIN=http://127.0.0.1:8080` y su callback en `.env`/Discord, e inicia **una sola instancia** con `npm run start`. Fastify sirve `frontend/dist` en el puerto 8080 y aplica migraciones al abrir SQLite. Este modo conserva el supervisor anterior y no ejecuta Vite. El build por sí solo no reinicia el bot.

`npm run dev:bot` y `npm run dev:web` permanecen como herramientas independientes para usos avanzados. Para el flujo habitual utiliza `npm run dev`. La vista tiene recarga automática; después de cambiar código TypeScript del bot, detén el conjunto y vuelve a ejecutar el mismo comando. Abre siempre el host exacto configurado; `localhost` y `127.0.0.1` son orígenes diferentes.

## Variables

| Variable | Predeterminado / propósito |
| --- | --- |
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | Configuración existente del bot; solo backend. |
| `WEB_ENABLED` | `false` para el bot independiente; `npm run dev` lo habilita para su proceso hijo. |
| `WEB_HOST` | `127.0.0.1`; escucha local. |
| `WEB_PORT` | `8080`. |
| `WEB_DEV_PORT` | `5173`; puerto de Vite con el lanzador único. |
| `WEB_ORIGIN` | `http://127.0.0.1:8080`; origen público exacto para cookies y CSRF. |
| `WEB_CLIENT_ID` | Opcional; utiliza `CLIENT_ID` si no se define. |
| `WEB_CLIENT_SECRET` | Secreto OAuth2 de la aplicación de Discord. |
| `WEB_REDIRECT_URI` | `${WEB_ORIGIN}/auth/discord/callback`. |
| `WEB_ACCESS_MODE` | `allowlist` (predeterminado) o `guild_members` (autorización dinámica por membresía en servidores autorizados). |
| `WEB_ALLOWED_USER_IDS` | IDs de usuario de Discord separados por comas; obligatorio cuando `WEB_ACCESS_MODE=allowlist`. |
| `WEB_ALLOWED_GUILD_IDS` | IDs de servidores de Discord separados por comas; obligatorio cuando `WEB_ACCESS_MODE=guild_members` (y filtro opcional en `allowlist`). |
| `WEB_ADMIN_USER_IDS` | IDs de usuarios administradores explícitos con acceso a diagnóstico y configuración. En `allowlist`, si se omite, conserva `WEB_ALLOWED_USER_IDS`. |
| `WEB_MEMBERSHIP_CACHE_TTL_MS` | `5000`; caché breve en memoria (0–60000 ms) de membresía verificada, con invalidación inmediata ante expulsiones/salidas. |
| `WEB_DATABASE_PATH` | `data/dashboard.sqlite`. |
| `WEB_SESSION_TTL_HOURS` | `168`; expiración absoluta, máximo 30 días. |

Fuera de localhost se exige un origen HTTPS y cookies Secure. Si se utiliza un proxy inverso, termina TLS y reenvía al listener local. No se habilita CORS ni se confía en roles o canales enviados por React. Cada consulta de servidor comprueba membresía; cada control comprueba voz y sesión también después de esperar el bloqueo. Los secretos nunca tienen prefijo `VITE_`.

## Roles y permisos en el servidor

La autorización se aplica íntegramente en el backend (`server.ts` y `webBridge.ts`):

| Tipo de usuario | Condición verificada en el servidor | Permisos que puede ejercer |
| --- | --- | --- |
| **Miembro (`member`)** | Pertenece a un servidor autorizado donde está el bot (y pasa la política `allowlist` o `guild_members`). | Iniciar/cerrar sesión, listar únicamente los servidores autorizados a los que pertenece, leer el estado y la cola de reproducción (`GET /state` y SSE `/events` sin datos internos de diagnóstico) y gestionar su biblioteca personal (playlists y favoritos propios) en ese servidor. |
| **Usuario en canal de voz (`voice`)** | Es miembro del servidor autorizado y está conectado al mismo canal de voz que el bot (o a un canal de voz con permisos `ViewChannel`, `Connect` y `Speak` si el bot está inactivo). | Todos los permisos de **Miembro**, más controles de reproducción y cola (`play`, `pause`, `resume`, `skip`, `stop`, `volume`, `repeat`, `shuffle`, `remove`, `move` y carga de playlists en la cola), revalidados antes y después del bloqueo nativo. |
| **Administrador explícito (`admin`)** | Su Discord User ID figura en `WEB_ADMIN_USER_IDS` (y es miembro del servidor consultado). | Todos los permisos de **Miembro** (y de **voz** cuando está en el canal de voz del bot), más acceso a métricas de salud e incidentes de diagnóstico (`health`, `incidents`, `GET /api/guilds/:guildId/diagnostics`) y consulta de configuración (`GET /api/config`). |

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
| `GET /auth/discord` | Inicio OAuth (`scope=identify`) y cookie de state. |
| `GET /auth/discord/callback` | Intercambio del código, verificación de `allowlist` o membresía en `WEB_ALLOWED_GUILD_IDS` y creación de sesión. |
| `POST /auth/logout` | Revoca la sesión y elimina cookie. |
| `GET /api/session` | Perfil, token CSRF, modo de acceso y rol de la sesión. |
| `GET /api/config` | Configuración no sensible del panel (solo administrador explícito). |
| `GET /api/guilds` | Servidores autorizados del bot a los que pertenece el usuario. |
| `GET /api/guilds/:guildId/permissions` | Permisos efectivos del usuario en ese servidor (`member`, `voice`, `admin`). |
| `GET /api/guilds/:guildId/diagnostics` | Salud del motor e incidentes del servidor (solo administrador explícito). |
| `GET /api/guilds/:guildId/state` | Canción, pendientes, progreso, volumen, voz, permisos y (solo para administradores) diagnóstico. |
| `GET /api/guilds/:guildId/events` | SSE `state`, snapshot inicial y actualizaciones con revocación en vivo. |
| `POST /api/guilds/:guildId/actions` | Play, pause, resume, skip, stop, volume, shuffle, repeat, remove y move (requiere estar en el canal de voz). |
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

SSE publica snapshots iniciales y aproximadamente cada dos segundos, con reconexión y sincronización REST. Hay hasta cuatro conexiones por usuario y 128 globales, con reservas durante la apertura y cierre por backpressure. Las sesiones o permisos revocados cierran el stream y el cliente retira su estado. La comprobación de membresía usa Discord REST con una caché breve y segura (`WEB_MEMBERSHIP_CACHE_TTL_MS`, 5 s por defecto) que evita duplicar consultas durante lecturas y SSE, se invalida al instante ante eventos `guildMemberRemove` / `guildDelete` o controles fallidos y siempre exige verificación directa en Discord para mutaciones de reproducción. Cualquier fallo de Discord REST deniega el acceso (fail-closed).

Las pruebas automáticas no autentican una cuenta real ni conectan el bot a Discord. Antes de activar en tu servidor de pruebas, comprueba login/logout y expiración, usuario fuera de allowlist, dos servidores, cambio de canal durante un control, reproducción real y fallback de fuentes, SSE tras corte de red, reinicio con SQLite/checkpoint y una cola bloqueada. Configurar OAuth y ejecutar estos casos requiere tus credenciales privadas; no se modifican durante el desarrollo.

No se ha iniciado ni reiniciado el bot de producción, registrado comandos, publicado Git ni desplegado el panel. Guarda `data` al actualizar. Para volver atrás, desactiva `WEB_ENABLED` y utiliza el commit anterior con el respaldo de datos descrito en `OPERACION.md`.

## Validación ejecutada

Resultado del 15 de octubre de 2026, Windows y Node.js 24.14.0:

| Comprobación | Resultado real |
| --- | --- |
| Baseline antes de modificar | 302 pruebas originales aprobadas. |
| `npm run build` | Bot TypeScript y frontend Vite compilados, código 0. |
| `npm test` | **378 pruebas bot/backend + 12 frontend = 390 aprobadas**, sin fallos, cancelaciones ni omisiones. |
| `npm run deploy:check` | 19 comandos válidos, código 0; sin registro ni conexión a Discord. |
| `npm audit` | 0 vulnerabilidades. |
| `npm audit --prefix frontend` | 0 vulnerabilidades. |
| `git diff --check` | Sin errores de whitespace. |
| Bundle React | Sin referencias a `DISCORD_TOKEN`, `WEB_CLIENT_SECRET` ni `SPOTIFY_CLIENT_SECRET`. |

La huella de comandos permanece `3e86b2114dfce87c089fca414acbc597b3b22810bbb4f0273e3d576e927d168f`. Se añadieron pruebas para `WEB_ACCESS_MODE=guild_members` y compatibilidad con `allowlist`, filtrado por `WEB_ALLOWED_GUILD_IDS`, caché breve de membresía con invalidación por eventos y fallos de Discord REST, cierre de SSE al abandonar un servidor, permisos diferenciados entre servidores y separación de roles (`member`, `voice`, `admin`).

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
