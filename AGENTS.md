# SONORA — instrucciones para agentes

SONORA es el panel web privado de un bot musical de Discord: reproductor, cola,
biblioteca, favoritos y modo inmersivo con letras. El audio se reproduce en Discord.
Stack confirmado: Node.js >=22.12, TypeScript, Discord.js, DisTube, Fastify,
React 19, Vite, Tailwind, SQLite (better-sqlite3 + Drizzle), REST/SSE, FFmpeg y yt-dlp.

## Trabajo eficiente

- Lee primero este archivo y selecciona el área de la tabla; consulta únicamente
  las secciones pertinentes de las guías enlazadas, no toda la documentación.
- Busca símbolos con `rg -n` sobre rutas concretas antes de abrir archivos completos.
  No explores globalmente por defecto ni releas archivos sin nueva evidencia.
  Excluye node_modules, dist, .git, logs, capturas y artefactos de las búsquedas.
- Para un cambio pequeño usa `targeted-patch`: empieza con 1–3 archivos como guía,
  implementa en cuanto comprendas el contrato y valida el cambio mínimo correcto.
  Mantén el dominio solicitado; evita refactorizaciones y planes extensos triviales.
- Un cambio pequeño normalmente requiere un agente. Uno mediano: investigación breve,
  implementación y validación. Uno grande: plan y responsabilidades separadas;
  subagentes solo si aportan valor y están autorizados. Uno crítico: revisa invariantes,
  seguridad, concurrencia y regresiones, aunque el diff sea pequeño.
- Ejecuta pruebas específicas antes de generales. Amplía la investigación cuando haya
  evidencia técnica y comunica el motivo si necesitas ampliar el alcance solicitado.
  Estas preferencias no justifican omitir una validación necesaria.

## Mapa rápido: dónde empezar

| Tarea | Rutas principales / referencia condicional |
| --- | --- |
| Reproductor inmersivo | `frontend/src/features/immersive/ImmersivePlayer.tsx`, `frontend/src/components/player/PlayerExperience.tsx`; `docs/IMMERSIVE_PLAYER.md` |
| Fondos de álbum | `frontend/src/features/immersive/AmbientBackground.tsx`, `frontend/src/features/immersive/use-artwork-palette.ts`, `frontend/src/features/immersive/immersive.css` |
| Estilo de letras | `frontend/src/features/lyrics/LyricsPanel.tsx`, `frontend/src/features/lyrics/LyricsLine.tsx`, `frontend/src/features/immersive/immersive.css` |
| Sincronización LRC | `frontend/src/features/lyrics/playback-clock.ts`, `frontend/src/features/lyrics/use-lyrics-clock.ts`, `src/web/lyrics/lrc.ts`; contratos en `src/web/lyrics/contracts.ts` y `src/web/contracts.ts` |
| Consulta de letras | `frontend/src/features/lyrics/use-lyrics.ts`, `src/web/lyrics/service.ts`, `src/web/lyrics/matching.ts`; `docs/LYRICS_PROVIDER.md` |
| Biblioteca y playlists | `frontend/src/features/library/`, `frontend/src/components/queue/TrackList.tsx`; `docs/LIBRARY_EDITOR_INVARIANTS.md` |
| OAuth2, sesiones, roles, CSRF | `src/web/server.ts`, `src/web/config.ts`, `src/music/controlAccess.ts`, `src/music/webBridge.ts`, `frontend/src/features/auth/`; `docs/DASHBOARD.md` |
| Backend web / REST / SSE | `src/web/server.ts`, `src/web/contracts.ts`, `src/runtime/webDashboard.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/playback-stream.ts` |
| Motor musical / recuperación | `src/music/distube.ts`, `src/music/events.ts`, `src/music/playbackRequest.ts`, `src/music/queueActions.ts`, `src/music/playbackRecovery.ts`, `src/music/queueRecovery.ts` |
| Smart Audio Preloader | `src/music/audioPreloader.ts`, `src/music/prebufferedStream.ts`; `test/audioPreloader.test.js`, `test/preloaderSupervisor.test.js` |
| Persistencia | `src/web/database.ts`, `src/web/schema.ts`, `migrations/`, `src/music/queueRecovery.ts` (checkpoints), `src/music/history.ts` |
| Composición y estado del cliente | `frontend/src/App.tsx`, `frontend/src/hooks/use-sonora-app.ts`, `frontend/src/hooks/use-playback.ts` |
| Pruebas | `test/` (Node, backend), `frontend/test/` (Vitest/React y contratos typecheck) |

## Invariantes que conservar

- OAuth2, sesiones, roles, membresía y CSRF se validan en backend; React no concede
  permisos. Conserva la revalidación después de esperas/bloqueos y la separación de secretos.
- Las operaciones web y Discord comparten motor y orden de cola. Conserva cancelaciones,
  descarte de respuestas obsoletas, precarga, checkpoints y recuperación.
- Mantén una sola conexión SSE y el orden/identidad de snapshots. El modo inmersivo
  no recrea el dashboard ni añade reproducción de audio en el navegador.
- En biblioteca conserva borradores manuales, incluso vacíos, y vincula metadatos a
  URL/editor vigentes. En letras conserva identidad, reloj y cancelación compartida.
- No leas ni edites `.env` con secretos por rutina; no expongas tokens en cliente o logs.
  No borres datos, ejecutes migraciones destructivas ni realices otras acciones destructivas
  sin autorización explícita.

## Validación desde la raíz

Scripts contrastados con ambos package.json; elige según el cambio (no ejecutarlos todos por rutina):

| Comando | Uso |
| --- | --- |
| `npm --prefix frontend test -- test/library-editor.test.tsx` | Ejemplo de prueba focalizada; sustituye por el archivo pertinente de frontend/test |
| `npm run build:bot` y luego `node --test test/audioPreloader.test.js` | Ejemplo backend focalizado; compila antes y selecciona su prueba |
| `npm run test:web` / `npm run test:bot` | Suite del dominio |
| `npm run build:web` | TypeScript sin emitir + Vite; incluye contratos typecheck del frontend |
| `npm run build` / `npm test` | Validación general cuando el alcance lo justifique |
| `git diff --check` | Errores de whitespace; documentación sola no requiere suite musical |

No hay script lint en los package.json actuales. Build no arranca el bot.
No ejecutes start, dev, deploy ni reinicios como comprobación rutinaria.

## Git y skills

Revisa status, rama y diff antes/después; conserva cambios ajenos y añade al commit
solo tus archivos. Crea una rama nueva cuando el usuario lo solicite.
No hagas push, merge ni despliegue sin autorización explícita; tampoco alteres producción.

`targeted-patch` vive en `.agents/skills/targeted-patch/SKILL.md`.
La skill global `frontend-design` se conserva en `C:\Users\picud\.agents\skills\frontend-design\SKILL.md`:
úsala para nuevas interfaces, cambios visuales sustanciales, componentes complejos,
animaciones y responsive. Para retoques pequeños evalúa si bastan las convenciones
existentes. Puedes combinar ambas; no copies ni reinstales la global.
Las pasadas y delegaciones narradas en documentos históricos no son requisitos para cada parche.
Compatibilidad, invocación y ejemplos: `docs/AGENT_WORKFLOWS.md`.
