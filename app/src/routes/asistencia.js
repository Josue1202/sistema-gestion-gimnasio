'use strict';
const express = require('express');
const db = require('../db');
const { fecha } = require('../util');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const tz = process.env.TZ || 'America/Lima';
    const q = (req.query.q || '').trim();
    let encontrados = [];
    if (q) {
      encontrados = await db.rows(
        `SELECT id, nombres, apellidos, dni, telefono, plan_nombre, fecha_fin, dias_restantes, estado_membresia
         FROM v_socios_estado
         WHERE nombres ILIKE $1 OR apellidos ILIKE $1 OR dni ILIKE $1 OR telefono ILIKE $1
         ORDER BY apellidos, nombres LIMIT 15`, ['%' + q + '%']);
    }

    const [hoy, productos, ventasHoy, caja] = await Promise.all([
      db.rows(
        `SELECT a.fecha, a.metodo, s.id AS socio_id, s.nombres, s.apellidos, s.dni,
                p.nombre AS plan_nombre, su.fecha_fin, su.estado AS estado_sub
         FROM asistencias a
         JOIN socios s ON s.id = a.socio_id
         LEFT JOIN suscripciones su ON su.id = a.suscripcion_id
         LEFT JOIN planes p ON p.id = su.plan_id
         WHERE (a.fecha AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
         ORDER BY a.fecha DESC LIMIT 50`, [tz]),

      db.rows(
        `SELECT id, nombre, precio, stock
         FROM productos
         WHERE activo = true
         ORDER BY nombre`
      ),

      db.rows(
        `SELECT pg.id, pg.monto, pg.metodo_pago, pg.creado_en, pg.concepto,
                s.id AS socio_id, s.nombres, s.apellidos, s.dni,
                COALESCE(s.nombres || ' ' || s.apellidos, 'Cliente General') AS comprador,
                (SELECT json_agg(json_build_object('nombre', pr.nombre, 'cantidad', vp.cantidad, 'precio', vp.precio_unitario))
                 FROM venta_productos vp JOIN productos pr ON pr.id = vp.producto_id WHERE vp.pago_id = pg.id) AS items
         FROM pagos pg
         LEFT JOIN socios s ON s.id = pg.socio_id
         WHERE EXISTS (SELECT 1 FROM venta_productos WHERE pago_id = pg.id)
           AND (pg.creado_en AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
         ORDER BY pg.creado_en DESC LIMIT 20`, [tz]),

      db.one("SELECT * FROM v_resumen_caja WHERE estado = 'abierta' LIMIT 1"),
    ]);

    const ultimoCheckin = req.session.ultimoCheckin || null;
    req.session.ultimoCheckin = null;

    res.render('asistencia/index', {
      title: 'Terminal de Recepción & POS',
      q,
      encontrados,
      hoy,
      productos,
      ventasHoy,
      caja,
      ultimoCheckin,
    });
  } catch (e) { next(e); }
});

// Marcado rápido por DNI, teléfono o selección directa
router.post('/marcar', async (req, res, next) => {
  try {
    const { dni, socio_id, q } = req.body;
    let socio = null;

    if (socio_id) {
      socio = await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [socio_id]);
    } else if (dni && dni.trim()) {
      const term = dni.trim();
      // Buscar primero por DNI exacto
      socio = await db.one('SELECT * FROM v_socios_estado WHERE dni = $1 LIMIT 1', [term]);
      if (!socio) {
        // Buscar por teléfono
        socio = await db.one('SELECT * FROM v_socios_estado WHERE telefono LIKE $1 LIMIT 1', ['%' + term]);
      }
      if (!socio) {
        // Si no, buscar coincidencia por nombre
        const matches = await db.rows(
          `SELECT * FROM v_socios_estado
           WHERE nombres ILIKE $1 OR apellidos ILIKE $1 OR dni ILIKE $1
           LIMIT 5`, ['%' + term + '%']);
        if (matches.length === 1) {
          socio = matches[0];
        } else if (matches.length > 1) {
          if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ ok: false, multiple: true, matches });
          }
          req.flash('info', `Hay varios socios coincidentes con "${term}". Selecciona uno en la lista.`);
          return res.redirect('/asistencia?q=' + encodeURIComponent(term));
        }
      }
    }

    if (!socio) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.json({ ok: false, error: 'Socio no encontrado. Verifica el DNI.' });
      }
      req.flash('error', 'Socio no encontrado. Verifica el DNI o regístralo como nuevo.');
      return res.redirect('/asistencia' + (q ? '?q=' + encodeURIComponent(q) : ''));
    }

    // Buscar suscripcion activa mas reciente
    const sub = await db.one(
      `SELECT su.*, p.nombre AS plan_nombre
       FROM suscripciones su
       JOIN planes p ON p.id = su.plan_id
       WHERE su.socio_id = $1 AND su.estado = 'activa' AND su.fecha_fin >= CURRENT_DATE
       ORDER BY su.fecha_fin DESC LIMIT 1`, [socio.id]);

    const metodo = req.body.metodo || (dni ? 'dni' : 'manual');

    // Registrar asistencia
    await db.query(
      `INSERT INTO asistencias (socio_id, suscripcion_id, metodo, registrado_por)
       VALUES ($1, $2, $3, $4)`,
      [socio.id, sub ? sub.id : null, metodo, req.session.user.nombre]);

    let estado = 'sin_suscripcion';
    let diasRestantes = null;
    let fechaFinTxt = null;

    if (sub) {
      const hoy = new Date();
      const fin = new Date(sub.fecha_fin);
      diasRestantes = Math.ceil((fin - hoy) / (1000 * 60 * 60 * 24));
      fechaFinTxt = fecha(sub.fecha_fin);
      estado = (diasRestantes <= 7) ? 'por_vencer' : 'activo';
    } else if (socio.estado_membresia === 'vencido') {
      estado = 'vencido';
      fechaFinTxt = socio.fecha_fin ? fecha(socio.fecha_fin) : null;
    }

    const resultado = {
      ok: true,
      socio_id: socio.id,
      nombre: `${socio.nombres} ${socio.apellidos}`,
      dni: socio.dni || 'Sin DNI',
      telefono: socio.telefono || '',
      estado,
      plan: sub ? sub.plan_nombre : (socio.plan_nombre || 'Sin plan'),
      fecha_fin: fechaFinTxt,
      dias_restantes: diasRestantes,
      hora: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    };

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json(resultado);
    }

    req.session.ultimoCheckin = resultado;
    res.redirect('/asistencia');
  } catch (e) { next(e); }
});

// Compatibilidad con ruta anterior POST /
router.post('/', (req, res, next) => {
  req.url = '/marcar';
  router.handle(req, res, next);
});

module.exports = router;
