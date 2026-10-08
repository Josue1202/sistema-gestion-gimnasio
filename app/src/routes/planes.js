'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const planes = await db.rows('SELECT * FROM planes ORDER BY activo DESC, duracion_dias');
    res.render('planes/list', { title: 'Planes', planes });
  } catch (e) { next(e); }
});

router.get('/nuevo', (req, res) => {
  res.render('planes/form', { title: 'Nuevo plan', plan: {}, modo: 'nuevo' });
});

router.get('/:id/editar', async (req, res, next) => {
  try {
    const plan = await db.one('SELECT * FROM planes WHERE id = $1', [req.params.id]);
    if (!plan) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Plan no encontrado.' });
    res.render('planes/form', { title: 'Editar plan', plan, modo: 'editar' });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, descripcion, precio, duracion_dias } = req.body;
    if (!nombre || !(Number(precio) >= 0) || !(parseInt(duracion_dias, 10) > 0)) {
      req.flash('error', 'Revisa nombre, precio y duracion.'); return res.redirect('/planes/nuevo');
    }
    await db.query('INSERT INTO planes (nombre, descripcion, precio, duracion_dias) VALUES ($1,$2,$3,$4)',
      [nombre.trim(), descripcion || null, Number(precio), parseInt(duracion_dias, 10)]);
    req.flash('ok', 'Plan creado.');
    res.redirect('/planes');
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res, next) => {
  try {
    const { nombre, descripcion, precio, duracion_dias } = req.body;
    if (!nombre || !nombre.trim() || !(Number(precio) >= 0) || !(parseInt(duracion_dias, 10) > 0)) {
      req.flash('error', 'Revisa nombre, precio y duración.');
      return res.redirect('/planes/' + req.params.id + '/editar');
    }
    await db.query('UPDATE planes SET nombre=$1, descripcion=$2, precio=$3, duracion_dias=$4 WHERE id=$5',
      [nombre.trim(), descripcion || null, Number(precio), parseInt(duracion_dias, 10), req.params.id]);
    req.flash('ok', 'Plan actualizado.');
    res.redirect('/planes');
  } catch (e) { next(e); }
});

router.post('/:id/toggle', async (req, res, next) => {
  try {
    await db.query('UPDATE planes SET activo = NOT activo WHERE id = $1', [req.params.id]);
    res.redirect('/planes');
  } catch (e) { next(e); }
});

module.exports = router;
