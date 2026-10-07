'use strict';
const express = require('express');
const db = require('../db');
const { hoyISO, addDias, dateToISO, postWebhook, sendEvolutionWhatsApp, waLink, fecha, fechaHora, soles } = require('../util');
const { notificarPagoConfirmado } = require('../cron');

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
      const fin = dateToISO(actual.fecha_fin);
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

    // Notificación automática nativa por WhatsApp
    notificarPagoConfirmado({
      socio_id: socio.id,
      nombres: socio.nombres,
      apellidos: socio.apellidos,
      telefono: socio.telefono,
      plan: plan.nombre,
      monto: precio,
      metodo_pago: metodo,
      fecha_fin: fin,
      fecha_fin_txt: fecha(fin),
    }).catch((err) => console.warn('[suscripciones] error en notificarPagoConfirmado:', err.message));

    // Aviso a webhook n8n si esta activo
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

    req.flash('ok', `Pago registrado: ${plan.nombre} (${soles(precio)}). Vence ${fecha(fin)}.`);
    res.redirect('/suscripciones/' + result.sub.id + '/ticket?nuevo=1');
  } catch (e) { next(e); }
});

// ---------- Ver / Imprimir Ticket de Pago ----------
router.get('/:id/ticket', async (req, res, next) => {
  try {
    const sub = await db.one(
      `SELECT su.*, p.nombre AS plan_nombre, p.duracion_dias,
              s.nombres, s.apellidos, s.dni, s.telefono, s.email
       FROM suscripciones su
       JOIN socios s ON s.id = su.socio_id
       JOIN planes p ON p.id = su.plan_id
       WHERE su.id = $1`, [req.params.id]);

    if (!sub) {
      req.flash('error', 'Suscripción no encontrada.');
      return res.redirect('/dashboard');
    }

    const pago = await db.one('SELECT * FROM pagos WHERE suscripcion_id = $1 ORDER BY creado_en DESC LIMIT 1', [sub.id]);

    const gymNombre = res.locals.gymName || 'Gimnasio';
    const textoWhatsApp = `¡Hola ${sub.nombres}! 🏋️\nComprobante de pago en *${gymNombre}*:\n` +
      `• Plan: *${sub.plan_nombre}*\n` +
      `• Válido: ${fecha(sub.fecha_inicio)} al ${fecha(sub.fecha_fin)}\n` +
      `• Monto pagado: *${soles(sub.precio_pagado)}* (${pago ? pago.metodo_pago.toUpperCase() : 'EFECTIVO'})\n` +
      `• Fecha de pago: ${fechaHora(pago ? pago.creado_en : sub.creado_en)}\n\n` +
      `¡Gracias por entrenar con nosotros! 💪`;

    const waHref = sub.telefono ? waLink(sub.telefono, textoWhatsApp) : null;

    res.render('suscripciones/ticket', {
      title: 'Comprobante de Pago',
      sub,
      pago,
      esNuevo: req.query.nuevo === '1',
      textoWhatsApp,
      waHref,
    });
  } catch (e) { next(e); }
});

// ---------- Enviar Ticket por WhatsApp Directo ----------
router.post('/:id/enviar-ticket', async (req, res, next) => {
  try {
    const sub = await db.one(
      `SELECT su.*, p.nombre AS plan_nombre, s.nombres, s.apellidos, s.telefono
       FROM suscripciones su
       JOIN socios s ON s.id = su.socio_id
       JOIN planes p ON p.id = su.plan_id
       WHERE su.id = $1`, [req.params.id]);

    if (!sub || !sub.telefono) {
      req.flash('error', 'El socio no tiene un teléfono registrado.');
      return res.redirect('/suscripciones/' + req.params.id + '/ticket');
    }

    const pago = await db.one('SELECT * FROM pagos WHERE suscripcion_id = $1 ORDER BY creado_en DESC LIMIT 1', [sub.id]);
    const gymNombre = res.locals.gymName || 'Gimnasio';
    const texto = `¡Hola ${sub.nombres}! 🏋️\nComprobante de pago en *${gymNombre}*:\n` +
      `• Plan: *${sub.plan_nombre}*\n` +
      `• Vigencia: ${fecha(sub.fecha_inicio)} al ${fecha(sub.fecha_fin)}\n` +
      `• Monto: *${soles(sub.precio_pagado)}* (${pago ? pago.metodo_pago.toUpperCase() : 'EFECTIVO'})\n` +
      `• Registrado: ${fechaHora(pago ? pago.creado_en : sub.creado_en)}\n\n` +
      `¡A entrenar con todo! 💪`;

    const r = await sendEvolutionWhatsApp(sub.telefono, texto);
    if (r.ok) {
      req.flash('ok', 'Comprobante enviado a WhatsApp exitosamente.');
    } else {
      req.flash('info', 'No se pudo enviar automáticamente (' + (r.error || 'WhatsApp desconectado') + '). Puedes enviarlo con el botón de WhatsApp Web.');
    }
    res.redirect('/suscripciones/' + sub.id + '/ticket');
  } catch (e) { next(e); }
});

module.exports = router;
