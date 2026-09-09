# Sistema de gestion de gimnasio

Base de un sistema para controlar **suscripciones, precios, pagos, caja,
asistencia y mensajes automaticos** de un gimnasio, pensado para correr
gratis (salvo el servidor) en un solo host con Docker.

## Que incluye este repo

| Ruta | Contenido |
|------|-----------|
| `docker-compose.yml` | Postgres + n8n + Evolution API (WhatsApp) + Adminer |
| `.env.example` | Variables de entorno (copiar a `.env`) |
| `db/init/` | Se ejecuta solo en el primer arranque de Postgres |
| `db/init/00_init_databases.sql` | Crea las bases `n8n` y `evolution` |
| `db/init/01_schema.sql` | Tablas: socios, planes, suscripciones, pagos, cajas, egresos, productos, asistencias, plantillas, mensajes |
| `db/init/02_views.sql` | Vistas de consulta: vencimientos, plata, asistencia, KPIs |
| `db/init/03_seed.sql` | Planes, usuario admin y plantillas de mensaje iniciales |
| `db/seed_demo.sql` | Datos de prueba (se corre a mano) |
| `db/demo_cleanup.sql` | Borra los datos de prueba |
| `docs/flujos.md` | Como interactuan la app, n8n y Evolution API |
| `app/` | Reservado para la app web (Next.js), aun sin codigo |

## Arquitectura

```
Recepcion --HTTPS--> App web (Next.js)
                        |  SQL         webhook HTTP
                        v                 |
                   Postgres <---- SQL --- n8n --HTTP--> Evolution API --WhatsApp--> Socios
```

- **App web**: captura de datos y tableros. Unica que toca la recepcionista.
- **Postgres**: fuente de verdad. Bases separadas: `gym`, `n8n`, `evolution`.
- **n8n**: automatizaciones y mensajes programados.
- **Evolution API**: canal de WhatsApp (WhatsApp Web).
- **Adminer**: visor web de la base de datos.

## Requisitos

- Docker y Docker Compose v2 (`docker compose version`).

## Puesta en marcha

```bash
cp .env.example .env
# edita .env y cambia TODAS las claves
docker compose up -d
docker compose ps
```

Servicios (local):

| Servicio | URL | Notas |
|----------|-----|-------|
| n8n | http://localhost:5678 | usuario/clave de `.env` (`N8N_BASIC_AUTH_*`) |
| Evolution API | http://localhost:8080 | header `apikey: <EVOLUTION_API_KEY>` |
| Adminer | http://localhost:8081 | sistema PostgreSQL, servidor `postgres`, base `gym` |
| Postgres | localhost:5432 | usuario/clave/base de `.env` |

### Conectar WhatsApp (Evolution API)

1. Crear una instancia:
   ```bash
   curl -X POST http://localhost:8080/instance/create \
     -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"gym","integration":"WHATSAPP-BAILEYS","qrcode":true}'
   ```
2. Abrir el QR (viene en la respuesta, o `GET /instance/connect/gym`) y escanearlo
   con el WhatsApp del gimnasio.
3. Probar envio:
   ```bash
   curl -X POST http://localhost:8080/message/sendText/gym \
     -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
     -d '{"number":"51900000001","text":"Prueba desde el sistema"}'
   ```

> El numero va con codigo de pais y sin `+` (ej. `51987654321`). Usa un numero
> dedicado y no hagas envios masivos: WhatsApp puede bloquear la linea.

### Cargar datos de prueba

```bash
docker compose exec -T postgres psql -U gym -d gym < db/seed_demo.sql
# ver que las vistas devuelven algo:
docker compose exec postgres psql -U gym -d gym -c "SELECT * FROM v_kpis_hoy;"
# borrar luego:
docker compose exec -T postgres psql -U gym -d gym < db/demo_cleanup.sql
```

## Reset de la base

Los scripts de `db/init/` **solo corren la primera vez** (volumen `pg_data` vacio).
Para reconstruir desde cero:

```bash
docker compose down -v      # borra TODOS los datos
docker compose up -d
```

## Backup / restore

```bash
# Backup
docker compose exec -T postgres pg_dump -U gym -Fc gym > backup_gym_$(date +%F).dump

# Restore
docker compose exec -T postgres pg_restore -U gym -d gym --clean < backup_gym_2026-01-01.dump
```

## Despliegue con Coolify

1. Instala Coolify en el servidor (Hetzner, Oracle, etc.).
2. Nuevo recurso -> **Docker Compose** -> apunta a este repo.
3. Carga las variables del `.env` en la pestana de entorno de Coolify.
4. Publica dominios para la app y para n8n; deja Postgres y Evolution API
   **sin exponer** (solo red interna).
5. Activa backups programados de Postgres en Coolify.

## Esquema (resumen)

- **socios** - datos del socio (baja logica con `activo`).
- **planes** - lista de precios; `duracion_dias` define la vigencia.
- **suscripciones** - `fecha_inicio`/`fecha_fin`, `precio_pagado` (snapshot), `estado`.
- **pagos** - cada ingreso; `metodo_pago` (efectivo/yape/plin/tarjeta/transferencia), ligado a `caja`.
- **cajas** / **egresos** - apertura, cierre, descuadre. Solo una caja abierta a la vez.
- **productos** / **venta_productos** - venta de mostrador.
- **asistencias** - check-in por socio.
- **plantillas_mensaje** - textos con `{{marcadores}}`.
- **mensajes_enviados** - historial + anti-duplicado (indice `idx_msg_dedup`).

Vistas clave: `v_socios_estado`, `v_suscripciones_por_vencer`, `v_socios_vencidos`,
`v_socios_en_riesgo`, `v_cumpleanos_hoy`, `v_ingresos_diarios`, `v_ingresos_mensuales`,
`v_ingresos_por_metodo`, `v_ingresos_por_plan`, `v_renovaciones_mensuales`,
`v_resumen_caja`, `v_asistencias_por_dia`, `v_asistencias_por_hora`, `v_kpis_hoy`.
