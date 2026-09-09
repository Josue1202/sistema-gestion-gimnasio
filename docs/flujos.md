# Flujos principales

## A. Pago en recepcion (por evento)

1. La recepcionista registra el pago en la **app**.
2. La app guarda en Postgres: fila en `pagos`, actualiza `suscripciones.fecha_fin`,
   asocia el pago a la `caja` abierta.
3. La app hace `POST http://n8n:5678/webhook/pago` con
   `{ socio_id, nombres, telefono, plan, monto, fecha_fin }`.
4. n8n toma la plantilla `pago_confirmado`, reemplaza los `{{marcadores}}`.
5. n8n llama a Evolution API:
   `POST /message/sendText/<instancia>` con `{ number, text }`.
6. n8n inserta en `mensajes_enviados`
   (`plantilla_clave='pago_confirmado'`, `referencia_tipo='pago'`, `referencia_id=<pago_id>`).

## B. Recordatorio de vencimiento (programado, diario 08:00)

1. **Schedule Trigger** en n8n.
2. Nodo Postgres:
   ```sql
   SELECT * FROM v_suscripciones_por_vencer WHERE dias_restantes = 3;
   ```
3. Por cada fila:
   - anti-duplicado: intentar `INSERT` en `mensajes_enviados` con
     `plantilla_clave='recordatorio_3d'`, `referencia_id = suscripcion_id`.
     El indice `idx_msg_dedup` rechaza el duplicado -> se salta.
   - armar mensaje con la plantilla `recordatorio_3d`.
   - enviar por Evolution API.
   - actualizar la fila a `estado='enviado'`, `enviado_en=now()`.
4. Al terminar, n8n manda un resumen al WhatsApp de la duena.

Variantes con la misma forma:
- `recordatorio_hoy`  -> `WHERE dias_restantes = 0`
- `vencido`           -> `SELECT * FROM v_socios_vencidos WHERE dias_vencido = 1`
- `te_extranamos`     -> `SELECT * FROM v_socios_en_riesgo WHERE dias_sin_venir = 14`
- `cumpleanos`        -> `SELECT * FROM v_cumpleanos_hoy`
  (dedup con `referencia_id = socio_id`, `periodo = to_char(CURRENT_DATE,'YYYY')`)

## C. Marcar vencidas (programado, diario 00:15)

```sql
UPDATE suscripciones
SET estado = 'vencida'
WHERE estado = 'activa' AND fecha_fin < CURRENT_DATE;
```

## D. Estados de entrega (opcional)

Configurar el webhook de Evolution API hacia n8n para eventos
`messages.update` y actualizar `mensajes_enviados.estado`
(`entregado` / `leido` / `respondido`) por `proveedor_id`.
