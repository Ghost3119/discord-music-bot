# SONORA — Refactorización modular del frontend

Fecha: 15 de octubre de 2026, America/Mexico_City.

La refactorización conserva la presentación y los contratos existentes. `App.tsx` compone módulos con responsabilidades explícitas; la sesión, la biblioteca y las operaciones viven en hooks. La compilación, las 435 pruebas y las comprobaciones locales terminaron correctamente.

## 1. Estado inicial y Git

- Base: `main`, commit `91a21e0`, coincidente con la referencia local `origin/main` al comenzar.
- El árbol de trabajo estaba limpio: no hubo cambios del usuario que guardar o sobrescribir.
- Se inspeccionaron estado, rama, ramas disponibles y ocho commits recientes antes de editar.
- Se comprobó que `191ece4` (membresía dinámica y roles) y `007a56c` (playlists completas, metadata y selector) fueran ancestros de la base. El baseline funcional pasó antes de modificar fuentes.
- Rama creada antes de cualquier modificación: `refactor/sonora-frontend-modular`.
- Todos los commits son locales. No se hizo push, merge, despliegue ni reinicio del bot de producción.

## 2. Arquitectura anterior

`frontend/src` tenía 12 archivos. `App.tsx` concentraba 569 líneas físicas y declaraba diez componentes, incluido `App`. Dentro de `App` había 29 estados y ocho efectos, además de sesión, selección de servidor, biblioteca, favoritos, edición de playlists, búsqueda, operaciones HTTP, volumen, navegación y todas las vistas.

Los límites que ya funcionaban eran `api`, `playback-stream`, `operation-scope`, `health`, `utils`, `usePlayback`, `Artwork`, `Button` y `Dialog`. Se conservaron.

## 3. Arquitectura nueva y árbol final

Se mantuvo la entrada `src/App.tsx` y el import existente de `main.tsx`: una carpeta `app/` con un único archivo no aportaba un límite adicional. No hay carpetas vacías, router, store global ni providers nuevos.

```text
frontend/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── components/
│   │   ├── artwork.tsx
│   │   ├── common/
│   │   │   ├── Brand.tsx
│   │   │   ├── CustomSelect.tsx
│   │   │   ├── IconButton.tsx
│   │   │   └── StateFeedback.tsx
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── PageHeading.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── player/
│   │   │   ├── MobilePlaybackTools.tsx
│   │   │   ├── NowPlaying.tsx
│   │   │   └── PlayerBar.tsx
│   │   ├── queue/
│   │   │   └── TrackList.tsx
│   │   └── ui/
│   │       ├── button.tsx
│   │       └── dialog.tsx
│   ├── features/
│   │   ├── auth/
│   │   │   ├── Login.tsx
│   │   │   ├── UserAvatar.tsx
│   │   │   └── use-session.ts
│   │   ├── dashboard/
│   │   │   └── PlayerView.tsx
│   │   ├── diagnostics/
│   │   │   └── DiagnosticsView.tsx
│   │   ├── favorites/
│   │   │   └── FavoritesView.tsx
│   │   └── library/
│   │       ├── LibraryDialog.tsx
│   │       ├── LibraryView.tsx
│   │       └── use-library.ts
│   ├── hooks/
│   │   ├── use-playback.ts
│   │   └── use-sonora-app.ts
│   ├── lib/
│   │   ├── api.ts
│   │   ├── health.ts
│   │   ├── operation-scope.ts
│   │   ├── playback-stream.ts
│   │   └── utils.ts
│   └── types/
│       └── app.ts
└── test/
    ├── api.test.ts
    ├── app-regression.test.tsx
    ├── components-regression.test.tsx
    ├── controller-regression.test.ts
    ├── operation-scope.test.ts
    ├── playback-stream.test.ts
    └── regression-fixtures.ts
```

`src` termina con 34 archivos: 33 módulos TypeScript/TSX y la hoja CSS. La revisión de 98 dependencias locales, incluidas las importaciones de tipos, encontró cero ciclos.

## 4. Componentes extraídos

| Dominio | Componentes públicos de los módulos nuevos |
| --- | --- |
| Compartidos | `Brand`, `IconButton`, `CustomSelect`, `Loading`, `EmptyState` |
| Autenticación | `Login`, `UserAvatar` |
| Layout | `Sidebar`, `Header`, `PageHeading` |
| Reproducción | `NowPlaying`, `PlayerBar`, `MobilePlaybackTools` |
| Filas y cola | `TrackList`, `TrackItem`, `QueueSection` |
| Vistas | `PlayerView`, `LibraryView`, `FavoritesView`, `DiagnosticsView` |
| Edición | `LibraryDialog` |

Son **21 componentes públicos en 18 archivos nuevos**: ocho corresponden a componentes anteriores trasladados o renombrados y trece a responsabilidades separadas de la implementación original. `DiscordIcon` continúa como componente privado dentro de `Login`. `App`, `Artwork`, `Button` y `Dialog` no se cuentan como componentes nuevos.

`TrackList` sirve a cola, playlists y favoritos. `Loading` y `EmptyState` comparten archivo; `TrackItem` y `QueueSection` viven junto a la lista. El progreso permanece en `PlayerBar`, evitando componentes que solo añadirían un nivel de indirección.

Las props tienen interfaces explícitas. `PlaybackBindings`, `TrackActions` y los bindings de biblioteca/diálogo agrupan los contratos de cada dominio. Los componentes de presentación no invocan endpoints.

## 5. Hooks y estado

| Hook | Responsabilidad |
| --- | --- |
| `useSession` — nuevo | Sesión, reintento de autenticación, servidores autorizados, 401 y logout completado. |
| `useLibrary` — nuevo | Carga y refresco de playlists/favoritos, CRUD, selección, modal, campos y resolución abortable de metadata. |
| `useSonoraApp` — nuevo | Coordinación, operaciones ocupadas, invalidación del scope, errores/notificaciones, logout prioritario, búsqueda, acciones musicales y volumen compartido. |
| `usePlayback` — reutilizado sin cambios | Conexión REST/SSE por servidor, limpieza y resincronización. |

Hay **tres hooks nuevos** y uno existente reutilizado. `View` y `Modal` están en `types/app.ts`; ningún módulo importa desde `App`.

Se conservaron los abortos de consultas y de resolución de enlaces, el debounce de 180 ms, las marcas de edición manual, el refresco por revisión y la caducidad de notificaciones a los cuatro segundos. El borrador de volumen sigue compartido entre móvil y barra, y se reinicia cuando cambia el volumen remoto o el servidor.

## 6. Trabajo de los subagentes

Se ejecutaron cuatro subagentes reales. El límite de concurrencia era de cuatro agentes contando al principal, por lo que D comenzó cuando terminó A.

| Agente | Trabajo y límites |
| --- | --- |
| A — arquitectura | Auditoría de fuentes, estilos, estado y riesgos; propuesta modular. Solo lectura, sin cambios. |
| B — presentación | Creó únicamente los 18 TSX asignados. Extrajo markup, callbacks e interfaces. Verificó tres hitos de compilación y comparó estructura SSR original/modular. |
| C — hooks | Creó únicamente los tres hooks y `types/app.ts`. Conservó API, scope y SSE; entregó el contrato para integración. |
| D — calidad | Creó únicamente tres archivos de regresión y un helper en `frontend/test`. Revisó tipos, permisos y ciclos. |
| Principal | Registró baseline, creó rama, asignó archivos, integró `App`, formateó módulos, eliminó derivados duplicados, ejecutó validación completa y navegador, hizo commits y escribió este informe. |

No hubo edición simultánea de un mismo archivo. B utilizó el commit fijo `91a21e0` como fuente mientras el principal integraba `App`.

## 7. Decisiones y contratos conservados

- La selección de vistas sigue usando estado local. No se añadieron dependencias al proyecto ni se cambiaron manifests o lockfiles. Prettier se ejecutó mediante la caché de npm para formatear los módulos extraídos, sin incorporarlo como dependencia.
- `lib/api.ts` sigue siendo el único cliente HTTP: credenciales, errores, CSRF y tipos compartidos con el backend.
- Se conservaron `playback-stream.ts` y `operation-scope.ts`, incluidas sus protecciones contra REST antiguo, cambios de servidor, revocación y continuaciones después del logout.
- Logout sigue vaciando el servidor antes del POST para cerrar SSE, permite cancelar trabajo ocupado e invalida las continuaciones pendientes; si falla, restaura el servidor anterior.
- Las filas emiten índices desde cero. La composición conserva la conversión de cola a posiciones desde uno; playlists envían el orden de IDs original.
- `styles.css`, los primitives UI y `Artwork` no cambiaron. No se añadieron wrappers DOM; se usaron fragments para preservar hijos directos y selectores `nth-child`.
- Los roles `member`, `voice` y `admin` siguen siendo aplicados por el backend. El frontend original no ocultaba controles usando `permissions`; añadir gates nuevos habría cambiado la interfaz y quedó fuera de esta refactorización.
- Se retiraron del controlador los cálculos duplicados de progreso y duración de cola, que pertenecen a sus módulos de presentación.

## 8. Archivos modificados

Hay **28 archivos en el diff final**: `App.tsx`, 22 fuentes nuevas, cuatro archivos de pruebas nuevos y este informe.

Las 22 fuentes nuevas son los 18 TSX enumerados en el árbol, `features/auth/use-session.ts`, `features/library/use-library.ts`, `hooks/use-sonora-app.ts` y `types/app.ts`. Las pruebas nuevas son `app-regression.test.tsx`, `components-regression.test.tsx`, `controller-regression.test.ts` y `regression-fixtures.ts`.

No se modificaron backend, motor musical, fixture existente, scripts, configuración, dependencias, estilos ni pruebas preexistentes. El diff exacto se obtiene con:

```powershell
git diff --name-status 91a21e0..HEAD
```

## 9. Pruebas ejecutadas y resultados

| Comprobación | Baseline | Final |
| --- | --- | --- |
| `npm run build` | Código 0 | Código 0; TypeScript backend/frontend y Vite correctos. |
| `npm test` | 380 backend + 12 frontend; 392 aprobadas. | 380 backend + 55 frontend; **435 aprobadas**, cero fallos/omitidas. |
| `npm run deploy:check` | Código 0; 19 comandos. | Código 0; los mismos 19 comandos, sin registro ni conexión a Discord. |
| `git diff --check` | Árbol inicialmente limpio. | Código 0 en los hitos y antes de la entrega. |
| Typecheck estricto de las nuevas pruebas | No aplicaba. | Código 0. |
| Grafo de imports | Sin ciclos observados. | 33 módulos, 98 dependencias locales, **cero ciclos**. |

Huella de comandos conservada: `3e86b2114dfce87c089fca414acbc597b3b22810bbb4f0273e3d576e927d168f`.

Las **43 pruebas nuevas** se distribuyen así:

- 31 en `components-regression.test.tsx`: markup, estados del reproductor, progreso limitado, volumen, cola, vistas, diagnósticos, selector, formularios y nombres accesibles.
- Cuatro en `controller-regression.test.ts`: REST/CSRF, errores, invalidación de operaciones al salir y restauración del servidor ante logout fallido.
- Ocho en `app-regression.test.tsx`: composición, selección de vistas, navegación móvil, índices de cola, ownership de playlists y metadata sin ID.

Se mantuvieron las 12 pruebas frontend anteriores de API/CSRF, scope y REST/SSE. La suite backend conservó la cobertura existente de OAuth, acceso dinámico, dos servidores con permisos distintos, roles, revocación, fallos de Discord REST, cierre SSE y carga completa de playlists.

Los tests aislados de controlador no montan React ni simulan efectos; prueban políticas de comandos. No se presentan como pruebas de lifecycle React. La sincronización tiene sus pruebas de transporte existentes y se verificó también con la aplicación real del fixture.

Para repetir el typecheck adicional:

```powershell
.\frontend\node_modules\.bin\tsc.cmd --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --strict --skipLibCheck --esModuleInterop frontend/test/components-regression.test.tsx frontend/test/controller-regression.test.ts frontend/test/app-regression.test.tsx
```

## 10. Comparación visual y funcional

Se utilizó `node test/helpers/dashboard-preview.cjs`, con Fastify y REST/SSE reales, SQLite en memoria y música simulada, en `127.0.0.1:4174/4175`. No se abrió una sesión OAuth de producción ni se conectó el bot a Discord.

Se compararon reproductor, biblioteca, favoritos y diagnósticos en viewports de **1440 × 1000** y **390 × 844**. Las referencias iniciales se capturaron de la página original ya cargada antes de recargar con el código modular. Las ocho parejas conservaron exactamente el snapshot accesible.

| Comparación | Resultado observado |
| --- | --- |
| Biblioteca, favoritos y diagnósticos móvil | Imágenes idénticas píxel a píxel. |
| Reproductor móvil | Misma distribución; diferencia mínima en el indicador animado. |
| Escritorio | Sin cambios de distribución detectados; pequeñas diferencias de animación/transición en la navegación. |
| Reproductor escritorio | Una captura excluyó 16 px del margen derecho de la barra de scroll; al comparar el área común, las diferencias quedaron en los indicadores animados. No se reescalaron imágenes. |
| Compilación final | Se volvió a abrir y capturar el reproductor en escritorio y móvil; consola sin errores ni advertencias. |

Además, B comparó **52 escenarios SSR** originales/modulares: 38 de aplicación y 14 de contenido de modales. El HTML fue idéntico en todos. Los 14 casos de modal utilizaron un contenedor compartido, porque Radix Portal no se representa como una ventana abierta en SSR. Estas comprobaciones adicionales no se cuentan entre las 43 pruebas persistentes.

En el navegador se verificaron:

- Navegación entre las cuatro vistas y apertura/cierre del menú móvil.
- Pausa/reanudación, volumen por teclado 65 → 66 → 65 y cambio de repetición.
- Subir/bajar canciones, retirar una y agregar una búsqueda a la cola, con actualización REST/SSE visible.
- Quitar una canción de favoritos.
- Crear, abrir, renombrar y eliminar una playlist temporal en memoria.
- Abrir el formulario de canción, resolver un enlace y conservar título/artista escritos manualmente al recibir metadata; guardar la canción.
- Reordenar una playlist y cargar sus cuatro canciones: la cola pasó de tres a siete elementos.
- Selector de servidor mediante teclado, refresco de diagnósticos y logout, seguido del enlace `/auth/discord` en la pantalla de acceso.
- Ausencia de errores y advertencias en consola durante las comprobaciones.

Las capturas, snapshots y logs se guardaron como artefactos locales fuera de Git en:

```text
C:/Users/picud/.codex/visualizations/2026/10/16/01a1431d-35ae-7780-b7fa-24c452668c79/sonora-refactor/
```

Incluyen `before-*.jpg`, `after-*.jpg`, sus `.dom.txt`, `comparison.json`, `final-desktop-player.jpg`, `final-mobile-player.jpg`, `verified-library-dialog.jpg`, `verified-logout-login.jpg`, `baseline-tests.log`, `final-build.log`, `final-tests.log` y `final-deploy-check.log`. Son evidencia local de esta sesión; las rutas no forman parte del producto ni de los tests.

Los dos procesos del fixture usados para QA se detuvieron al finalizar y se restauró el viewport del navegador. Los puertos 4174/4175 quedaron sin listeners. El bot y el entorno de producción no se reiniciaron.

## 11. Problemas encontrados y límites

- Los estilos dependían de la jerarquía DOM, de hijos directos y de `nth-child`. La extracción utilizó fragments y la comparación SSR confirmó la estructura conservada.
- Cola y playlists usan bases de índices diferentes. La conversión quedó explícita y cubierta por regresiones de composición.
- Logout podía convivir con una operación musical pendiente. Se preservó el scope y se añadió cobertura específica para impedir su continuación posterior.
- La extracción inicial dejó progreso/duración calculados en dos lugares; se eliminó la duplicación antes de la validación final.
- El JSX original tenía líneas muy extensas. Los módulos nuevos se formatearon para facilitar futuras revisiones.
- Una edición intermedia de integración cortó el código en una coincidencia equivocada de `if (!session)` y falló TypeScript; se corrigió usando el commit local anterior como fuente y un límite exacto. Ningún commit quedó con ese fallo.
- El fixture ofrece un único servidor y un usuario autorizado. El cambio real entre dos servidores y la revocación de roles no se ejercitaron visualmente; tienen cobertura en las pruebas existentes de transporte/backend. Tampoco se realizó OAuth real contra Discord.
- La comparación visual corresponde a los viewports y estados observados; no sustituye una matriz completa de navegadores ni una auditoría exhaustiva de accesibilidad.

No quedaron fallos de compilación o de pruebas ni discrepancias de estructura/renderizado pendientes.

## 12. Métricas, commits y mejoras futuras

| Métrica | Resultado |
| --- | --- |
| Líneas físicas de `App.tsx` | **569 → 214**, reducción de 355 líneas (62,4 %), pese al formato más legible. |
| Componentes declarados dentro de `App.tsx` | Diez → uno. |
| Estados/efectos implementados en `App.tsx` | 29/8 → 0/0; el estado se compone mediante hooks. |
| Componentes públicos en módulos nuevos | 21, en 18 archivos; ocho trasladados/renombrados y trece nuevas separaciones. |
| Hooks nuevos/reutilizados | Tres nuevos y `usePlayback` existente. |
| Pruebas existentes/nuevas | 392 existentes conservadas; 43 nuevas; total final 435. |
| Rama final | `refactor/sonora-frontend-modular`. |

Commits locales, en orden:

1. `b30147d` — `refactor(frontend): extract shared UI components`.
2. `c0343cb` — `refactor(frontend): extract session and library state hooks`.
3. `9321d1a` — `refactor(frontend): modularize layout player and feature views`.
4. `a2c5854` — `test(frontend): cover modular views and command contracts`.
5. Commit que incorpora este informe — `docs(frontend): document modular refactor and validation`.

El identificador del commit de documentación se consulta con `git log -1 --oneline`. Los hitos de extracción e integración compilaron antes de ser confirmados.

Mejoras futuras recomendadas, fuera del alcance de esta refactorización:

- Añadir montaje React con un entorno DOM para comprobar directamente los efectos de sesión/biblioteca, StrictMode y respuestas demoradas entre servidores.
- Ampliar el fixture con dos servidores y permisos cambiantes para automatizar la misma matriz visual de roles y revocación.
- Convertir la revisión de navegador en una suite reproducible con capturas estabilizadas y comprobaciones de accesibilidad, evitando depender de animaciones para comparar píxeles.
- Mantener los límites actuales al añadir funciones; dividir el hook de biblioteca únicamente cuando surja una responsabilidad independiente que lo justifique.
