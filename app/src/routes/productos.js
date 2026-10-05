'use strict';
const express = require('express');
const db = require('../db');
const { soles } = require('../util');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Listado general ----------
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

// ---------- Listado de productos activos para POS / Terminal ----------
router.get('/activos', async (req, res, next) => {
  try {
    const rows = await db.rows(
      'SELECT id, nombre, precio, stock FROM productos WHERE activo = true ORDER BY nombre'
    );
    res.json({ ok: true, productos: rows });
  } catch (e) { next(e); }
});

// ---------- Venta rápida multilínea desde Terminal / Mostrador ----------
router.post('/venta-rapida', async (req, res, next) => {
  try {
    let { items, socio_id, metodo_pago, referencia } = req.body;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (_) { items = []; }
    }
    if (!Array.isArray(items) || items.length === 0) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(400).json({ ok: false, error: 'No se seleccionaron productos para vender.' });
      }
      req.flash('error', 'No se seleccionaron productos para vender.');
      return res.redirect('/asistencia');
    }

    const metodo = (metodo_pago || 'efectivo').toLowerCase().trim();
    const metodosPermitidos = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'otro'];
    const metodoValido = metodosPermitidos.includes(metodo) ? metodo : 'efectivo';

    // Si socio_id viene vacio o 'anonimo', dejar null
    const socioUUID = (socio_id && socio_id !== 'anonimo' && socio_id !== 'null' && socio_id.trim() && UUID.test(socio_id.trim()))
      ? socio_id.trim()
      : null;

    let socioInfo = null;
    if (socioUUID) {
      socioInfo = await db.one('SELECT id, nombres, apellidos, dni, telefono FROM socios WHERE id = $1', [socioUUID]);
    }

    let resultado = null;

    await db.withTx(async (c) => {
      // 1. Obtener caja abierta
      const caja = (await c.query("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1")).rows[0];

      // 2. Validar productos, precios y stock
      let totalVenta = 0;
      const detallesValidados = [];
      const resumenItems = [];

      for (const it of items) {
        const prodId = it.producto_id || it.id;
        const cant = parseInt(it.cantidad, 10) || 1;
        if (cant <= 0) continue;

        const prod = (await c.query('SELECT id, nombre, precio, stock FROM productos WHERE id = $1 FOR UPDATE', [prodId])).rows[0];
        if (!prod) throw new Error(`Producto no encontrado.`);
        if (prod.stock < cant) throw new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock}.`);

        const precio = Number(prod.precio);
        const subtotal = precio * cant;
        totalVenta += subtotal;

        detallesValidados.push({
          producto_id: prod.id,
          nombre: prod.nombre,
          cantidad: cant,
          precio_unitario: precio,
          subtotal,
        });

        resumenItems.push(`${prod.nombre} x${cant}`);
      }

      if (detallesValidados.length === 0 || totalVenta <= 0) {
        throw new Error('El importe de la venta debe ser mayor a S/ 0.00.');
      }

      // 3. Crear concepto descriptivo
      let concepto = `Venta mostrador: ${resumenItems.join(', ')}`;
      if (socioInfo) {
        concepto = `Venta a ${socioInfo.nombres} ${socioInfo.apellidos}: ${resumenItems.join(', ')}`;
      }

      // 4. Registrar en pagos
      const insertPago = await c.query(
        `INSERT INTO pagos (socio_id, caja_id, concepto, monto, metodo_pago, referencia, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, creado_en`,
        [
          socioUUID,
          caja ? caja.id : null,
          concepto,
          totalVenta,
          metodoValido,
          referencia ? String(referencia).trim() : null,
          req.session.user ? req.session.user.nombre : 'Recepción',
        ]
      );
      const pagoId = insertPago.rows[0].id;
      const creadoEn = insertPago.rows[0].creado_en;

      // 5. Registrar cada item en venta_productos y descontar stock
      for (const d of detallesValidados) {
        await c.query(
          `INSERT INTO venta_productos (pago_id, producto_id, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4)`,
          [pagoId, d.producto_id, d.cantidad, d.precio_unitario]
        );
        await c.query('UPDATE productos SET stock = stock - $1 WHERE id = $2', [d.cantidad, d.producto_id]);
      }

      resultado = {
        ok: true,
        pago_id: pagoId,
        total: totalVenta,
        metodo_pago: metodoValido,
        concepto,
        items: detallesValidados,
        socio: socioInfo ? `${socioInfo.nombres} ${socioInfo.apellidos}` : 'Cliente General',
        socio_id: socioUUID,
        creado_en: creadoEn,
        caja_abierta: !!caja,
      };
    });

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json(resultado);
    }

    req.flash('ok', `Venta registrada: S/ ${resultado.total.toFixed(2)} (${resultado.metodo_pago.toUpperCase()})`);
    res.redirect('/asistencia');
  } catch (err) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    req.flash('error', err.message);
    res.redirect('/asistencia');
  }
});

// ---------- Rutas de creación / edición de productos individuales ----------
router.get('/:id/editar', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Producto no encontrado.' });
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
    if (!UUID.test(req.params.id)) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Producto no encontrado.' });
    const { nombre, precio, costo, stock } = req.body;
    await db.query('UPDATE productos SET nombre=$1, precio=$2, costo=$3, stock=$4 WHERE id=$5',
      [nombre.trim(), Number(precio), costo ? Number(costo) : null, parseInt(stock, 10) || 0, req.params.id]);
    req.flash('ok', 'Producto actualizado.');
    res.redirect('/productos');
  } catch (e) { next(e); }
});

router.post('/:id/toggle', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Producto no encontrado.' });
    await db.query('UPDATE productos SET activo = NOT activo WHERE id = $1', [req.params.id]);
    res.redirect('/productos');
  } catch (e) { next(e); }
});

router.post('/:id/vender', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Producto no encontrado.' });
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
