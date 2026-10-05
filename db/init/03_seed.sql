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

