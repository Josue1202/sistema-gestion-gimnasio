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
   'Hola {{nombres}} 👋 Bienvenido/a al gimnasio! Tu plan *{{plan}}* esta activo hasta el {{fecha_fin}}. Cualquier duda escribenos por aqui.'),

  ('pago_confirmado',
   'Se envia al registrar un pago o renovacion',
   'Hola {{nombres}}, recibimos tu pago de S/ {{monto}} ✅ Tu plan *{{plan}}* queda vigente hasta el {{fecha_fin}}. Gracias!'),

  ('recordatorio_3d',
   'Aviso 3 dias antes del vencimiento',
   'Hola {{nombres}} 💪 Tu plan vence en {{dias_restantes}} dias ({{fecha_fin}}). Renueva a tiempo y no cortes tu rutina.'),

  ('recordatorio_hoy',
   'Aviso el dia del vencimiento',
   'Hola {{nombres}}, tu plan vence *hoy* ({{fecha_fin}}). Acercate a recepcion o escribenos para renovar.'),

  ('vencido',
   'Aviso cuando el plan ya vencio',
   'Hola {{nombres}}, tu plan vencio el {{fecha_fin}}. Te esperamos para reactivarlo cuando quieras 🙌'),

  ('te_extranamos',
   'Socio activo que no asiste hace varios dias',
   'Hola {{nombres}}, te extranamos en el gym! Hace unos dias que no te vemos. Aqui seguimos esperandote 💪'),

  ('cumpleanos',
   'Saludo de cumpleanos',
   'Feliz cumpleanos, {{nombres}}! 🎉 Todo el equipo del gimnasio te desea un gran dia.');
