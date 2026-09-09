'use strict';
const express = require('express');
const db = require('../db');
const { hoyISO, addDias, postWebhook, fecha, soles } = require('../util');

const router = express.Router();

// ---------- Form nueva / renovacion ----------
router.get('/nueva', async (req, res, next) => {
  try {
    const socioId = req.query.socio;
    const socio = socioId ? await db.one('SELECT * FROM socios WHERE id = $1', [socioId]) : null;
    if (!socio) { req.flash('error', 'Selecciona un socio primero.'); return res.redirect('/socios'); }
    const [planes, actual, caja] = await Promise.all([
      db.rows('SELECT id, nombre, precio, duracion_dias FROM planes WHERE activo = true ORDER BY duracion_dias'),
      db.one(`SELECT su.*, p.nombre AS plan_nombre FROM suscripciones su JOIN planes p ON p.id = su.plan_id
              WHERE su.socio_id = $1 AND su.estado = 'activa' ORDER BY su.fecha_fin DESC LIMIT 1`, [socio.id]),
      db.one("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1"),
    ]);
    // Sugerencia de inicio: si sigue vigente, arranca al dia siguiente del vencimiento; si no, hoy.
    let inicio = hoyISO();
    if (actual && actual.fecha_fin) {
      const fin = (actual.fecha_fin instanceof Date) ? actual.fecha_fin.toISOString().slice(0, 10) : String(actual.fecha_fin).slice(0, 10);
      if (fin >= hoyISO()) inicio = addDias(fin, 1);
    }
    res.render('suscripciones/form', {
      title: 'Renovar · ' + socio.nombres,
      socio, planes, actual, inicio,
      cajaAbierta: !!caja,
      planesJson: JSON.stringify(planes.map((p) => ({ id: p.id, precio: Number(p.precio), dias: p.duracion_dias }))),
    });
  } catch (e) { next(e); }
});

// ---------- Guardar ----------
router.post('/', async (req, res, next) => {
  try {
    const b = req.body;
    const socio = await db.one('SELECT * FROM socios WHERE id = $1', [b.socio_id]);
    if (!socio) { req.flash('error', 'Socio no encontrado.'); return res.redirect('/socios'); }
    const plan = await db.one('SELECT * FROM planes WHERE id = $1', [b.plan_id]);
    if (!plan) { req.flash('error', 'Selecciona un plan valido.'); return res.redirect('/suscripciones/nueva?socio=' + socio.id); }

    const inicio = b.fecha_inicio || hoyISO();
    const fin = b.fecha_fin || addDias(inicio, plan.duracion_dias);
    const precio = (b.precio_pagado === '' || b.precio_pagado == null) ? Number(plan.precio) : Number(b.precio_pagado);
    if (!(precio >= 0)) { req.flash('error', 'Monto invalido.'); return res.redirect('/suscripciones/nueva?socio=' + socio.id); }
    const metodo = b.metodo_pago || 'efectivo';

    const result = await db.withTx(async (c) => {
      const sub = (await c.query(
        `INSERT INTO suscripciones (socio_id, plan_id, fecha_inicio, fecha_fin, precio_pagado, estado, creado_por)
         VALUES ($1,$2,$3,$4,$5,'activa',$6) RETURNING *`,
        [socio.id, plan.id, inicio, fin, precio, req.session.user.nombre])).rows[0];

      const caja = (await c.query("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1")).rows[0];

      let pago = null;
      if (precio > 0) {
        pago = (await c.query(
          `INSERT INTO pagos (socio_id, suscripcion_id, caja_id, concepto, monto, metodo_pago, referencia, registrado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [socio.id, sub.id, caja ? caja.id : null, 'Plan ' + plan.nombre, precio, metodo, b.referencia || null, req.session.user.nombre])).rows[0];
      }
      return { sub, pago };
    });

    if (b.marcar_asistencia === 'on') {
      await db.query('INSERT INTO asistencias (socio_id, suscripcion_id, metodo, registrado_por) VALUES ($1,$2,$3,$4)',
        [socio.id, result.sub.id, 'manual', req.session.user.nombre]);
    }

    // Aviso a n8n (best-effort). n8n decide si manda "pago_confirmado".
    postWebhook('pago', {
      evento: 'pago_registrado',
      socio_id: socio.id,
      nombres: socio.nombres,
      apellidos: socio.apellidos,
      telefono: socio.telefono,
      plan: plan.nombre,
      monto: precio,
      metodo_pago: metodo,
      fecha_fin: fin,
      fecha_fin_txt: fecha(fin),
    });

    req.flash('ok', `Renovacion registrada: ${plan.nombre}, ${soles(precio)}. Vence ${fecha(fin)}.`);
    res.redirect('/socios/' + socio.id);
  } catch (e) { next(e); }
});

module.exports = router;
