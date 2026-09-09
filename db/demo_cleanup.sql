-- ============================================================
--  Borra los datos de prueba cargados por db/seed_demo.sql
--    docker compose exec -T postgres psql -U gym -d gym < db/demo_cleanup.sql
-- ============================================================

DELETE FROM asistencias  WHERE socio_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');

DELETE FROM pagos         WHERE registrado_por = 'seed';
DELETE FROM suscripciones  WHERE creado_por = 'seed';
DELETE FROM cajas          WHERE abierta_por = 'seed';
DELETE FROM socios         WHERE notas = 'DEMO';
