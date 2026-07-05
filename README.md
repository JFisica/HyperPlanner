# EHW Task Command

Gestión de tareas para las 2 semanas de la European Hyperloop Week. Responde en segundos a "X acaba de terminar, ¿qué es lo siguiente más crítico que puede hacer?".

## Arrancar

```bash
npm install
npm --prefix client install
npm run seed        # crea skills e hitos iniciales (idempotente)
npm run dev         # desarrollo: API en :3000 + Vite en :5173
```

Producción (un solo proceso que sirve API + frontend):

```bash
npm run build
node server/server.js   # http://localhost:3000
```

Para usarlo en LAN basta con arrancarlo así y compartir `http://<ip-del-portátil>:3000`.

- PIN por defecto: `1234` (ver abajo).
- Parte del día público (sin PIN): `http://<host>:3000/parte?date=2026-07-06`.
- Tests (detección de ciclos): `npm test`.

## Cambiar el PIN

El PIN es la variable de entorno `ADMIN_PIN`:

```powershell
$env:ADMIN_PIN = "7412"; node server/server.js   # PowerShell
```

```bash
ADMIN_PIN=7412 node server/server.js             # bash / Railway
```

Sin `ADMIN_PIN` definido se usa `1234` y el servidor lo avisa por consola.

## Desplegar en VPS con Docker

### 1. Sube el código al VPS

```bash
git clone <tu-repo> ehw && cd ehw
# o rsync/scp si no usas git en el VPS
```

### 2. Crea el fichero de entorno

```bash
echo "ADMIN_PIN=tu_pin_seguro" > .env
```

### 3. Arranca el contenedor

```bash
docker compose up -d --build
```

La primera vez tarda ~2 min (compila `better-sqlite3` y construye el cliente). Las siguientes son rápidas porque Docker cachea las capas.

Comprueba que arranca:

```bash
docker compose logs -f
# debe mostrar: "EHW Task Command en http://localhost:3000"
```

### 4. Configura nginx

Copia el bloque de `nginx.conf.example` en tu configuración de nginx (p.ej. `/etc/nginx/sites-available/ehw`), edita el `server_name`, y recarga:

```bash
sudo ln -s /etc/nginx/sites-available/ehw /etc/nginx/sites-enabled/ehw
sudo nginx -t && sudo systemctl reload nginx
```

Para HTTPS con Let's Encrypt (recomendado):

```bash
sudo certbot --nginx -d ehw.tudominio.com
```

### 5. Actualizar tras cambios

```bash
git pull
docker compose up -d --build
```

Docker conserva el volumen `ehw_data` con `data.db` entre builds — los datos no se pierden.

### Copia de seguridad de data.db en el VPS

```bash
# El volumen de Docker está en /var/lib/docker/volumes/ehw_ehw_data/_data/data.db
# Copia diaria con cron (crontab -e):
0 3 * * * cp /var/lib/docker/volumes/ehw_ehw_data/_data/data.db /root/backups/data-$(date +%F).db
```

Para restaurar: `docker compose down`, reemplaza el fichero, `docker compose up -d`.

---

## Desplegar en Railway

1. Sube el repo a GitHub y crea un proyecto en Railway desde ese repo.
2. Build command: `npm install && npm --prefix client install && npm run build`
3. Start command: `npm run seed && node server/server.js`
4. Variables: `ADMIN_PIN` (el PIN que quieras). Railway inyecta `PORT` solo.

Ojo: en Railway el filesystem es efímero salvo que añadas un volumen. Añade un volumen montado en `/data` y define `DB_PATH=/data/data.db` para que `data.db` sobreviva a los deploys.

## Copia de seguridad de data.db

Toda la aplicación vive en un único fichero SQLite. Un `cp` diario es suficiente:

```powershell
Copy-Item data.db "backups/data-$(Get-Date -Format yyyy-MM-dd).db"
```

Hazlo cada noche (o antes de cualquier cambio gordo). Para restaurar: parar el servidor, sustituir `data.db`, arrancar.
