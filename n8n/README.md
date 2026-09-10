# Workflows de n8n

Automatizaciones que leen la base `gym` y envían WhatsApp por Evolution API.

| Archivo | Qué hace | Disparador |
|---------|----------|------------|
| `01_pago_confirmado.json` | Al registrar un pago, la app llama a n8n y este manda la confirmación | Webhook `POST /webhook/pago` |
| `02_recordatorios_vencimiento.json` | Avisa a quien vence en 3, 1 o 0 días | Cron 08:00 |
| `03_marcar_vencidas.json` | Pone `estado='vencida'` a las suscripciones que pasaron de fecha | Cron 00:15 |
| `04_cumpleanos.json` | Saludo de cumpleaños (una vez al año por socio) | Cron 09:00 |
| `05_te_extranamos.json` | Mensaje al socio activo que lleva 14 días sin venir | Cron 10:00 |
| `06_resumen_diario.json` | Resumen de caja/ingresos al WhatsApp de la dueña | Cron 21:00 |

Todos deduplican contra `mensajes_enviados` (no reenvían lo mismo dentro de una ventana de días) y registran ahí cada envío.

---

## Requisitos previos (una sola vez)

### 1. Recrear el contenedor de n8n

Se agregaron variables de entorno (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `GYM_OWNER_PHONE`). Aplica los cambios:

```bash
cd C:\GYM; docker compose up -d n8n
```

Si quieres el resumen diario a la dueña, primero pon su número en `.env`:
`GYM_OWNER_PHONE=51987654321` y vuelve a correr el comando de arriba.

### 2. Conectar WhatsApp en Evolution API

```bash
curl -X POST http://localhost:8080/instance/create -H "Content-Type: application/json" -H "apikey: TU_EVOLUTION_API_KEY" -d "{\"instanceName\":\"gym\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}"
```

(`TU_EVOLUTION_API_KEY` = el valor de `EVOLUTION_API_KEY` en tu `.env`.)

Toma el `code`/QR de la respuesta —o abre `http://localhost:8080/instance/connect/gym`— y escanéalo con el WhatsApp del gimnasio. Prueba:

```bash
curl -X POST http://localhost:8080/message/sendText/gym -H "Content-Type: application/json" -H "apikey: TU_EVOLUTION_API_KEY" -d "{\"number\":\"51987654321\",\"text\":\"Prueba\"}"
```

### 3. Crear la credencial de Postgres en n8n

Abre http://localhost:5678 → **Credentials** → **New** → **Postgres**:

| Campo | Valor |
|-------|-------|
| **Credential Name** | `Gym Postgres (gym DB)` |
| Host | `postgres` |
| Database | `gym` |
| User | `gym` |
| Password | el valor de `POSTGRES_PASSWORD` en tu `.env` |
| Port | `5432` |
| SSL | disable |

> El nombre debe ser exactamente `Gym Postgres (gym DB)` para que los workflows la tomen solos al importar.

---

## Importar los workflows

En n8n: menú **☰ → Import from File** (o el botón **Import** en la lista de workflows) y elige cada archivo de `C:\GYM\n8n\workflows\`.

Por cada workflow importado:

1. Ábrelo. Si algún nodo Postgres muestra la credencial en rojo, selecciona `Gym Postgres (gym DB)`.
2. Botón **Activar** (arriba a la derecha).

El workflow **01 (pago confirmado) debe quedar activo** para que la app pueda llamar a `http://n8n:5678/webhook/pago`. Los demás se disparan solos por horario.

### Probar sin esperar al cron

Abre un workflow y usa **Execute Workflow** (ejecución manual). El nodo de horario se saltea y corre el resto con los datos reales de la base.

---

## Cómo tocar los textos

Los mensajes salen de la tabla `plantillas_mensaje` (pantalla **Plantillas** en la app). Editas ahí el texto con `{{nombres}}`, `{{plan}}`, `{{fecha_fin}}`, `{{dias_restantes}}`, `{{monto}}` y los workflows lo toman en la siguiente corrida. No hace falta tocar n8n.

## Notas

- Si Evolution API rechaza un envío (número inválido, sin sesión), el workflow **no se detiene**: sigue con los demás y lo verás en el historial de ejecuciones de n8n.
- Volumen seguro con un número no oficial: unos cientos de mensajes esperados por día. Para más, migrar a la API oficial de Meta.
- `_check.js` valida que los JSON y el código de los nodos estén bien:
  `docker compose exec -T app node /tmp/n8ncheck/_check.js` (tras `docker compose cp ./n8n app:/tmp/n8ncheck`).
