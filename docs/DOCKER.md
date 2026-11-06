# Despliegue de SONORA con Docker

Guía operativa para ejecutar el bot musical de Discord y el panel web privado SONORA en un contenedor de producción local.

## 1. Requisitos previos

1. **Docker Engine** y **Docker Compose v2** (`docker compose version`).
2. Archivo **`.env`** configurado en la raíz del repositorio a partir de `.env.example` (nunca se copia dentro de la imagen ni se sube a Git).
   - Variables mínimas del bot: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`.
   - Variables del panel web (`WEB_ENABLED=true`): `WEB_CLIENT_SECRET`, `WEB_ACCESS_MODE` (`allowlist` o `guild_members`) y los IDs autorizados correspondientes (`WEB_ALLOWED_USER_IDS` o `WEB_ALLOWED_GUILD_IDS`).
3. Comandos slash desplegados previamente en Discord (`npm run deploy` una vez cuando cambien las definiciones de comandos).

---

## 2. Variantes de red y seguridad del panel

Dentro del contenedor, el proceso escucha en `0.0.0.0:8080` (`WEB_HOST=0.0.0.0` y `WEB_BIND_PUBLIC=true` definidos en `docker-compose.yml` únicamente para el namespace del contenedor) para que el reenvío de puertos de Docker pueda alcanzarlo. **En el host nunca debes publicar `0.0.0.0:8080` directamente sin HTTPS.**

### Variante A — Acceso solo local (loopback del host)

El panel solo es accesible desde la misma máquina en `http://127.0.0.1:8080`:

- En `docker-compose.yml`:
  ```yaml
  ports:
    - '127.0.0.1:${WEB_PORT:-8080}:${WEB_PORT:-8080}'
  ```
- En `.env`:
  ```dotenv
  WEB_ENABLED=true
  WEB_PORT=8080
  WEB_ORIGIN=http://127.0.0.1:8080
  WEB_REDIRECT_URI=http://127.0.0.1:8080/auth/discord/callback
  ```

### Variante B — Detrás de un reverse proxy con HTTPS

Si deseas acceder al panel fuera de loopback (por ejemplo, mediante Caddy, Nginx, Traefik o Cloudflare Tunnel):

1. Mantén el puerto publicado solo en loopback del host (`127.0.0.1:8080:8080`) o conecta el reverse proxy mediante una red interna de Docker. **No publiques `0.0.0.0:8080:8080` en el host.**
2. Configura TLS/HTTPS en el reverse proxy y apunta el upstream a `http://127.0.0.1:8080` (o `http://sonora:8080` en red interna de Compose).
3. En `.env`, usa el origen público en `https://`:
   ```dotenv
   WEB_ENABLED=true
   WEB_PORT=8080
   WEB_ORIGIN=https://sonora.tu-dominio.com
   WEB_REDIRECT_URI=https://sonora.tu-dominio.com/auth/discord/callback
   ```
4. Registra exactamente ese `WEB_REDIRECT_URI` en el portal de desarrolladores de Discord (OAuth2 -> Redirects). Con `https://`, SONORA activa automáticamente cookies `__Host-` con atributo `Secure` y cabecera `Strict-Transport-Security`.

> **Importante (Linux):** el contenedor se ejecuta con el usuario no-root `node` (`UID 1000`, `GID 1000`). Si los directorios `./data` o `./logs` en el host pertenecen a otro usuario en Linux, ajusta sus permisos antes de arrancar:
>
> ```bash
> mkdir -p data logs && chown -R 1000:1000 data logs
> ```

---

## 3. Operaciones habituales

### Levantar el servicio (compilar e iniciar en segundo plano)

```bash
docker compose up -d --build
```

El contenedor arranca con el supervisor de producción (`node scripts/supervise.cjs`), nunca con `npm run dev`.

### Ver logs en tiempo real

```bash
docker compose logs -f sonora
```

Los logs estructurados y redactados también se persisten en `./logs/bot.jsonl` y `./logs/supervisor.jsonl`.

### Parar el servicio

```bash
docker compose down
```

Los datos en `./data` (`dashboard.sqlite`, `history.json`, checkpoints de cola) y `./logs` se conservan en el host al destruir o recrear el contenedor.

### Actualizar SONORA

Cuando haya cambios en el repositorio o quieras reconstruir con la imagen base más reciente:

```bash
git pull
docker compose build --pull
docker compose up -d --force-recreate
```

Para actualizar el binario de `yt-dlp` a una versión revisada con verificación SHA-256 sin usar `--update` en caliente, actualiza el código/imagen y recrea el contenedor con los comandos anteriores.

---

## 4. Copias de seguridad (Backup de `data/` y `logs/`)

Toda la persistencia vive en los volúmenes montados `./data` y `./logs`:

- `data/dashboard.sqlite` (y archivos `-wal` / `-shm`): sesiones, playlists y favoritos del panel.
- `data/history.json` y checkpoints de recuperación de colas.
- `logs/`: registros rotados del supervisor y del bot.

### Opción recomendada (con el contenedor detenido brevemente)

```bash
docker compose stop sonora
tar -czf "sonora-backup-$(date +%Y%m%d-%H%M%S).tar.gz" data/ logs/
docker compose start sonora
```

### En PowerShell (Windows)

```powershell
docker compose stop sonora
Compress-Archive -Path .\data, .\logs -DestinationPath "sonora-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
docker compose start sonora
```

---

## 5. Verificación de salud y funcionamiento

1. **Estado del contenedor y healthcheck (`GET /healthz`):**

   ```bash
   docker compose ps
   ```

   La columna `STATUS` debe mostrar `(healthy)`.

2. **Comprobar el endpoint de salud sin autenticación:**

   ```bash
   curl -i http://127.0.0.1:8080/healthz
   ```

   Debe responder `HTTP/1.1 200 OK` con `{"status":"ok"}` (sin exponer secretos, datos de usuario ni rutas `/api/*`).

3. **Comprobar el panel web:**
   Abre `http://127.0.0.1:8080` en tu navegador (o ejecuta `curl -I http://127.0.0.1:8080`) y verifica que sirve el frontend compilado de SONORA.

4. **Comprobar la conexión a Discord:**
   Revisa en los logs la línea de inicio:
   ```bash
   docker compose logs sonora | grep -E "Bot conectado como|Panel disponible"
   ```
   Verifica en tu servidor de Discord que el bot aparece en línea y responde al comando `/play`.
