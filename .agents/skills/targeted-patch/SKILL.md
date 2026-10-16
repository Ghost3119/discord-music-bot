---
name: targeted-patch
description: Implementar cambios pequeños y localizados en SONORA con exploración mínima suficiente, modificación temprana y validación específica. Usar para CSS, componentes React, correcciones TypeScript, bugs localizados, microinteracciones y ajustes acotados de funcionalidad.
---

# Targeted patch

Aplica las instrucciones y el mapa de `AGENTS.md` en la raíz de SONORA.

1. **Delimita.** Identifica el comportamiento solicitado, el actual y un criterio
   observable de éxito. Selecciona inicialmente 1–3 archivos probablemente relacionados;
   es una orientación, no un límite. Si falta información, avanza en lo independiente.
2. **Inspecciona lo pertinente.** Busca símbolos, funciones y rutas concretas y lee sus
   implementaciones y contratos relevantes. No recorras el proyecto completo ni repitas
   inspecciones sin evidencia nueva. Amplía solo por una dependencia, fallo o riesgo concreto.
3. **Implementa pronto.** Al comprender suficientemente el cambio, realiza el mínimo
   correcto preservando contratos. Evita refactorizaciones ajenas, abstracciones innecesarias
   y consumir la sesión en planificación cuando la modificación ya está clara.
4. **Valida.** Ejecuta primero las pruebas relacionadas usando los comandos del mapa raíz;
   añade comprobaciones más amplias según contratos y riesgo. No elimines pruebas para
   conseguir resultados correctos. Para un ajuste visual verifica apariencia, interacción,
   responsive o reduced-motion cuando afecte a esos comportamientos.
5. **Revisa.** Comprueba diff, tipos cuando corresponda, criterio de éxito, regresiones,
   consola si aplica y git status. Si no puedes observar el resultado visual o ejecutar
   una comprobación, explica esa limitación; no presentes inferencias como pruebas.
6. **Entrega.** Resume archivos modificados, problema resuelto, comprobaciones realmente
   realizadas y limitaciones pendientes.

No crees documentos extensos ni inicies subagentes para editar uno o dos archivos salvo
una razón clara y autorización aplicable. No conviertas estas orientaciones en excusas
para omitir investigación o validación necesaria. No afirmes ahorro de tokens sin medirlo.
Si el problema exige investigación arquitectónica o crítica, explica la ampliación y
adapta el flujo; no fuerces un parche superficial.

Para diseño sustancial puede combinarse con `frontend-design` si está disponible.
Conserva su instalación global; si el entorno no la descubre, usa la ruta indicada
en las instrucciones raíz como referencia explícita, sin copiarla.
