-- ============================================================
--  DATOS DE PRUEBA (opcional). NO se ejecuta solo.
--  Para cargarlos:
--    docker compose exec -T postgres psql -U gym -d gym < db/seed_demo.sql
--  Para borrarlos:  db/demo_cleanup.sql
-- ============================================================

INSERT INTO socios (id, nombres, apellidos, dni, telefono, email, fecha_nacimiento, genero, notas) VALUES
  ('11111111-1111-1111-1111-111111111111','Ana','Torres','40000001','51900000001','ana@example.com','1995-09-12','F','DEMO'),
  ('22222222-2222-2222-2222-222222222222','Luis','Ramirez','40000002','51900000002',NULL,'1990-03-05','M','DEMO'),
  ('33333333-3333-3333-3333-333333333333','Maria','Salas','40000003','51900000003',NULL,'2000-06-20','F','DEMO');

-- Ana: vence en 3 dias (aparece en recordatorio_3d)
INSERT INTO suscripciones (socio_id, plan_id, fecha_inicio, fecha_fin, precio_pagado, estado, creado_por)
SELECT '11111111-1111-1111-1111-111111111111', id, CURRENT_DATE - 27, CURRENT_DATE + 3, precio, 'activa', 'seed'
FROM planes WHERE nombre = 'Mensual';

-- Luis: vencido hace 10 dias (aparece en v_socios_vencidos)
INSERT INTO suscripciones (socio_id, plan_id, fecha_inicio, fecha_fin, precio_pagado, estado, creado_por)
SELECT '22222222-2222-2222-2222-222222222222', id, CURRENT_DATE - 40, CURRENT_DATE - 10, precio, 'activa', 'seed'
FROM planes WHERE nombre = 'Mensual';

-- Maria: al dia, plan trimestral
INSERT INTO suscripciones (socio_id, plan_id, fecha_inicio, fecha_fin, precio_pagado, estado, creado_por)
SELECT '33333333-3333-3333-3333-333333333333', id, CURRENT_DATE - 5, CURRENT_DATE + 85, precio, 'activa', 'seed'
FROM planes WHERE nombre = 'Trimestral';

-- Caja abierta + un pago por cada suscripcion demo
INSERT INTO cajas (id, monto_apertura, abierta_por) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100.00, 'seed');

INSERT INTO pagos (socio_id, suscripcion_id, caja_id, concepto, monto, metodo_pago, registrado_por)
SELECT su.socio_id, su.id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'Renovacion plan', su.precio_pagado,
       (ARRAY['efectivo','yape','plin'])[1 + floor(random()*3)::int], 'seed'
FROM suscripciones su
WHERE su.creado_por = 'seed';

-- Asistencias: Ana viene seguido, Maria a veces, Luis nunca (queda "en riesgo")
INSERT INTO asistencias (socio_id, fecha, metodo)
SELECT '11111111-1111-1111-1111-111111111111', now() - (n || ' days')::interval, 'manual'
FROM generate_series(0, 6) AS n;

INSERT INTO asistencias (socio_id, fecha, metodo)
SELECT '33333333-3333-3333-3333-333333333333', now() - (n || ' days')::interval, 'qr'
FROM generate_series(0, 3) AS n;
