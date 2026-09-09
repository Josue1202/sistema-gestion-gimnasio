# App web

Aplicacion de recepcion: socios, suscripciones, pagos, caja, asistencia,
productos, reportes y mensajes por WhatsApp (links `wa.me`).

- **Stack:** Node 20 + Express + EJS (renderizado en el servidor) + PostgreSQL (`pg`).
- Sin paso de build: se edita y se reinicia.
- Sesion con cookie firmada; las sesiones se guardan en Postgres (tabla `session`,
  se crea sola).

## Correr con Docker (recomendado)

Desde la raiz del repo (`C:\GYM`):

```bash
docker compose up -d --build
```

La app queda en http://localhost:3000

**Primer uso:** entra a http://localhost:3000/setup y crea la contrasena del
administrador (usa el correo `admin@gimnasio.local` que sembro `03_seed.sql`).

## Correr en local sin Docker

Necesitas Node 20+ y el Postgres del compose levantado.

```bash
cd app
cp .env.example .env      # ajusta DATABASE_URL con la clave real
npm install
npm run dev
```

## Estructura

```
src/
  server.js        arranque, sesion, montaje de rutas
  db.js            pool de Postgres + helper de transacciones
  auth.js          login / setup / logout
  util.js          formato de soles/fechas, wa.me, webhook a n8n
  mensajeria.js    plantillas + variables {{...}}
  routes/          dashboard, socios, suscripciones, planes, caja,
                   asistencia, productos, reportes, mensajes, plantillas
  views/           plantillas EJS (layout + una carpeta por modulo)
public/styles.css  estilos (claro/oscuro automatico)
```

## Integracion con n8n

Al registrar un pago, la app hace `POST {N8N_WEBHOOK_URL}/pago` con los datos
del socio y la renovacion. Si n8n no responde, la operacion igual se guarda
(el webhook es best-effort). Ver `../docs/flujos.md`.
