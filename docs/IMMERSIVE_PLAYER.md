# SONORA: reproductor inmersivo

## Preparación y baseline (2026-10-16)
Base limpia: main 5cf7de1, sincronizada con origin/main. Integrados refactor modular (PR5), correcciones de editor y propiedad de metadatos (PR6), documentación (PR7). Rama exclusiva: feat/sonora-immersive-lyrics. Sin merges, push, despliegue ni reinicio de producción.

Antes de modificar código: npm run build correcto; npm test correcto: **380 backend +81 frontend =461 pruebas**. Vite: CSS47.61kB, JS350.21kB (gzip111.27kB). Logs locales .baseline-immersive-build.log y .baseline-immersive-test.log (no versionados).

## Diseño: dos pasadas antes de implementar
Skill leída completa: C:\Users\picud\.agents\skills\frontend-design\SKILL.md. Agentes UX/UI y frontend/sincronización también deben leerla. No se modificó ni reinstaló.

Primera pasada: escenario continuo de escucha, portada protagonista izquierda y letras expresivas derecha. Tokens: tinta #0C0E12, velo #14171C, texto #F3F3F1, secundario #B4B8BD, verde #C7F57A, aviso #E8BD8A. Se conserva Segoe UI/Inter/system por continuidad con SONORA. Letras 40–54px escritorio, 28–34px móvil, alineadas izquierda, peso600. Tipografía y portada sustituyen tarjetas decorativas.

    SONORA                                      Cerrar
    [       portada       ]    Letras              LRCLIB
    [                     ]    Línea anterior
    Título / artista           Línea actual
    Progreso / controles       Línea siguiente

En móvil se alterna Portada/Letras dentro de una región común; controles permanecen accesibles abajo. Dos columnas comprimidas perjudicarían lectura y tamaño táctil. Safe areas y objetivos44px.

Segunda pasada crítica: oscuro+verde podía repetir un dashboard genérico. Se retiraron tarjetas, etiquetas superiores y numeraciones decorativas. El verde queda en controles/foco; la portada aporta ambiente cromático apagado. Letra activa blanca con mayor peso, sin escalar ni relayout. Fondo con velo oscuro constante para contraste. Apertura/cierre200ms, portada240ms, fondo800ms, líneas160ms; reduced-motion elimina movimiento y scroll suave. Scroll manual suspende seguimiento hasta acción explícita.

## Límites acordados
Un solo SSE existente. App y useSonoraApp conservan su alcance; presentación y efectos viven en features/immersive y features/lyrics. El audio continúa en Discord. El navegador usa un reloj monotónico reconciliado con snapshots, nunca HTMLAudioElement. No se añaden acciones musicales: no hay seek ni anterior en el contrato actual; progreso informativo, reloj reacciona a cambios de posición autoritativos. Las letras no disparan seek.
