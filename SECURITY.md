# Política de seguridad de SONORA

## Alcance y límites de confianza

Esta política cubre el bot de Discord, el panel React/Fastify, la persistencia SQLite,
los extractores y los scripts de operación de este repositorio.
Las entradas de Discord, HTTP y proveedores externos son datos no confiables.
El operador controla la configuración del host; el panel escucha en loopback por defecto.
Una publicación mediante proxy exige HTTPS; un túnel hacia Vite requiere autenticación externa.

## Invariantes

- El backend valida sesión, membresía del servidor y permisos; los controles musicales
  exigen además el canal de voz autorizado, incluso después de esperas.
- Las mutaciones validan Origin y CSRF; las consultas que contactan proveedores exigen CSRF.
- Las sesiones y CSRF son aleatorios e independientes; SQLite conserva sus hashes.
- Playlists y favoritos se aíslan por usuario y servidor.
- Solo se aceptan enlaces de proveedores musicales permitidos; entradas de usuario no
  se interpretan como opciones de procesos. Los secretos no llegan al navegador ni a los logs.
- Los trabajos externos, cuerpos, conexiones y colas tienen límites y cancelación.

## Reportes y evaluación

Comunica una posible vulnerabilidad al mantenedor por un canal privado acordado.
No publiques tokens, cookies, bases de datos privadas ni detalles de explotación en issues.
Incluye revisión afectada, ruta alcanzable, permisos necesarios, impacto y reproducción segura.
La exposición real, las barreras de autorización y el impacto determinan la severidad.
Esta política no establece exclusiones de análisis ni acepta riesgos nuevos.
Los proveedores, DNS, CDN y dependencias siguen requiriendo revisión y actualizaciones.
