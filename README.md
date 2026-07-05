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
