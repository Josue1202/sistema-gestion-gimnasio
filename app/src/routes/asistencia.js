'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    let encontrados = [];
    if (q) {
      encontrados = await db.rows(
        `SELECT id, nombres, apellidos, dni, telefono, plan_nombre, fecha_fin, dias_restantes, estado_membresia
         FROM v_socios_estado
         WHERE nombres ILIKE $1 OR apellidos ILIKE $1 OR dni ILIKE $1 OR telefono ILIKE $1
         ORDER BY apellidos, nombres LIMIT 15`, ['%' + q + '%']);
    }
    const hoy = await db.rows(
      `SELECT a.fecha, a.metodo, s.id AS socio_id, s.nombres, s.apellidos
       FROM asistencias a JOIN socios s ON s.id = a.socio_id
       WHERE (a.fecha AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
       ORDER BY a.fecha DESC`, [process.env.TZ || 'America/Lima']);
    res.render('asistencia/index', { title: 'Asistencia', q, encontrados, hoy });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const socio = await db.one('SELECT * FROM socios WHERE id = $1 AND activo = true', [req.body.socio_id]);
    if (!socio) { req.flash('error', 'Socio no encontrado.'); return res.redirect('/asistencia'); }
    const sub = await db.one(
      `SELECT id, fecha_fin FROM suscripciones WHERE socio_id = $1 AND estado = 'activa' AND fecha_fin >= CURRENT_DATE
       ORDER BY fecha_fin DESC LIMIT 1`, [socio.id]);
    await db.query('INSERT INTO asistencias (socio_id, suscripcion_id, metodo, registrado_por) VALUES ($1,$2,$3,$4)',
      [socio.id, sub ? sub.id : null, req.body.metodo || 'manual', req.session.user.nombre]);
    if (sub) req.flash('ok', `${socio.nombres} ${socio.apellidos}: asistencia registrada. Plan vigente hasta ${new Date(sub.fecha_fin).toLocaleDateString('es-PE')}.`);
    else req.flash('info', `${socio.nombres} ${socio.apellidos}: asistencia registrada, pero NO tiene plan vigente.`);
    res.redirect('/asistencia' + (req.body.q ? '?q=' + encodeURIComponent(req.body.q) : ''));
  } catch (e) { next(e); }
});

module.exports = router;
