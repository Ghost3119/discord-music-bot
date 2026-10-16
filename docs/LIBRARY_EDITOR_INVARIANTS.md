# SONORA — Invariantes del editor de biblioteca

Validación completada el 16 de octubre de 2026, America/Mexico_City.

## Base y alcance

- Base: `main`, `2f38832`, con la refactorización modular integrada.
- El árbol inicial estaba limpio. Se creó `fix/sonora-library-editor-invariants` antes de modificar archivos.
- Baseline: `npm test` aprobó 380 pruebas backend y 55 frontend, 435 en total.
- Se conservaron la arquitectura, `App.tsx`, `useSonoraApp`, el sistema global `busy`, backend, endpoints, estilos y distribución visual. No se añadieron Context ni stores.

## Fallos demostrados antes de corregir

Las primeras 19 pruebas nuevas montaron React mediante `createRoot` y `act`, con efectos reales. Contra el hook original **11 fallaron y ocho pasaron**. Solo se simularon las dependencias HTTP y las operaciones externas; React, sus efectos y su ciclo de vida no fueron sustituidos.

| Caso | Resultado original | Corrección verificada |
| --- | --- | --- |
| Llega la carga inicial durante crear, renombrar o agregar canción | Se borraba el borrador; tres pruebas fallaban. | La inicialización depende de la apertura del editor, no de cambios en playlists. |
| Refresco con un destino de guardado todavía válido | Se cambiaba a la primera playlist. | Se conserva el destino; solo se reemplaza cuando desaparece. |
| A resuelta → B pendiente → Guardar, normal y StrictMode | Se enviaba B con título, artista, duración, portada y fuente de A. | Solo se usan metadatos asociados a la URL actual; dos pruebas pasan. |
| A resuelta → B pendiente con título manual | Se conservaban otros metadatos automáticos de A. | Se conserva el título manual y se envían valores seguros para los datos todavía desconocidos de B. |
| Editar título/artista durante una consulta | Se abortaba y repetía la petición por cambiar las marcas de edición. | La edición no reinicia la resolución. |
| Vaciar campos manualmente antes de resolver o antes de enviar | Se restauraban datos automáticos contra la edición explícita; dos pruebas fallaban. | El borrador vacío se conserva; no se sustituye por los campos de la respuesta. |
| Borrar una URL ya resuelta | Quedaba texto autocompletado anterior. | Desaparecen los campos automáticos; permanecen los manuales. |

Para los contratos, seis ejemplos negativos con `@ts-expect-error` fallaron con `TS2578` contra el componente original: TypeScript aceptaba playlists sin propietario y cola/favoritos con propietario, tanto en lista como en fila. Con la unión discriminada, los seis casos inválidos son rechazados y los seis válidos compilan.

Durante la corrección se añadió una prueba con `LibraryDialog` y su portal reales: tras vaciar artista conservando un título manual, la tarjeta mostraba el artista resuelto anterior, aunque el payload enviaba `Artista desconocido`. Se registró **una prueba fallida y 25 aprobadas** antes de ajustar los dos fallbacks de la vista previa. Después pasaron las 26.

## Implementación

### Borrador y selección

`useLibrary` inicializa el formulario al cambiar `modal`. Un efecto separado reconcilia `targetPlaylist`: conserva una selección válida, elige la primera disponible si desaparece y atiende la llegada tardía de playlists. Un refresco de colecciones ya no reinicializa los campos ni cancela una resolución en curso.

### Propiedad de metadatos

Cada resultado guarda la URL solicitada y la identidad del editor que lo originó. `resolvedTrack` solo expone el resultado cuando ambos coinciden con el editor actual. Se usa la URL de entrada, no la URL canónica devuelta por el backend, para admitir enlaces equivalentes normalizados por el servidor.

Los campos automáticos se derivan del resultado coincidente. El estado conserva los borradores manuales y sus marcas de edición, incluyendo valores vacíos. Esto evita que un render de B arrastre campos automáticos de A, incluso antes de que React ejecute el cleanup anterior.

La consulta depende del editor, URL normalizada, servidor y sesión; las ediciones de título/artista no son dependencias. El debounce de 180 ms y `AbortController` se mantienen. Los callbacks de éxito, error y finalización ignoran peticiones canceladas, incluso si el transporte simulado entrega una respuesta después del aborto.

Guardar durante la resolución sigue permitido. El payload utiliza únicamente metadatos coincidentes y los campos manuales actuales. Cuando faltan datos automáticos, se usan título vacío, artista desconocido, duración cero y portada nula; nunca los de otra URL.

### Encapsulación y tipos

- Se retiraron del retorno público `setTrackArtist`, `setTitleTouched` y `setArtistTouched`. La fachada `...library` de `useSonoraApp` deja de propagarlos sin modificar el controlador.
- Se conservan `onTrackTitleChange` y `onTrackArtistChange`, que actualizan conjuntamente valor y marca de edición, además de las capacidades usadas de nombre y URL.
- `TrackListProps` y `TrackItemProps` requieren `owner` para playlists y lo prohíben para cola/favoritos. El forwarding conserva la unión, sin alterar el DOM ni los handlers.
- Los ejemplos positivos y negativos de contratos están incluidos en `npm run build` mediante `test/*.typecheck.tsx`. No se ejecutan ni se importan en la aplicación.

## Pruebas finales

`library-editor.test.tsx` contiene **26 pruebas montadas**, incluidas las primeras 19. Cubren:

- Crear, renombrar y agregar durante cargas/refrescos; destino válido y llegada tardía de playlists.
- A resuelta → B pendiente y envío, con y sin título manual, también en StrictMode.
- A pendiente → B, respuesta y rechazo tardíos de A, conservación del indicador de carga de B y envío correcto de B.
- Ediciones manuales durante la consulta, cambios de URL y vaciados explícitos.
- URL borrada durante una petición o después de resolver, sin perder texto manual.
- Cierre y reapertura, también en StrictMode.
- Aborto por cambio de servidor/sesión y desmontaje; cancelación del debounce antes de emitir una petición.
- Sondeo de montaje de StrictMode, sin aplicar respuestas de la instancia cancelada.
- URL canónica distinta de la entrada y vista previa real del artista.

| Comprobación | Resultado real |
| --- | --- |
| `npm run build` | Código 0; TypeScript backend/frontend, contratos de compilación y Vite correctos. |
| `npm test` | Código 0; 380 backend + 81 frontend = **461 aprobadas**, cero fallos/omitidas. |
| `npm run deploy:check` | Código 0; 19 comandos, sin contactar con Discord ni iniciar el bot. |
| `git diff --check` | Código 0. |
| Typecheck estricto adicional de pruebas modificadas/nuevas | Código 0. |

Se mantuvieron todas las pruebas existentes. La única adaptación fue proporcionar un propietario válido en un caso de regresión de playlist que antes utilizaba una combinación ahora prohibida.

La huella de comandos permanece `3e86b2114dfce87c089fca414acbc597b3b22810bbb4f0273e3d576e927d168f`.

Para ejecutar la cobertura montada:

```powershell
npm --prefix frontend test -- --run test/library-editor.test.tsx
```

Se añadió únicamente `jsdom@26.1.0` como dependencia de desarrollo para disponer de un DOM de pruebas. No se añadió una librería de estado ni una dependencia de producción.

## Archivos modificados

- `frontend/src/features/library/use-library.ts`: invariantes del borrador, URL, resolución y API pública.
- `frontend/src/features/library/LibraryDialog.tsx`: dos fallbacks de artista coherentes con el payload.
- `frontend/src/components/queue/TrackList.tsx`: contratos discriminados y forwarding tipado.
- `frontend/test/library-editor.test.tsx`: 26 pruebas con React montado.
- `frontend/test/library-editor.typecheck.tsx`: protección de la API pública del hook y controlador.
- `frontend/test/track-list-contracts.typecheck.tsx`: combinaciones válidas e inválidas de propietario/contexto.
- `frontend/test/components-regression.test.tsx`: propietario válido en una prueba existente.
- `frontend/tsconfig.json`: inclusión de los contratos de compilación.
- `frontend/package.json` y `frontend/package-lock.json`: jsdom de desarrollo.
- `docs/LIBRARY_EDITOR_INVARIANTS.md`: este informe.

## Evidencia, límites y riesgos pendientes

Los logs originales se conservaron fuera de Git en:

```text
C:/Users/picud/.codex/visualizations/2026/10/16/01a1431d-35ae-7780-b7fa-24c452668c79/sonora-editor-invariants/
```

Incluyen `sonora-editor-baseline-tests.log`, `sonora-editor-red.log` (11 fallos originales), `sonora-editor-preview-red.log`, `sonora-editor-green.log`, `sonora-track-contract-red.log` y los logs finales de build, suite completa y deploy check. Son artefactos locales de esta sesión.

No quedan fallos conocidos de los escenarios solicitados. Se mantiene un comportamiento existente del backend: si el título enviado está vacío, resuelve la URL actual al guardar y puede completar también un artista vacío/desconocido. Preservar un borrador vacío no significa persistir campos vacíos; no se modificó esa política del servidor.

Guardar con título manual antes de terminar la resolución puede conservar duración cero y portada nula. Se mantiene la posibilidad de guardar sin esperar y se evita atribuir a B datos de A. Completar posteriormente esos metadatos sería otra funcionalidad.

La comprobación de integración visual aquí es DOM montado y regresiones existentes. No se realizó una nueva comparación de capturas en navegador; no se cambiaron CSS, clases, layout ni estructura del diálogo.

## Commits locales

1. `1178ec9` — `fix(frontend): preserve library editor drafts and metadata ownership`.
2. `8190194` — `fix(frontend): enforce editor and track ownership contracts`.
3. Commit que incorpora este informe — `docs(frontend): record editor invariant regressions and validation`.

Rama final: `fix/sonora-library-editor-invariants`. Sin push, publicación, despliegue ni reinicio del bot de producción.
