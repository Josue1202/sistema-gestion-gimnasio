'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const plantillas = await db.rows('SELECT * FROM plantillas_mensaje ORDER BY clave');
    res.render('plantillas/list', { title: 'Plantillas', plantillas });
  } catch (e) { next(e); }
});

router.get('/nueva', (req, res) => {
  res.render('plantillas/form', { title: 'Nueva plantilla', p: { canal: 'whatsapp', activo: true }, modo: 'nuevo' });
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const p = await db.one('SELECT * FROM plantillas_mensaje WHERE id = $1', [req.params.id]);
    if (!p) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Plantilla no encontrada.' });
    res.render('plantillas/form', { title: 'Editar plantilla', p, modo: 'editar' });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { clave, descripcion, canal, asunto, cuerpo } = req.body;
    if (!clave || !cuerpo) { req.flash('error', 'Clave y cuerpo son obligatorios.'); return res.redirect('/plantillas/nueva'); }
    await db.query(
      'INSERT INTO plantillas_mensaje (clave, descripcion, canal, asunto, cuerpo) VALUES ($1,$2,$3,$4,$5)',
      [clave.trim(), descripcion || null, canal || 'whatsapp', asunto || null, cuerpo]);
    req.flash('ok', 'Plantilla creada.');
    res.redirect('/plantillas');
  } catch (e) {
    if (e.code === '23505') { req.flash('error', 'Ya existe una plantilla con esa clave.'); return res.redirect('/plantillas/nueva'); }
    next(e);
  }
});

router.post('/:id', async (req, res, next) => {
  try {
    const { descripcion, canal, asunto, cuerpo } = req.body;
    const activo = req.body.activo === 'on';
    await db.query(
      'UPDATE plantillas_mensaje SET descripcion=$1, canal=$2, asunto=$3, cuerpo=$4, activo=$5 WHERE id=$6',
      [descripcion || null, canal || 'whatsapp', asunto || null, cuerpo, activo, req.params.id]);
    req.flash('ok', 'Plantilla actualizada.');
    res.redirect('/plantillas');
  } catch (e) { next(e); }
});

module.exports = router;
