'use strict';
const express = require('express');
const db = require('../db');
const {
  hoyISO, addDias, dateToISO, fecha, fechaHora, soles,
  calcularFechaFin, calcularInicioRenovacion,
  normalizarTelefono, procesarPagoPasarela
} = require('../util');
const { notificarPagoConfirmado } = require('../cron');

const router = express.Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// 1. PÁGINA PÚBLICA DE MEMBRESÍAS & RENOVACIÓN ONLINE
// ============================================================
router.get(['/membresias', '/renovar', '/checkout'], async (req, res, next) => {
  try {
    const dniParam = (req.query.dni || '').trim();
    const planParam = (req.query.plan || '').trim();

    // Obtener planes activos del gimnasio
    const planes = await db.rows(
      'SELECT id, nombre, descripcion, precio, duracion_dias FROM planes WHERE activo = true ORDER BY duracion_dias ASC'
    );

    let socioPre = null;
    let estadoPre = null;

    if (dniParam) {
      socioPre = await db.one('SELECT * FROM socios WHERE dni = $1 AND activo = true', [dniParam]);
      if (socioPre) {
        estadoPre = await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [socioPre.id]);
      }
    }

    res.render('checkout/index', {
      layout: false, // Renderiza layout publico independiente y limpio
      title: 'Membresías Online · ' + (process.env.GYM_NAME || 'Zona Fitness'),
      gymName: process.env.GYM_NAME || 'Zona Fitness',
      ownerPhone: process.env.GYM_OWNER_PHONE || '51902539354',
      planes,
      dniParam,
      planParam,
      socioPre,
      estadoPre,
      culqiPublicKey: process.env.CULQI_PUBLIC_KEY || '',
      modoProduccion: Boolean(process.env.CULQI_SECRET_KEY && !process.env.CULQI_SECRET_KEY.startsWith('sk_test_demo')),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// 2. API PÚBLICA: CONSULTAR SOCIO POR DNI (Autocompletado)
// ============================================================
router.get('/api/checkout/socio/:dni', async (req, res) => {
  try {
    const dni = (req.params.dni || '').trim();
    if (!dni || dni.length < 6) {
      return res.status(400).json({ ok: false, error: 'DNI inválido' });
    }

    const socio = await db.one(
      'SELECT id, nombres, apellidos, dni, telefono, email FROM socios WHERE dni = $1 AND activo = true',
      [dni]
    );

    if (!socio) {
      return res.json({ ok: true, encontrado: false });
    }

    const estado = await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [socio.id]);

    return res.json({
      ok: true,
      encontrado: true,
      socio: {
        id: socio.id,
        nombres: socio.nombres,
        apellidos: socio.apellidos,
        dni: socio.dni,
        telefono: socio.telefono,
        email: socio.email,
        estado_membresia: estado?.estado_membresia || 'sin_suscripcion',
        plan_actual: estado?.plan_nombre || null,
        fecha_fin: estado?.fecha_fin ? fecha(estado.fecha_fin) : null,
        dias_restantes: estado?.dias_restantes ?? null,
      },
    });
  } catch (err) {
    console.error('[checkout:socio] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 3. API PÚBLICA: PROCESAR PAGO PROFESIONAL (Yape OTP / Tarjeta)
// ============================================================
router.post('/api/checkout/procesar', async (req, res) => {
  try {
    const {
      dni,
      nombres,
      apellidos,
      telefono,
      email,
      plan_id,
      metodo, // 'yape' | 'tarjeta'
      yape_telefono,
      yape_otp,
      tarjeta_numero,
      tarjeta_mes,
      tarjeta_anio,
      tarjeta_cvv,
      tarjeta_token,
    } = req.body;

    const dniLimpio = String(dni || '').trim();
    if (!dniLimpio || dniLimpio.length < 6) {
      return res.status(400).json({ ok: false, error: 'Por favor ingresa un número de DNI válido.' });
    }

    if (!plan_id || !UUID_REGEX.test(plan_id)) {
      return res.status(400).json({ ok: false, error: 'Selecciona un plan de membresía válido.' });
    }

    // 1. Verificar plan
    const plan = await db.one('SELECT * FROM planes WHERE id = $1 AND activo = true', [plan_id]);
    if (!plan) {
      return res.status(404).json({ ok: false, error: 'El plan seleccionado no está disponible.' });
    }

    const telLimpio = normalizarTelefono(telefono || yape_telefono);
    const emailFinal = (email || '').trim() || 'cliente@zonafitness.pe';

    // 2. Procesar pago en Pasarela Culqi (Yape con código OTP o Tarjeta)
    const resPago = await procesarPagoPasarela({
      metodo: metodo || 'yape',
      monto: Number(plan.precio),
      nombres: nombres || 'Socio',
      apellidos: apellidos || '',
      email: emailFinal,
      yapeTelefono: yape_telefono || telLimpio,
      yapeOtp: yape_otp,
      tarjetaToken: tarjeta_token,
      tarjetaNumero: tarjeta_numero,
      tarjetaMes: tarjeta_mes,
      tarjetaAnio: tarjeta_anio,
      tarjetaCvv: tarjeta_cvv,
      planNombre: plan.nombre,
    });

    if (!resPago.ok) {
      return res.status(400).json({ ok: false, error: resPago.error });
    }

    // 3. Ejecutar transacción ACID en PostgreSQL
    const resultado = await db.withTx(async (c) => {
      // A. Buscar o registrar al socio
      let socio = (await c.query('SELECT * FROM socios WHERE dni = $1', [dniLimpio])).rows[0];

      if (!socio) {
        if (!nombres || !nombres.trim()) {
          throw new Error('Por favor ingresa tus nombres completos.');
        }
        const insertSocio = await c.query(
          `INSERT INTO socios (nombres, apellidos, dni, telefono, email, acepta_marketing, activo)
           VALUES ($1, $2, $3, $4, $5, true, true) RETURNING *`,
          [
            nombres.trim(),
            (apellidos || '').trim(),
            dniLimpio,
            telLimpio || null,
            emailFinal,
          ]
        );
        socio = insertSocio.rows[0];
      } else {
        // Actualizar teléfono y email si se proporcionan
        if (telLimpio || emailFinal) {
          await c.query(
            `UPDATE socios 
             SET telefono = COALESCE($1, telefono),
                 email = COALESCE($2, email),
                 actualizado_en = now()
             WHERE id = $3`,
            [telLimpio || null, emailFinal || null, socio.id]
          );
        }
      }

      // B. Determinar vigencia de la suscripción (acumular si ya tiene activa)
      const subActual = (await c.query(
        `SELECT fecha_fin FROM suscripciones 
         WHERE socio_id = $1 AND estado = 'activa' 
         ORDER BY fecha_fin DESC LIMIT 1`,
        [socio.id]
      )).rows[0];

      const inicio = calcularInicioRenovacion(subActual?.fecha_fin);
      const fin = calcularFechaFin(inicio, plan.duracion_dias);

      // C. Registrar Suscripción
      const nuevaSub = (await c.query(
        `INSERT INTO suscripciones (socio_id, plan_id, fecha_inicio, fecha_fin, precio_pagado, estado, creado_por, notas)
         VALUES ($1, $2, $3, $4, $5, 'activa', 'checkout_online', $6) RETURNING *`,
        [
          socio.id,
          plan.id,
          inicio,
          fin,
          Number(plan.precio),
          `Compra online vía ${resPago.metodo.toUpperCase()} (${resPago.transaccion_id})`,
        ]
      )).rows[0];

      // D. Asociar caja del día si hay una abierta
      const cajaAbierta = (await c.query("SELECT id FROM cajas WHERE estado = 'abierta' LIMIT 1")).rows[0];

      // E. Registrar Pago Oficial
      const nuevoPago = (await c.query(
        `INSERT INTO pagos (socio_id, suscripcion_id, caja_id, concepto, monto, metodo_pago, referencia, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pasarela_online') RETURNING *`,
        [
          socio.id,
          nuevaSub.id,
          cajaAbierta ? cajaAbierta.id : null,
          `Membresía ${plan.nombre} (${plan.duracion_dias} días)`,
          Number(plan.precio),
          resPago.metodo === 'yape' ? 'yape' : 'tarjeta',
          resPago.transaccion_id,
        ]
      )).rows[0];

      return { socio, sub: nuevaSub, pago: nuevoPago, plan };
    });

    // 4. Notificación automática por WhatsApp en segundo plano
    if (resultado.socio.telefono) {
      notificarPagoConfirmado({
        socio_id: resultado.socio.id,
        nombres: resultado.socio.nombres,
        apellidos: resultado.socio.apellidos,
        telefono: resultado.socio.telefono,
        plan: resultado.plan.nombre,
        monto: Number(resultado.plan.precio),
        metodo_pago: resPago.metodo.toUpperCase(),
        fecha_fin: resultado.sub.fecha_fin,
        fecha_fin_txt: fecha(resultado.sub.fecha_fin),
      }).catch((e) => console.warn('[checkout:notificar] Error enviando WhatsApp:', e.message));
    }

    return res.json({
      ok: true,
      mensaje: resPago.mensaje || '¡Pago procesado exitosamente!',
      transaccion_id: resPago.transaccion_id,
      pago_id: resultado.pago.id,
      redirect_url: `/membresias/exito/${resultado.pago.id}`,
    });
  } catch (err) {
    console.error('[checkout:procesar] Error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Ocurrió un error al procesar tu membresía.' });
  }
});

// ============================================================
// 4. PÁGINA PÚBLICA DE CONFIRMACIÓN & TICKET DIGITAL
// ============================================================
router.get('/membresias/exito/:pago_id', async (req, res, next) => {
  try {
    const { pago_id } = req.params;
    if (!UUID_REGEX.test(pago_id)) {
      return res.status(404).render('error', { title: 'Ticket no encontrado', code: 404, mensaje: 'El comprobante no existe.' });
    }

    const pago = await db.one(
      `SELECT p.*, s.nombres, s.apellidos, s.dni, s.telefono, s.email,
              su.fecha_inicio, su.fecha_fin, pl.nombre AS plan_nombre, pl.duracion_dias
       FROM pagos p
       JOIN socios s ON s.id = p.socio_id
       LEFT JOIN suscripciones su ON su.id = p.suscripcion_id
       LEFT JOIN planes pl ON pl.id = su.plan_id
       WHERE p.id = $1`,
      [pago_id]
    );

    if (!pago) {
      return res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Comprobante de pago no encontrado.' });
    }

    res.render('checkout/exito', {
      layout: false,
      title: '¡Membresía Confirmada! · ' + (process.env.GYM_NAME || 'Zona Fitness'),
      gymName: process.env.GYM_NAME || 'Zona Fitness',
      pago,
      fechaTxt: fecha(pago.creado_en),
      fechaHoraTxt: fechaHora(pago.creado_en),
      fechaInicioTxt: fecha(pago.fecha_inicio),
      fechaFinTxt: fecha(pago.fecha_fin),
      montoSoles: soles(pago.monto),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// 5. WEBHOOK ASÍNCRONO PARA CULQI
// ============================================================
router.post('/api/checkout/webhook', async (req, res) => {
  try {
    const evento = req.body;
    console.log('[culqi:webhook] Evento recibido:', evento?.type || 'desconocido');
    // Responder 200 OK inmediatamente a Culqi
    res.json({ ok: true, recibido: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
