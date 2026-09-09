'use strict';
const express = require('express');
const db = require('../db');
const { soles } = require('../util');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const caja = await db.one("SELECT * FROM v_resumen_caja WHERE estado = 'abierta' LIMIT 1");
    let pagos = [], egresos = [];
    if (caja) {
      [pagos, egresos] = await Promise.all([
        db.rows(`SELECT p.*, s.nombres, s.apellidos FROM pagos p LEFT JOIN socios s ON s.id = p.socio_id
                 WHERE p.caja_id = $1 ORDER BY p.creado_en DESC`, [caja.caja_id]),
        db.rows('SELECT * FROM egresos WHERE caja_id = $1 ORDER BY creado_en DESC', [caja.caja_id]),
      ]);
    }
    res.render('caja/index', { title: 'Caja', caja, pagos, egresos });
  } catch (e) { next(e); }
});

router.get('/historial', async (req, res, next) => {
  try {
    const cajas = await db.rows("SELECT * FROM v_resumen_caja WHERE estado = 'cerrada' ORDER BY fecha_apertura DESC LIMIT 60");
    res.render('caja/historial', { title: 'Historial de caja', cajas });
  } catch (e) { next(e); }
});

router.post('/abrir', async (req, res, next) => {
  try {
    const monto = Number(req.body.monto_apertura || 0);
    await db.query('INSERT INTO cajas (monto_apertura, abierta_por) VALUES ($1,$2)', [monto >= 0 ? monto : 0, req.session.user.nombre]);
    req.flash('ok', 'Caja abierta.');
    res.redirect('/caja');
  } catch (e) {
    if (e.code === '23505') { req.flash('error', 'Ya hay una caja abierta.'); return res.redirect('/caja'); }
    next(e);
  }
});

router.post('/egreso', async (req, res, next) => {
  try {
    const caja = await db.one("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1");
    if (!caja) { req.flash('error', 'No hay caja abierta.'); return res.redirect('/caja'); }
    const monto = Number(req.body.monto);
    if (!(monto > 0) || !req.body.concepto) { req.flash('error', 'Concepto y monto son obligatorios.'); return res.redirect('/caja'); }
    await db.query('INSERT INTO egresos (caja_id, concepto, monto, metodo_pago, registrado_por) VALUES ($1,$2,$3,$4,$5)',
      [caja.id, req.body.concepto.trim(), monto, req.body.metodo_pago || 'efectivo', req.session.user.nombre]);
    req.flash('ok', 'Egreso registrado.');
    res.redirect('/caja');
  } catch (e) { next(e); }
});

router.post('/cerrar', async (req, res, next) => {
  try {
    const caja = await db.one("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1");
    if (!caja) { req.flash('error', 'No hay caja abierta.'); return res.redirect('/caja'); }
    const real = Number(req.body.monto_cierre_real);
    if (!(real >= 0)) { req.flash('error', 'Ingresa el efectivo contado.'); return res.redirect('/caja'); }
    await db.query(
      `UPDATE cajas SET estado='cerrada', fecha_cierre=now(), monto_cierre_real=$1, cerrada_por=$2, notas=$3 WHERE id=$4`,
      [real, req.session.user.nombre, req.body.notas || null, caja.id]);
    const r = await db.one('SELECT diferencia FROM v_resumen_caja WHERE caja_id = $1', [caja.id]);
    const dif = Number(r.diferencia || 0);
    req.flash(dif === 0 ? 'ok' : 'info',
      dif === 0 ? 'Caja cerrada, cuadrada.' : `Caja cerrada. Diferencia: ${soles(dif)} (${dif > 0 ? 'sobrante' : 'faltante'}).`);
    res.redirect('/caja/historial');
  } catch (e) { next(e); }
});

module.exports = router;
