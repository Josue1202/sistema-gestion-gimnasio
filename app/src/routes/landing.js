'use strict';
const express = require('express');
const db = require('../db');
const { soles, normalizarTelefono } = require('../util');

const router = express.Router();

/**
 * LANDING PAGE OFICIAL DEL GIMNASIO & ACADEMIA FITNESS (ESTILO SUPABASE DARK & DOCENTOS)
 * Ruta pública principal: /
 */
router.get('/', async (req, res, next) => {
  try {
    // 1. Obtener Planes activos para la sección de membresías
    const planes = await db.rows(`
      SELECT id, nombre, descripcion, precio, duracion_dias 
      FROM planes 
      WHERE activo = true 
      ORDER BY duracion_dias ASC
    `);

    // 2. Obtener Cursos de Nutrición y Gym con sus estadísticas
    const cursos = await db.rows(`
      SELECT 
        c.*,
        COUNT(l.id)::int AS total_lecciones,
        COALESCE(SUM(l.duracion_minutos), 0)::int AS duracion_total_minutos,
        COUNT(CASE WHEN l.es_preview THEN 1 END)::int AS total_previews
      FROM cursos c
      LEFT JOIN lecciones l ON l.curso_id = c.id AND l.activo = true
      WHERE c.activo = true
      GROUP BY c.id
      ORDER BY c.orden ASC, c.creado_en ASC
    `);

    // 3. Obtener todas las lecciones ordenadas para el reproductor interactivo
    const lecciones = await db.rows(`
      SELECT id, curso_id, titulo, descripcion, duracion_minutos, video_url, recurso_nombre, recurso_descarga, es_preview, orden
      FROM lecciones
      WHERE activo = true
      ORDER BY curso_id, orden ASC
    `);

    // Agrupar lecciones por curso para consumo ágil en el frontend
    const leccionesPorCurso = {};
    for (const lec of lecciones) {
      if (!leccionesPorCurso[lec.curso_id]) leccionesPorCurso[lec.curso_id] = [];
      leccionesPorCurso[lec.curso_id].push(lec);
    }

    res.render('landing/index', {
      layout: false, // Layout completo independiente Supabase Dark
      title: (process.env.GYM_NAME || 'Zona Fitness Pro') + ' · Gimnasio & Academia de Nutrición',
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      ownerPhone: process.env.GYM_OWNER_PHONE || '51902539354',
      planes,
      cursos,
      leccionesPorCurso,
      culqiPublicKey: process.env.CULQI_PUBLIC_KEY || '',
      user: req.session ? req.session.user : null
    });
  } catch (err) {
    next(err);
  }
});

/**
 * API: Validar DNI de socio para desbloqueo de cursos avanzados (DocentOS)
 */
router.post('/api/academia/validar-acceso', async (req, res) => {
  try {
    const dni = String(req.body.dni || '').trim();
    if (!dni || dni.length < 6) {
      return res.status(400).json({ ok: false, error: 'Por favor ingresa un número de DNI válido.' });
    }

    const socio = await db.one('SELECT * FROM v_socios_estado WHERE dni = $1', [dni]);

    if (!socio) {
      return res.json({
        ok: false,
        no_registrado: true,
        mensaje: 'DNI no encontrado. Inscríbete en uno de nuestros planes para desbloquear todos los cursos de Nutrición y Gym.'
      });
    }

    if (socio.estado_membresia !== 'activo') {
      return res.json({
        ok: false,
        vencido: true,
        socio: {
          nombres: socio.nombres,
          apellidos: socio.apellidos,
          estado_membresia: socio.estado_membresia,
          plan_nombre: socio.plan_nombre
        },
        mensaje: `Hola ${socio.nombres}, tu membresía se encuentra ${socio.estado_membresia}. Renuévala para continuar accediendo a la Academia.`
      });
    }

    // Socio con membresía activa: acceso concedido
    return res.json({
      ok: true,
      socio: {
        id: socio.id,
        nombres: socio.nombres,
        apellidos: socio.apellidos,
        dni: socio.dni,
        estado_membresia: socio.estado_membresia,
        plan_nombre: socio.plan_nombre,
        dias_restantes: socio.dias_restantes
      },
      mensaje: `¡Bienvenido ${socio.nombres}! Acceso VIP concedido a todos los cursos y contenidos.`
    });
  } catch (err) {
    console.error('[academia] Error validando acceso:', err);
    return res.status(500).json({ ok: false, error: 'Error verificando socio.' });
  }
});

/**
 * API: Obtener detalle y video de una lección específica
 */
router.get('/api/academia/leccion/:id', async (req, res) => {
  try {
    const leccionId = req.params.id;
    const dni = String(req.query.dni || '').trim();

    const leccion = await db.one('SELECT * FROM lecciones WHERE id = $1 AND activo = true', [leccionId]);
    if (!leccion) {
      return res.status(404).json({ ok: false, error: 'Lección no encontrada.' });
    }

    // Si es preview, acceso libre
    if (leccion.es_preview) {
      return res.json({ ok: true, leccion, modo: 'preview' });
    }

    // Si no es preview, validar que el DNI corresponda a un socio activo
    if (!dni) {
      return res.status(403).json({
        ok: false,
        bloqueado: true,
        error: 'Esta lección requiere membresía activa. Ingresa tu DNI de socio para desbloquearla.'
      });
    }

    const socio = await db.one('SELECT * FROM v_socios_estado WHERE dni = $1', [dni]);
    if (!socio || socio.estado_membresia !== 'activo') {
      return res.status(403).json({
        ok: false,
        bloqueado: true,
        error: 'Tu membresía no está activa. Renueva tu plan para ver esta lección completa.'
      });
    }

    return res.json({ ok: true, leccion, modo: 'socio_activo' });
  } catch (err) {
    console.error('[academia] Error obteniendo lección:', err);
    return res.status(500).json({ ok: false, error: 'Error del servidor.' });
  }
});

module.exports = router;
