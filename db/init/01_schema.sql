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
