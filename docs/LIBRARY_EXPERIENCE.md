# SONORA — Library Experience 2.0

Evolución visual y funcional de la biblioteca musical de SONORA inspirada en aplicaciones musicales modernas (Apple Music), manteniendo la identidad oscura (`#0c0e12`) y el acento verde ácido (`#c7f57a`) del reproductor inmersivo y del dashboard.

---

## 1. Componentes nuevos y responsabilidades

| Archivo | Responsabilidad |
| --- | --- |
| [`frontend/src/features/library/PlaylistArtwork.tsx`](../frontend/src/features/library/PlaylistArtwork.tsx) | Componente reutilizable de carátulas y mosaicos dinámicos de playlists (`selectPlaylistCoverTracks`, `PlaylistArtwork`). |
| [`frontend/src/features/library/library-Catalog.ts`](../frontend/src/features/library/library-Catalog.ts) | Normalización de búsqueda sin acentos (`normalizeLibraryText`), filtrado por playlist/canción/artista (`filterAndSortPlaylists`), ordenamiento determinista, resumen honesto de duración (`summarizePlaylistDuration`), plataformas (`summarizePlaylistSources`) y persistencia segura en `localStorage`. |
| [`frontend/src/features/library/LibraryToolbar.tsx`](../frontend/src/features/library/LibraryToolbar.tsx) | Barra de herramientas con buscador instantáneo, botón de limpieza, contador de colecciones, selector de ordenamiento y conmutador Cuadrícula / Lista. |
| [`frontend/src/features/library/PlaylistCard.tsx`](../frontend/src/features/library/PlaylistCard.tsx) | Tarjeta visual para la vista de cuadrícula con `PlaylistArtwork`, botón de reproducción directa, indicador de coincidencia de búsqueda y menú contextual (`<details>`). |
| [`frontend/src/features/library/PlaylistGrid.tsx`](../frontend/src/features/library/PlaylistGrid.tsx) | Contenedor que alterna entre `.playlist-grid` (tarjetas visuales + tarjeta de nueva playlist) y `.playlist-list` (filas compactas con acciones rápidas), además del estado vacío de búsqueda. |
| [`frontend/src/features/library/PlaylistDetails.tsx`](../frontend/src/features/library/PlaylistDetails.tsx) | Cabecera de detalle de playlist con carátula/mosaico de gran formato, conteo de pistas, duración honesta, resumen de plataformas y `<TrackList />`. |
| [`frontend/src/features/library/LibraryView.tsx`](../frontend/src/features/library/LibraryView.tsx) | Orquestación de la biblioteca, preservando todos los contratos de `useLibrary`, `PlaylistImportDialog` y las pruebas de regresión existentes. |

---

## 2. Reglas de `PlaylistArtwork`

`PlaylistArtwork` representa visualmente cada playlist a partir de sus canciones reales utilizando el componente `<Artwork />` existente (incluyendo la detección de miniaturas caídas o placeholders de YouTube):

1. **Deduplicación no destructiva (`selectPlaylistCoverTracks`)**:
   - Selecciona hasta **4 pistas con miniaturas válidas y distintas** (`thumbnail` no vacío).
   - Si varias pistas comparten la misma carátula (por ejemplo, canciones de un mismo álbum), no repite la misma imagen en las 4 celdas del mosaico, **sin modificar ni reordenar** `playlist.tracks`.
2. **Composición adaptativa mediante CSS Grid**:
   - **Playlist vacía (`tracks.length === 0`)**: Estado visual dedicado (`.playlist-artwork-empty`) con anillo punteado e icono de disco.
   - **Sin portadas disponibles (`0` miniaturas válidas)**: Fallback elegante de SONORA (`.playlist-artwork-fallback`) con órbitas y gradiente temático.
   - **1 portada válida (`.playlist-artwork-single`)**: Portada completa a sangre.
   - **2 portadas distintas (`.playlist-artwork-duo`)**: Composición dividida en dos columnas equilibradas (`1fr 1fr`).
   - **3 portadas distintas (`.playlist-artwork-trio`)**: Composición asimétrica con portada principal a la izquierda (`grid-row: 1 / span 2`) y dos celdas apiladas a la derecha.
   - **4 o más portadas distintas (`.playlist-artwork-quad`)**: Mosaico `2×2` de cuatro carátulas.
3. **Aislamiento de fallos por celda**:
   - Cada celda monta su propio `<Artwork />`. Si una miniatura falla (`onError` o placeholder inválido de `ytimg`), **solo esa celda** muestra `.artwork-fallback`, conservando intactas las demás imágenes del mosaico.

---

## 3. Vistas implementadas

### Vista de cuadrícula (`.playlist-grid`)
- Carátula protagonista cuadrada con `PlaylistArtwork`, numeración sutil de colección y botón flotante de reproducción (`Escuchar <nombre>`).
- Pie de tarjeta con título, cantidad de canciones, plataforma de origen, duración (cuando está disponible) y menú contextual (`Opciones de <nombre>`) para **Agregar canción**, **Renombrar** o **Eliminar**.
- Incluye la tarjeta de creación rápida (`Crea tu próxima playlist`) cuando no hay un filtro de búsqueda activo.

### Vista de lista (`.playlist-list`)
- Alternativa compacta pensada para bibliotecas extensas (50–100+ playlists).
- Muestra índice, miniatura/mosaico compacto (`48×48`), título, conteo de canciones, origen, duración y botonera de acciones directas (Reproducir, Agregar canción, Renombrar, Eliminar).
- La preferencia entre **Cuadrícula** (`grid`) y **Lista** (`list`) se guarda de forma segura en `localStorage` (`sonora:library-layout`) con manejo defensivo de errores.

### Vista de detalle de playlist (`.playlist-detail`)
- Presenta `PlaylistArtwork` en formato destacado (`125×125` en escritorio, `85×85` en móvil), título de colección, conteo de canciones, duración honesta y plataformas.
- **Duración honesta (`summarizePlaylistDuration`)**:
  - Si todas las pistas tienen duración conocida (`> 0`), muestra el total exacto (ej. `4:00`).
  - Si algunas pistas tienen `duration === 0` (habitual en ciertas entradas parciales), muestra la suma conocida más el aviso explícito (`4:00 + 1 sin duración`).
  - Si ninguna pista tiene duración conocida, muestra `Duración pendiente` en lugar de `0:00`.
- Conserva intacta la lista de canciones (`<TrackList context="playlist" />`) con soporte de arrastrar para reordenar, favoritos, guardado en otra playlist, eliminación y reproducción individual.

---

## 4. Búsqueda y ordenamiento

### Búsqueda instantánea (`normalizeLibraryText` + `filterAndSortPlaylists`)
- Normaliza texto con descomposición Unicode (`NFD`), eliminando marcas diacríticas (acentos/diéresis), convirtiendo a minúsculas y colapsando espacios.
- Busca simultáneamente en:
  1. **Nombre de la playlist**.
  2. **Título y artista** de las canciones ya presentes en el estado de la biblioteca.
- Cuando una playlist coincide gracias a una canción o artista (y no solo por el nombre de la playlist), muestra la insignia contextual `Incluye «<título>»` (y cuántas pistas adicionales coinciden).
- Incluye botón para limpiar la búsqueda (`Limpiar búsqueda`) y estado vacío específico cuando ninguna colección coincide.
- Al cambiar de servidor (`guildId`), el filtro de búsqueda se reinicia automáticamente para evitar mostrar estados vacíos heredados de otro servidor.

### Ordenamiento determinista
Selector con persistencia local (`sonora:library-sort`) y desempate estable por índice original:
- **Orden de creación (`recent`)**: Respeta el orden canónico devuelto por el backend (`ORDER BY createdAt ASC`).
- **Nombre (A–Z) (`name-asc`)** y **Nombre (Z–A) (`name-desc`)**: Comparación `localeCompare('es', { sensitivity: 'base' })`.
- **Más canciones (`tracks-desc`)** y **Menos canciones (`tracks-asc`)**: Orden por cantidad de pistas.

---

## 5. Decisiones de procedencia y persistencia

- **Sin migración innecesaria en SQLite**: La tabla `playlists` (`id`, `userId`, `guildId`, `name`, `createdAt`) no almacena una columna de procedencia (`manual` vs `imported`). Siguiendo las reglas de arquitectura del proyecto, **no se infiere falsamente** que una playlist fue importada solo por contener enlaces de YouTube o YouTube Music, ni se introdujo una migración de esquema innecesaria.
- En su lugar, cada playlist resume de forma veraz las plataformas reales de las pistas que contiene (`YouTube`, `Spotify`, `SoundCloud`, `Apple Music`) mediante `summarizePlaylistSources`, o muestra `Tu colección` cuando está vacía.

---

## 6. Rendimiento, accesibilidad y pruebas

- **Rendimiento en bibliotecas grandes**: Las tarjetas a partir de la posición 16 en cuadrícula y las filas a partir de la posición 24 en lista aplican `.playlist-item-deferred` (`content-visibility: auto; contain-intrinsic-size: ...`) para evitar trabajo de layout y pintado fuera del viewport.
- **Accesibilidad y movimiento reducido**: Controles con `aria-label`, `aria-pressed`, navegación por teclado (`Enter` y `Space` en tarjetas y filas sin interferir con botones internos) y soporte completo para `@media (prefers-reduced-motion: reduce)`.
- **Pruebas automatizadas**:
  - [`frontend/test/library-experience.test.tsx`](../frontend/test/library-experience.test.tsx): Cubre `PlaylistArtwork` (vacía, sin portadas, 1, 2, 3 y 4 portadas, deduplicación sin mutar pistas, fallo individual de imagen), playlists importadas con duración parcial/pendiente, alternancia cuadrícula/lista + `localStorage`, búsqueda con acentos/mayúsculas por playlist/canción/artista, ordenamientos, acciones (abrir, reproducir, renombrar, eliminar, agregar canción), favoritos, cambio de servidor, respuestas tardías en `useLibrary`, estados sin permisos/reproducción deshabilitada y reglas CSS responsive/`prefers-reduced-motion`.
  - [`frontend/test/components-regression.test.tsx`](../frontend/test/components-regression.test.tsx) y [`frontend/test/playlist-import.test.tsx`](../frontend/test/playlist-import.test.tsx): Verificados sin regresiones.

---

## 7. Limitaciones conocidas

- La búsqueda filtra sobre las playlists y pistas cargadas en memoria para el servidor activo; no realiza consultas remotas adicionales a YouTube ni a SQLite.
- La preferencia de vista (`grid` / `list`) y ordenamiento se conserva por navegador en `localStorage` y no se sincroniza entre dispositivos distintos.
