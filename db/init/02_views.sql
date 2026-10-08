-- ============================================================
--  Vistas de consulta: estado de socios, vencimientos, plata,
--  asistencia y KPIs. La app y n8n consultan estas vistas.
-- ============================================================

-- ------------------------------------------------------------
--  Suscripcion "vigente" de cada socio = la de fecha_fin mas lejana
--  entre las no canceladas.
-- ------------------------------------------------------------
CREATE VIEW v_socio_suscripcion_vigente AS
SELECT DISTINCT ON (su.socio_id)
  su.socio_id,
  su.id                          AS suscripcion_id,
  su.plan_id,
  p.nombre                       AS plan_nombre,
  su.fecha_inicio,
  su.fecha_fin,
  su.estado                      AS suscripcion_estado,
  (su.fecha_fin - CURRENT_DATE)  AS dias_restantes
FROM suscripciones su
JOIN planes p ON p.id = su.plan_id
WHERE su.estado <> 'cancelada'
ORDER BY su.socio_id, su.fecha_fin DESC;

-- ------------------------------------------------------------
--  Socios activos con su estado de membresia calculado.
-- ------------------------------------------------------------
CREATE VIEW v_socios_estado AS
SELECT
  s.id,
  s.nombres,
  s.apellidos,
  s.dni,
  s.telefono,
  s.email,
  s.fecha_nacimiento,
  s.acepta_marketing,
  s.fecha_registro,
  v.suscripcion_id,
  v.plan_nombre,
  v.fecha_inicio,
  v.fecha_fin,
  v.dias_restantes,
  CASE
    WHEN v.suscripcion_id IS NULL           THEN 'sin_suscripcion'
    WHEN v.suscripcion_estado = 'congelada' THEN 'congelado'
    WHEN v.fecha_fin >= CURRENT_DATE        THEN 'activo'
    ELSE 'vencido'
  END AS estado_membresia,
  s.foto_url
FROM socios s
LEFT JOIN v_socio_suscripcion_vigente v ON v.socio_id = s.id
WHERE s.activo = true;

-- ------------------------------------------------------------
--  Suscripciones por vencer (n8n filtra por dias_restantes).
--    SELECT * FROM v_suscripciones_por_vencer WHERE dias_restantes = 3;
-- ------------------------------------------------------------
CREATE VIEW v_suscripciones_por_vencer AS
SELECT
  su.id                          AS suscripcion_id,
  s.id                           AS socio_id,
  s.nombres,
  s.apellidos,
  s.telefono,
  s.email,
  s.acepta_marketing,
  p.nombre                       AS plan_nombre,
  su.fecha_fin,
  (su.fecha_fin - CURRENT_DATE)  AS dias_restantes
FROM suscripciones su
JOIN socios s ON s.id = su.socio_id AND s.activo = true
JOIN planes p ON p.id = su.plan_id
WHERE su.estado = 'activa'
  AND su.fecha_fin >= CURRENT_DATE
ORDER BY su.fecha_fin;

-- ------------------------------------------------------------
--  Socios vencidos (para campana de recuperacion).
-- ------------------------------------------------------------
CREATE VIEW v_socios_vencidos AS
SELECT
  e.id            AS socio_id,
  e.nombres,
  e.apellidos,
  e.telefono,
  e.email,
  e.plan_nombre,
  e.fecha_fin,
  (CURRENT_DATE - e.fecha_fin) AS dias_vencido
FROM v_socios_estado e
WHERE e.estado_membresia = 'vencido'
ORDER BY e.fecha_fin DESC;

-- ------------------------------------------------------------
--  Cumpleanos de hoy.
-- ------------------------------------------------------------
CREATE VIEW v_cumpleanos_hoy AS
SELECT
  id AS socio_id, nombres, apellidos, telefono, email, fecha_nacimiento
FROM socios
WHERE activo = true
  AND fecha_nacimiento IS NOT NULL
  AND extract(month from fecha_nacimiento) = extract(month from CURRENT_DATE)
  AND extract(day   from fecha_nacimiento) = extract(day   from CURRENT_DATE);

-- ------------------------------------------------------------
--  Socios en riesgo: membresia activa pero sin asistir >= 14 dias.
-- ------------------------------------------------------------
CREATE VIEW v_socios_en_riesgo AS
SELECT
  e.id       AS socio_id,
  e.nombres,
  e.apellidos,
  e.telefono,
  e.fecha_fin,
  e.dias_restantes,
  MAX(a.fecha) AS ultima_asistencia,
  (CURRENT_DATE - MAX((a.fecha AT TIME ZONE 'America/Lima')::date)) AS dias_sin_venir
FROM v_socios_estado e
LEFT JOIN asistencias a ON a.socio_id = e.id
WHERE e.estado_membresia = 'activo'
GROUP BY e.id, e.nombres, e.apellidos, e.telefono, e.fecha_fin, e.dias_restantes
HAVING MAX(a.fecha) IS NULL
    OR (CURRENT_DATE - MAX((a.fecha AT TIME ZONE 'America/Lima')::date)) >= 14
ORDER BY dias_sin_venir DESC NULLS FIRST;

-- ============================================================
--  PLATA
-- ============================================================

-- Ingresos por dia y metodo de pago
CREATE VIEW v_ingresos_diarios AS
SELECT
  (creado_en AT TIME ZONE 'America/Lima')::date AS dia,
  metodo_pago,
  COUNT(*)   AS num_pagos,
  SUM(monto) AS total
FROM pagos
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- Ingresos por mes, con desglose por metodo
CREATE VIEW v_ingresos_mensuales AS
SELECT
  date_trunc('month', creado_en AT TIME ZONE 'America/Lima')::date AS mes,
  COUNT(*)   AS num_pagos,
  SUM(monto) AS total,
  SUM(monto) FILTER (WHERE metodo_pago = 'efectivo')      AS total_efectivo,
  SUM(monto) FILTER (WHERE metodo_pago = 'yape')          AS total_yape,
  SUM(monto) FILTER (WHERE metodo_pago = 'plin')          AS total_plin,
  SUM(monto) FILTER (WHERE metodo_pago = 'tarjeta')       AS total_tarjeta,
  SUM(monto) FILTER (WHERE metodo_pago = 'transferencia') AS total_transferencia
FROM pagos
GROUP BY 1
ORDER BY 1 DESC;

-- Ingresos acumulados por metodo de pago
CREATE VIEW v_ingresos_por_metodo AS
SELECT
  metodo_pago,
  COUNT(*)   AS num_pagos,
  SUM(monto) AS total
FROM pagos
GROUP BY metodo_pago
ORDER BY total DESC;

-- Ingresos por plan y mes
CREATE VIEW v_ingresos_por_plan AS
SELECT
  date_trunc('month', p.creado_en AT TIME ZONE 'America/Lima')::date AS mes,
  pl.nombre  AS plan_nombre,
  COUNT(*)   AS num_ventas,
  SUM(p.monto) AS total
FROM pagos p
JOIN suscripciones su ON su.id = p.suscripcion_id
JOIN planes pl        ON pl.id = su.plan_id
GROUP BY 1, 2
ORDER BY 1 DESC, 4 DESC;

-- Tasa de renovacion mensual
CREATE VIEW v_renovaciones_mensuales AS
WITH vencimientos AS (
  SELECT
    su.id,
    su.socio_id,
    date_trunc('month', su.fecha_fin)::date AS mes_vencimiento,
    su.fecha_fin
  FROM suscripciones su
  WHERE su.estado IN ('activa','vencida')
)
SELECT
  v.mes_vencimiento,
  COUNT(*) AS vencieron,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM suscripciones r
    WHERE r.socio_id = v.socio_id
      AND r.id <> v.id
      AND r.fecha_inicio >= v.fecha_fin - INTERVAL '7 days'
      AND r.fecha_inicio <= v.fecha_fin + INTERVAL '30 days'
  )) AS renovaron,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM suscripciones r
      WHERE r.socio_id = v.socio_id
        AND r.id <> v.id
        AND r.fecha_inicio >= v.fecha_fin - INTERVAL '7 days'
        AND r.fecha_inicio <= v.fecha_fin + INTERVAL '30 days'
    )) / NULLIF(COUNT(*), 0),
  1) AS tasa_renovacion_pct
FROM vencimientos v
GROUP BY 1
ORDER BY 1 DESC;

-- Resumen de caja: esperado vs real, diferencia
CREATE VIEW v_resumen_caja AS
SELECT
  c.id AS caja_id,
  c.fecha_apertura,
  c.fecha_cierre,
  c.estado,
  c.monto_apertura,
  COALESCE(SUM(p.monto) FILTER (WHERE p.metodo_pago = 'efectivo'),  0) AS ingresos_efectivo,
  COALESCE(SUM(p.monto) FILTER (WHERE p.metodo_pago <> 'efectivo'), 0) AS ingresos_otros,
  COALESCE((SELECT SUM(e.monto) FROM egresos e WHERE e.caja_id = c.id), 0) AS egresos_total,
  c.monto_apertura
    + COALESCE(SUM(p.monto) FILTER (WHERE p.metodo_pago = 'efectivo'), 0)
    - COALESCE((SELECT SUM(e.monto) FROM egresos e
                WHERE e.caja_id = c.id AND e.metodo_pago = 'efectivo'), 0) AS efectivo_esperado,
  c.monto_cierre_real,
  c.monto_cierre_real - (
    c.monto_apertura
    + COALESCE(SUM(p.monto) FILTER (WHERE p.metodo_pago = 'efectivo'), 0)
    - COALESCE((SELECT SUM(e.monto) FROM egresos e
                WHERE e.caja_id = c.id AND e.metodo_pago = 'efectivo'), 0)
  ) AS diferencia
FROM cajas c
LEFT JOIN pagos p ON p.caja_id = c.id
GROUP BY c.id
ORDER BY c.fecha_apertura DESC;

-- ============================================================
--  ASISTENCIA
-- ============================================================
CREATE VIEW v_asistencias_por_dia AS
SELECT
  (fecha AT TIME ZONE 'America/Lima')::date AS dia,
  COUNT(*)                    AS asistencias,
  COUNT(DISTINCT socio_id)    AS socios_unicos
FROM asistencias
GROUP BY 1
ORDER BY 1 DESC;

CREATE VIEW v_asistencias_por_hora AS
SELECT
  extract(hour from fecha AT TIME ZONE 'America/Lima')::int AS hora,
  COUNT(*) AS asistencias
FROM asistencias
GROUP BY 1
ORDER BY 1;

-- ============================================================
--  KPIs de una mirada (una sola fila)
-- ============================================================
CREATE VIEW v_kpis_hoy AS
SELECT
  (SELECT COUNT(*) FROM v_socios_estado WHERE estado_membresia = 'activo')  AS socios_activos,
  (SELECT COUNT(*) FROM v_socios_estado WHERE estado_membresia = 'vencido') AS socios_vencidos,
  (SELECT COUNT(*) FROM v_suscripciones_por_vencer WHERE dias_restantes BETWEEN 0 AND 7) AS vencen_7d,
  (SELECT COALESCE(SUM(monto),0) FROM pagos
     WHERE (creado_en AT TIME ZONE 'America/Lima')::date
         = (now()     AT TIME ZONE 'America/Lima')::date) AS ingresos_hoy,
  (SELECT COALESCE(SUM(monto),0) FROM pagos
     WHERE date_trunc('month', creado_en AT TIME ZONE 'America/Lima')
         = date_trunc('month', now()     AT TIME ZONE 'America/Lima')) AS ingresos_mes,
  (SELECT COUNT(*) FROM asistencias
     WHERE (fecha AT TIME ZONE 'America/Lima')::date
         = (now()  AT TIME ZONE 'America/Lima')::date) AS asistencias_hoy;
