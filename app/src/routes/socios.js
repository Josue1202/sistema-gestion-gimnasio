'use strict';
const express = require('express');
const db = require('../db');
const { plantillasMap, varsDe } = require('../mensajeria');
const { renderPlantilla, waLink, hoyISO, normalizarTelefono, sendEvolutionWhatsApp } = require('../util');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limpiarSocio(b) {
  const s = (v) => (v == null || String(v).trim() === '') ? null : String(v).trim();
  const tel = (v) => { const n = normalizarTelefono(v); return n ? n : null; };
  return {
    nombres: s(b.nombres), apellidos: s(b.apellidos), dni: s(b.dni),
    telefono: tel(b.telefono), email: s(b.email),
    fecha_nacimiento: s(b.fecha_nacimiento), genero: s(b.genero),
    direccion: s(b.direccion),
    contacto_emergencia_nombre: s(b.contacto_emergencia_nombre),
    contacto_emergencia_telefono: tel(b.contacto_emergencia_telefono),
    notas: s(b.notas),
    acepta_marketing: b.acepta_marketing === 'on' || b.acepta_marketing === 'true',
  };
}

// ---------- Listado ----------
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const estado = (req.query.estado || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = 50;
    const params = [];
    const where = [];
    if (q) {
      params.push('%' + q + '%');
      where.push(`(nombres ILIKE $${params.length} OR apellidos ILIKE $${params.length} OR dni ILIKE $${params.length} OR telefono ILIKE $${params.length})`);
    }
    if (estado === 'por_vencer') {
      where.push(`estado_membresia = 'activo' AND dias_restantes BETWEEN 0 AND 7`);
    } else if (['activo', 'vencido', 'congelado', 'sin_suscripcion'].includes(estado)) {
      params.push(estado);
      where.push(`estado_membresia = $${params.length}`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(limit, (page - 1) * limit);
    const socios = await db.rows(
      `SELECT * FROM v_socios_estado ${whereSql}
       ORDER BY apellidos, nombres
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const total = await db.one(`SELECT count(*)::int AS n FROM v_socios_estado ${whereSql}`, params.slice(0, params.length - 2));
    res.render('socios/list', { title: 'Socios', socios, q, estado, page, hayMas: socios.length === limit, total: total.n });
  } catch (e) { next(e); }
});

// ---------- Nuevo ----------
router.get('/nuevo', (req, res) => {
  res.render('socios/form', { title: 'Nuevo socio', socio: { acepta_marketing: true }, modo: 'nuevo' });
});

router.post('/', async (req, res, next) => {
  try {
    const d = limpiarSocio(req.body);
    if (!d.nombres || !d.apellidos) { req.flash('error', 'Nombres y apellidos son obligatorios.'); return res.redirect('/socios/nuevo'); }
    const row = await db.one(
      `INSERT INTO socios (nombres, apellidos, dni, telefono, email, fecha_nacimiento, genero, direccion,
        contacto_emergencia_nombre, contacto_emergencia_telefono, notas, acepta_marketing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [d.nombres, d.apellidos, d.dni, d.telefono, d.email, d.fecha_nacimiento, d.genero, d.direccion,
       d.contacto_emergencia_nombre, d.contacto_emergencia_telefono, d.notas, d.acepta_marketing]);
    req.flash('ok', 'Socio registrado.');
    res.redirect('/socios/' + row.id + '?nuevo=1');
  } catch (e) {
    if (e.code === '23505') { req.flash('error', 'Ya existe un socio con ese DNI.'); return res.redirect('/socios/nuevo'); }
    next(e);
  }
});

// ---------- Detalle ----------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Socio no encontrado.' });
    const socio = await db.one('SELECT * FROM socios WHERE id = $1', [id]);
    if (!socio) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Socio no encontrado.' });
    const [estado, subs, pagos, asistencias, planes, plantillas, cajaAbierta] = await Promise.all([
      db.one('SELECT * FROM v_socios_estado WHERE id = $1', [id]),
      db.rows(`SELECT su.*, p.nombre AS plan_nombre FROM suscripciones su JOIN planes p ON p.id = su.plan_id
               WHERE su.socio_id = $1 ORDER BY su.fecha_inicio DESC, su.creado_en DESC`, [id]),
      db.rows('SELECT * FROM pagos WHERE socio_id = $1 ORDER BY creado_en DESC LIMIT 50', [id]),
      db.rows('SELECT * FROM asistencias WHERE socio_id = $1 ORDER BY fecha DESC LIMIT 20', [id]),
      db.rows('SELECT * FROM planes WHERE activo = true ORDER BY duracion_dias'),
      plantillasMap(),
      db.one("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1"),
    ]);
    const filaMsg = Object.assign({}, socio, estado || {});
    const links = {};
    const plantillasDisponibles = [];
    ['bienvenida', 'pago_confirmado', 'recordatorio_3d', 'recordatorio_hoy', 'vencido', 'te_extranamos', 'cumpleanos'].forEach((clave) => {
      const p = plantillas[clave];
      if (p) {
        const texto = renderPlantilla(p.cuerpo, varsDe(filaMsg));
        const link = socio.telefono ? waLink(socio.telefono, texto) : null;
        links[clave] = link;
        plantillasDisponibles.push({
          clave,
          titulo: p.descripcion || clave.replace(/_/g, ' '),
          cuerpo: texto,
          link,
        });
      }
    });
    res.render('socios/detail', {
      title: socio.nombres + ' ' + socio.apellidos,
      socio, estado: estado || {}, subs, pagos, asistencias, planes, links, plantillasDisponibles,
      cajaAbierta: !!cajaAbierta, hoy: hoyISO(), esNuevo: req.query.nuevo === '1',
    });
  } catch (e) { next(e); }
});

// ---------- Editar ----------
router.get('/:id/editar', async (req, res, next) => {
  try {
    const socio = await db.one('SELECT * FROM socios WHERE id = $1', [req.params.id]);
    if (!socio) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Socio no encontrado.' });
    if (socio.fecha_nacimiento instanceof Date) socio.fecha_nacimiento = socio.fecha_nacimiento.toISOString().slice(0, 10);
    res.render('socios/form', { title: 'Editar socio', socio, modo: 'editar' });
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res, next) => {
  try {
    const d = limpiarSocio(req.body);
    if (!d.nombres || !d.apellidos) { req.flash('error', 'Nombres y apellidos son obligatorios.'); return res.redirect('/socios/' + req.params.id + '/editar'); }
    await db.query(
      `UPDATE socios SET nombres=$1, apellidos=$2, dni=$3, telefono=$4, email=$5, fecha_nacimiento=$6,
        genero=$7, direccion=$8, contacto_emergencia_nombre=$9, contacto_emergencia_telefono=$10,
        notas=$11, acepta_marketing=$12 WHERE id=$13`,
      [d.nombres, d.apellidos, d.dni, d.telefono, d.email, d.fecha_nacimiento, d.genero, d.direccion,
       d.contacto_emergencia_nombre, d.contacto_emergencia_telefono, d.notas, d.acepta_marketing, req.params.id]);
    req.flash('ok', 'Datos actualizados.');
    res.redirect('/socios/' + req.params.id);
  } catch (e) {
    if (e.code === '23505') { req.flash('error', 'Ya existe un socio con ese DNI.'); return res.redirect('/socios/' + req.params.id + '/editar'); }
    next(e);
  }
});

// ---------- Baja logica ----------
router.post('/:id/baja', async (req, res, next) => {
  try {
    await db.query('UPDATE socios SET activo = false WHERE id = $1', [req.params.id]);
    req.flash('ok', 'Socio dado de baja.');
    res.redirect('/socios');
  } catch (e) { next(e); }
});

// ---------- Marcar asistencia desde el detalle ----------
router.post('/:id/asistencia', async (req, res, next) => {
  try {
    const sub = await db.one(
      `SELECT id FROM suscripciones WHERE socio_id = $1 AND estado = 'activa' AND fecha_fin >= CURRENT_DATE
       ORDER BY fecha_fin DESC LIMIT 1`, [req.params.id]);
    await db.query('INSERT INTO asistencias (socio_id, suscripcion_id, metodo, registrado_por) VALUES ($1,$2,$3,$4)',
      [req.params.id, sub ? sub.id : null, 'manual', req.session.user.nombre]);
    req.flash(sub ? 'ok' : 'info', sub ? 'Asistencia registrada.' : 'Asistencia registrada (sin suscripcion vigente).');
    res.redirect('/socios/' + req.params.id);
  } catch (e) { next(e); }
});

// ---------- Enviar WhatsApp Directo desde el detalle ----------
router.post('/:id/enviar-whatsapp', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { clave } = req.body;
    const socio = await db.one('SELECT * FROM socios WHERE id = $1', [id]);
    if (!socio) {
      req.flash('error', 'Socio no encontrado.');
      return res.redirect('/socios');
    }
    if (!socio.telefono) {
      req.flash('error', 'El socio no tiene un teléfono registrado.');
      return res.redirect('/socios/' + id);
    }
    const [estado, plantillas] = await Promise.all([
      db.one('SELECT * FROM v_socios_estado WHERE id = $1', [id]),
      plantillasMap(),
    ]);
    const p = plantillas[clave];
    if (!p) {
      req.flash('error', 'Plantilla de mensaje no encontrada: ' + clave);
      return res.redirect('/socios/' + id);
    }
    const filaMsg = Object.assign({}, socio, estado || {});
    const texto = renderPlantilla(p.cuerpo, varsDe(filaMsg));

    const result = await sendEvolutionWhatsApp(socio.telefono, texto);
    if (result.ok) {
      await db.query(
        `INSERT INTO mensajes_enviados (socio_id, telefono, canal, plantilla_clave, contenido, estado, enviado_en, referencia_tipo)
         VALUES ($1, $2, 'whatsapp', $3, $4, 'enviado', now(), 'manual')`,
        [socio.id, socio.telefono, clave, texto]
      );
      req.flash('ok', `Mensaje "${clave.replace(/_/g, ' ')}" enviado exitosamente por WhatsApp a ${socio.nombres}.`);
    } else {
      await db.query(
        `INSERT INTO mensajes_enviados (socio_id, telefono, canal, plantilla_clave, contenido, estado, error, enviado_en, referencia_tipo)
         VALUES ($1, $2, 'whatsapp', $3, $4, 'fallido', $5, now(), 'manual')`,
        [socio.id, socio.telefono, clave, texto, result.error || 'Error desconocido']
      );
      req.flash('error', `No se pudo enviar por WhatsApp: ${result.error || 'Desconectado'}`);
    }
    res.redirect('/socios/' + id);
  } catch (e) { next(e); }
});

module.exports = router;

