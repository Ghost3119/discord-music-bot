# Flujos de agentes de SONORA

`AGENTS.md` es el punto de entrada permanente: identidad, mapa de tareas, invariantes,
Git y comandos. `targeted-patch` se carga para implementar un cambio acotado; contiene
el procedimiento, sin repetir la arquitectura. No hace falta leer todas las guías
ni auditar el proyecto para comenzar. Conserva una nota breve de archivos ya leídos,
hallazgos y comprobaciones pendientes para evitar exploración redundante.

## Compatibilidad verificada el 16 de octubre de 2026

| Entorno | Convenciones confirmadas en documentación oficial | Invocación |
| --- | --- | --- |
| Codex | AGENTS.md raíz; skills en .agents/skills con SKILL.md y frontmatter name/description | `$targeted-patch` o selección de skill; también selección automática por descripción |
| Antigravity actual | AGENTS.md raíz; .agents/skills con SKILL.md y descripción YAML | `/targeted-patch` según guía de migración; también petición por nombre y selección por descripción |

Fuentes: [instrucciones Codex](https://developers.openai.com/codex/guides/agents-md),
[skills Codex](https://developers.openai.com/codex/skills),
[reglas Antigravity](https://antigravity.google/docs/rules),
[skills Antigravity](https://antigravity.google/docs/skills) y
[invocación Antigravity](https://www.antigravity.google/docs/migration/workflows-to-skills/).

Codex construye instrucciones desde la raíz hasta el directorio de trabajo; las más
profundas prevalecen y AGENTS.override.md tiene prioridad dentro del mismo directorio.
Antigravity carga reglas de directorios desde el archivo consultado hasta la raíz del
workspace. No se presupone idéntica resolución de conflictos entre productos.
Se evaluaron frontend/, src/web/ y src/music/: por ahora no necesitan AGENTS.md anidados;
el mapa raíz y las guías de invariantes aportan las diferencias sin duplicación ni
dependencia de descubrimiento anidado.

La sesión actual confirma `frontend-design` global disponible y su archivo existente.
No se probó una sesión nueva de Codex ni una instalación local de Antigravity; tampoco
se certifica disponibilidad de GPT-6 Sol, Gemini 4 Argon o Gemini 3.8 Flash en cuentas
concretas. La compatibilidad corresponde al entorno y su versión, no al nombre del modelo.
Abre SONORA como repositorio/workspace y comprueba el selector tras recargar o iniciar
una conversación nueva. Si falta descubrimiento, pide leer explícitamente
`.agents/skills/targeted-patch/SKILL.md`; esto usa el contenido sin demostrar carga automática.
Otros agentes deben comprobar sus propias rutas antes de asumir compatibilidad.

## Diseño y tamaño del trabajo

Conserva `C:\Users\picud\.agents\skills\frontend-design\SKILL.md` sin copiar ni reinstalar.
Codex reconoce la ubicación global ~/.agents/skills; Antigravity documenta
~/.gemini/config/skills, por lo que no se presupone que descubra esa instalación global.
En Antigravity pide leer su ruta explícitamente si puede acceder a ella.
Combina frontend-design para decisiones visuales sustanciales (interfaces nuevas,
componentes complejos, animaciones o responsive) con targeted-patch para una implementación
delimitada. Un pequeño retoque CSS puede bastarse con las convenciones existentes.

Para cambios pequeños: un agente y pruebas focalizadas. Medianos: investigación breve,
implementación y validación. Grandes: plan de arquitectura y responsabilidades separadas,
con subagentes cuando aporten trabajo independiente y estén autorizados. Críticos:
revisar seguridad, concurrencia, cancelación y regresiones aunque cambien pocos archivos.
Las dos pasadas de diseño narradas en IMMERSIVE_PLAYER.md describen aquella entrega;
no obligan a repetirlas en cada tarea.

## Prompts acotados

En Codex usa los siguientes ejemplos; en Antigravity actual sustituye `$targeted-patch`
por `/targeted-patch` o pide usar la skill por nombre.

- **CSS:** «Usa $targeted-patch. Reduce la intensidad del fondo de álbum en
  frontend/src/features/immersive/immersive.css. Conserva el velo de contraste y
  reduced-motion. Éxito: letras legibles con portadas claras y oscuras. Empieza por
  ese CSS y AmbientBackground.tsx; amplía solo si hace falta y verifica visualmente».
- **React:** «Usa $targeted-patch. Corrige LibraryDialog para que una respuesta tardía
  de metadatos no restaure el artista vaciado manualmente. Revisa el componente,
  use-library.ts y la sección pertinente de LIBRARY_EDITOR_INVARIANTS.md. Reproduce
  el fallo con library-editor.test.tsx y conserva el borrador al refrescar playlists».
- **Investigación necesaria:** «Investiga por qué una reconexión SSE durante recuperación
  desincroniza letras y estado de reproducción. Empieza por playback-stream.ts,
  playback-clock.ts y sus pruebas. Traza identidad/orden hasta el bridge si hay evidencia,
  define invariantes y un plan antes de cambiar contratos. Usa subagentes solo para
  responsabilidades independientes si resultan útiles. Valida pausa, reconexión,
  cambio de canción y respuestas tardías; no reinicies el bot ni despliegues».

Incluye resultado observable, área inicial, comportamiento que debe conservarse y
validación deseada. Las rutas son puntos de entrada, no prohibiciones de investigar.
Las instrucciones no garantizan ahorro de tokens, calidad ni obediencia del agente:
revisa el diff y los resultados. Los mapas y scripts deben actualizarse cuando cambie
la arquitectura. Para documentación sola bastan rutas, formato, scripts y diff;
no es necesaria toda la suite musical.
