'use strict';
const express = require('express');
const db = require('../db');
const { soles } = require('../util');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const productos = await db.rows('SELECT * FROM productos ORDER BY activo DESC, nombre');
    const ventas = await db.rows(
      `SELECT vp.*, pr.nombre, pg.creado_en, pg.metodo_pago
       FROM venta_productos vp
       JOIN productos pr ON pr.id = vp.producto_id
       JOIN pagos pg ON pg.id = vp.pago_id
       ORDER BY pg.creado_en DESC LIMIT 20`);
    res.render('productos/list', { title: 'Productos', productos, ventas });
  } catch (e) { next(e); }
});

router.get('/nuevo', (req, res) => res.render('productos/form', { title: 'Nuevo producto', producto: {}, modo: 'nuevo' }));

router.get('/:id/editar', async (req, res, next) => {
  try {
    const producto = await db.one('SELECT * FROM productos WHERE id = $1', [req.params.id]);
    if (!producto) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Producto no encontrado.' });
    res.render('productos/form', { title: 'Editar producto', producto, modo: 'editar' });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { nombre, precio, costo, stock } = req.body;
    if (!nombre || !(Number(precio) >= 0)) { req.flash('error', 'Nombre y precio son obligatorios.'); return res.redirect('/productos/nuevo'); }
    await db.query('INSERT INTO productos (nombre, precio, costo, stock) VALUES ($1,$2,$3,$4)',
      [nombre.trim(), Number(precio), costo ? Number(costo) : null, parseInt(stock, 10) || 0]);
    req.flash('ok', 'Producto creado.');
    res.redirect('/productos');
  } catch (e) { next(e); }
});

router.post('/:id', async (req, res, next) => {
  try {
    const { nombre, precio, costo, stock } = req.body;
    await db.query('UPDATE productos SET nombre=$1, precio=$2, costo=$3, stock=$4 WHERE id=$5',
      [nombre.trim(), Number(precio), costo ? Number(costo) : null, parseInt(stock, 10) || 0, req.params.id]);
    req.flash('ok', 'Producto actualizado.');
    res.redirect('/productos');
  } catch (e) { next(e); }
});

router.post('/:id/toggle', async (req, res, next) => {
  try {
    await db.query('UPDATE productos SET activo = NOT activo WHERE id = $1', [req.params.id]);
    res.redirect('/productos');
  } catch (e) { next(e); }
});

router.post('/:id/vender', async (req, res, next) => {
  try {
    const prod = await db.one('SELECT * FROM productos WHERE id = $1', [req.params.id]);
    if (!prod) { req.flash('error', 'Producto no encontrado.'); return res.redirect('/productos'); }
    const cant = parseInt(req.body.cantidad, 10) || 1;
    if (cant < 1) { req.flash('error', 'Cantidad invalida.'); return res.redirect('/productos'); }
    const metodo = req.body.metodo_pago || 'efectivo';
    const total = Number(prod.precio) * cant;
    if (!(total > 0)) { req.flash('error', 'El total debe ser mayor a 0.'); return res.redirect('/productos'); }

    await db.withTx(async (c) => {
      const caja = (await c.query("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1")).rows[0];
      const pago = (await c.query(
        `INSERT INTO pagos (caja_id, concepto, monto, metodo_pago, registrado_por)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [caja ? caja.id : null, `Venta: ${prod.nombre} x${cant}`, total, metodo, req.session.user.nombre])).rows[0];
      await c.query(
        `INSERT INTO venta_productos (pago_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)`,
        [pago.id, prod.id, cant, prod.precio]);
      await c.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [cant, prod.id]);
    });
    req.flash('ok', `Venta registrada: ${prod.nombre} x${cant} = ${soles(total)}.`);
    res.redirect('/productos');
  } catch (e) { next(e); }
});

module.exports = router;
