-- ============================================================
--  Sistema de gestion de gimnasio - Esquema base
--  Postgres 16+
-- ============================================================

SET client_encoding = 'UTF8';

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ------------------------------------------------------------
--  Utilidad: refresca "actualizado_en" en cada UPDATE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
--  USUARIOS DEL SISTEMA (personal que usa la app)
-- ============================================================
CREATE TABLE usuarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  email          text NOT NULL UNIQUE,
  password_hash  text,
  rol            text NOT NULL DEFAULT 'recepcion'
                 CHECK (rol IN ('admin','recepcion','entrenador')),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_usuarios_upd BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ============================================================
--  SOCIOS
-- ============================================================
CREATE TABLE socios (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombres                       text NOT NULL,
  apellidos                     text NOT NULL,
  dni                           text UNIQUE,
  telefono                      text,          -- formato WhatsApp: 51XXXXXXXXX (sin +)
  email                         text,
  fecha_nacimiento              date,
  genero                        text CHECK (genero IN ('M','F','otro')),
  direccion                     text,
  contacto_emergencia_nombre    text,
  contacto_emergencia_telefono  text,
  foto_url                      text,
  notas                         text,
  acepta_marketing              boolean NOT NULL DEFAULT true,
  activo                        boolean NOT NULL DEFAULT true,   -- baja logica (no borrar)
  fecha_registro                date NOT NULL DEFAULT CURRENT_DATE,
  creado_en                     timestamptz NOT NULL DEFAULT now(),
  actualizado_en                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_socios_telefono  ON socios (telefono);
CREATE INDEX idx_socios_apellidos ON socios (lower(apellidos));
CREATE INDEX idx_socios_nombres   ON socios (lower(nombres));
CREATE INDEX idx_socios_activo    ON socios (activo);
CREATE INDEX idx_socios_cumple    ON socios ((extract(month from fecha_nacimiento)),
                                             (extract(day   from fecha_nacimiento)));
CREATE TRIGGER trg_socios_upd BEFORE UPDATE ON socios
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ============================================================
--  PLANES (lista de precios de membresias / pases)
-- ============================================================
CREATE TABLE planes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  descripcion    text,
  precio         numeric(10,2) NOT NULL CHECK (precio >= 0),
  duracion_dias  integer NOT NULL CHECK (duracion_dias > 0),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_planes_upd BEFORE UPDATE ON planes
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ============================================================
--  SUSCRIPCIONES
-- ============================================================
CREATE TABLE suscripciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id        uuid NOT NULL REFERENCES socios(id) ON DELETE RESTRICT,
  plan_id         uuid NOT NULL REFERENCES planes(id) ON DELETE RESTRICT,
  fecha_inicio    date NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin       date NOT NULL,
  precio_pagado   numeric(10,2) NOT NULL CHECK (precio_pagado >= 0),
  estado          text NOT NULL DEFAULT 'activa'
                  CHECK (estado IN ('activa','vencida','cancelada','congelada')),
  congelada_desde date,
  congelada_hasta date,
  notas           text,
  creado_por      text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX idx_susc_socio      ON suscripciones (socio_id);
CREATE INDEX idx_susc_plan       ON suscripciones (plan_id);
CREATE INDEX idx_susc_fecha_fin  ON suscripciones (fecha_fin);
CREATE INDEX idx_susc_estado_fin ON suscripciones (estado, fecha_fin);
CREATE TRIGGER trg_susc_upd BEFORE UPDATE ON suscripciones
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ============================================================
--  CAJAS (apertura / cierre)
-- ============================================================
CREATE TABLE cajas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_apertura    timestamptz NOT NULL DEFAULT now(),
  fecha_cierre      timestamptz,
  monto_apertura    numeric(10,2) NOT NULL DEFAULT 0 CHECK (monto_apertura >= 0),
  monto_cierre_real numeric(10,2),
  estado            text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
  abierta_por       text,
  cerrada_por       text,
  notas             text,
  creado_en         timestamptz NOT NULL DEFAULT now()
);
-- Solo puede haber UNA caja abierta a la vez
CREATE UNIQUE INDEX idx_cajas_una_abierta ON cajas (estado) WHERE estado = 'abierta';
CREATE INDEX idx_cajas_apertura ON cajas (fecha_apertura DESC);

-- ============================================================
--  PAGOS (ingresos de dinero)
-- ============================================================
CREATE TABLE pagos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id       uuid REFERENCES socios(id) ON DELETE RESTRICT,
  suscripcion_id uuid REFERENCES suscripciones(id) ON DELETE SET NULL,
  caja_id        uuid REFERENCES cajas(id) ON DELETE SET NULL,
  concepto       text NOT NULL,
  monto          numeric(10,2) NOT NULL CHECK (monto > 0),
  metodo_pago    text NOT NULL
                 CHECK (metodo_pago IN ('efectivo','yape','plin','tarjeta','transferencia','otro')),
  referencia     text,          -- nro de operacion Yape / Plin / transferencia
  registrado_por text,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagos_socio  ON pagos (socio_id);
CREATE INDEX idx_pagos_susc   ON pagos (suscripcion_id);
CREATE INDEX idx_pagos_caja   ON pagos (caja_id);
CREATE INDEX idx_pagos_fecha  ON pagos (creado_en);
CREATE INDEX idx_pagos_metodo ON pagos (metodo_pago);

-- ============================================================
--  EGRESOS (salidas de caja)
-- ============================================================
CREATE TABLE egresos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caja_id        uuid NOT NULL REFERENCES cajas(id) ON DELETE CASCADE,
  concepto       text NOT NULL,
  monto          numeric(10,2) NOT NULL CHECK (monto > 0),
  metodo_pago    text NOT NULL DEFAULT 'efectivo'
                 CHECK (metodo_pago IN ('efectivo','yape','plin','tarjeta','transferencia','otro')),
  registrado_por text,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_egresos_caja ON egresos (caja_id);

-- ============================================================
--  PRODUCTOS (venta de mostrador: bebidas, suplementos)
-- ============================================================
CREATE TABLE productos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  descripcion    text,
  precio         numeric(10,2) NOT NULL CHECK (precio >= 0),
  costo          numeric(10,2) CHECK (costo >= 0),
  stock          integer NOT NULL DEFAULT 0,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_productos_upd BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- Detalle de productos vendidos dentro de un pago
CREATE TABLE venta_productos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id         uuid NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  producto_id     uuid NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad        integer NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(10,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal        numeric(10,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);
CREATE INDEX idx_venta_prod_pago     ON venta_productos (pago_id);
CREATE INDEX idx_venta_prod_producto ON venta_productos (producto_id);

-- ============================================================
--  ASISTENCIAS
-- ============================================================
CREATE TABLE asistencias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id       uuid NOT NULL REFERENCES socios(id) ON DELETE CASCADE,
  suscripcion_id uuid REFERENCES suscripciones(id) ON DELETE SET NULL,
  fecha          timestamptz NOT NULL DEFAULT now(),
  metodo         text CHECK (metodo IN ('manual','qr','dni')),
  registrado_por text
);
CREATE INDEX idx_asist_socio ON asistencias (socio_id, fecha DESC);
CREATE INDEX idx_asist_fecha ON asistencias (fecha);

-- ============================================================
--  PLANTILLAS DE MENSAJE
--  Marcadores: {{nombres}} {{apellidos}} {{plan}} {{fecha_fin}}
--              {{dias_restantes}} {{monto}}
-- ============================================================
CREATE TABLE plantillas_mensaje (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave          text NOT NULL UNIQUE,
  descripcion    text,
  canal          text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp','email','sms')),
  asunto         text,
  cuerpo         text NOT NULL,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_plantillas_upd BEFORE UPDATE ON plantillas_mensaje
  FOR EACH ROW EXECUTE FUNCTION set_actualizado_en();

-- ============================================================
--  MENSAJES ENVIADOS (historial + anti-duplicado)
-- ============================================================
CREATE TABLE mensajes_enviados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  socio_id        uuid REFERENCES socios(id) ON DELETE SET NULL,
  telefono        text,
  canal           text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp','email','sms')),
  plantilla_clave text,
  contenido       text,
  estado          text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','enviado','entregado','leido','fallido','respondido')),
  proveedor_id    text,          -- id del mensaje en Evolution API
  error           text,
  referencia_tipo text,          -- 'suscripcion' | 'cumpleanos' | 'asistencia' | ...
  referencia_id   uuid,
  periodo         text,          -- p.ej. '2026' o '2026-03' para deduplicar recurrentes
  programado_para timestamptz,
  enviado_en      timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_socio     ON mensajes_enviados (socio_id);
CREATE INDEX idx_msg_estado    ON mensajes_enviados (estado);
CREATE INDEX idx_msg_plantilla ON mensajes_enviados (plantilla_clave);
CREATE INDEX idx_msg_creado    ON mensajes_enviados (creado_en);
-- Evita reenviar el mismo aviso ligado a la misma referencia
-- (p.ej. "recordatorio_3d" de una suscripcion, o "cumpleanos" de un socio en un anio).
CREATE UNIQUE INDEX idx_msg_dedup
  ON mensajes_enviados (socio_id, plantilla_clave, referencia_id, (COALESCE(periodo,'')))
  WHERE referencia_id IS NOT NULL AND estado <> 'fallido';


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
  END AS estado_membresia
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


-- ============================================================
--  Datos iniciales necesarios: planes, usuario admin, plantillas.
--  (Datos de PRUEBA -> ver db/seed_demo.sql, se corre aparte)
-- ============================================================

SET client_encoding = 'UTF8';

-- ---------- Planes (ajusta precios a tu gimnasio) ----------
INSERT INTO planes (nombre, descripcion, precio, duracion_dias) VALUES
  ('Pase Diario', 'Acceso por un dia',              15.00,   1),
  ('Mensual',     'Acceso ilimitado por 30 dias',  120.00,  30),
  ('Trimestral',  'Acceso ilimitado por 90 dias',  320.00,  90),
  ('Semestral',   'Acceso ilimitado por 180 dias', 600.00, 180),
  ('Anual',       'Acceso ilimitado por 365 dias',1080.00, 365);

-- ---------- Usuario administrador inicial ----------
-- La contrasena se define desde la app (password_hash queda NULL).
INSERT INTO usuarios (nombre, email, rol) VALUES
  ('Administrador', 'admin@gimnasio.local', 'admin');

-- ---------- Plantillas de mensaje ----------
INSERT INTO plantillas_mensaje (clave, descripcion, cuerpo) VALUES
  ('bienvenida',
   'Se envia al registrar un socio nuevo',
   '¡Hola {{nombres}}! 👋 Te damos la bienvenida a *Zona Fitness* 🏋️‍♂️ Tu plan *{{plan}}* está activo hasta el {{fecha_fin}}. ¡A darle con todo a los entrenamientos! Cualquier consulta estamos para ayudarte por aquí.'),

  ('pago_confirmado',
   'Se envia al registrar un pago o renovacion',
   '¡Hola {{nombres}}! Recibimos tu pago de S/ {{monto}} en *Zona Fitness* ✅ Tu plan *{{plan}}* queda activo hasta el {{fecha_fin}}. ¡A entrenar fuerte! 💪'),

  ('recordatorio_3d',
   'Aviso 3 dias antes del vencimiento',
   '¡Hola {{nombres}}! 💪 Desde *Zona Fitness* te recordamos que tu plan vence en {{dias_restantes}} días ({{fecha_fin}}). Renueva a tiempo en recepción y no cortes tu rutina 🏋️'),

  ('recordatorio_hoy',
   'Aviso el dia del vencimiento',
   '¡Hola {{nombres}}! Tu membresía en *Zona Fitness* vence *hoy* ({{fecha_fin}}) ⚠️ Acércate a recepción para renovar y seguir entrenando sin interrupciones 🙌'),

  ('vencido',
   'Aviso cuando el plan ya vencio',
   '¡Hola {{nombres}}! Tu plan en *Zona Fitness* venció el {{fecha_fin}}. Te esperamos en el gimnasio para reactivarlo cuando gustes y seguir con tus metas 🙌💪'),

  ('te_extranamos',
   'Socio activo que no asiste hace varios dias',
   '¡Hola {{nombres}}! 👋 Te extrañamos en *Zona Fitness*. Hace varios días que no te vemos por el gym. ¡La constancia es la clave, aquí te esperamos! 🏋️‍♂️'),

  ('cumpleanos',
   'Saludo de cumpleanos',
   '¡Feliz cumpleaños, {{nombres}}! 🎉🎂 Todo el equipo de *Zona Fitness* te desea un gran día lleno de energía y salud. ¡A celebrarlo!');

