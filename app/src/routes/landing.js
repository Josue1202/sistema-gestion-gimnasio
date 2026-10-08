'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { soles, normalizarTelefono } = require('../util');

const router = express.Router();

/**
 * Middleware para refrescar el estado de la membresía del socio en sesión
 */
async function refrescarEstadoSocio(req) {
  if (!req.session || !req.session.socio) return null;
  try {
    const estado = await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [req.session.socio.id]);
    if (estado) {
      req.session.socio.estado_membresia = estado.estado_membresia;
      req.session.socio.plan_nombre = estado.plan_nombre;
      req.session.socio.dias_restantes = estado.dias_restantes;
      req.session.socio.foto_url = estado.foto_url;
    }
    return req.session.socio;
  } catch (err) {
    console.warn('[academia] Error refrescando estado de socio:', err.message);
    return req.session.socio;
  }
}

/**
 * LANDING PAGE OFICIAL DEL GIMNASIO & ACADEMIA FITNESS (ESTILO SUPABASE DARK & DOCENTOS)
 * Ruta pública principal: /
 */
router.get('/', async (req, res, next) => {
  try {
    await refrescarEstadoSocio(req);
    const socio = req.session ? req.session.socio : null;

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

    // Progreso del socio si tiene sesión iniciada
    let progresoCursos = {};
    if (socio) {
      const prog = await db.rows(`
        SELECT l.curso_id, COUNT(p.id)::int AS completadas
        FROM lecciones_progreso p
        JOIN lecciones l ON l.id = p.leccion_id
        WHERE p.socio_id = $1 AND p.completada = true
        GROUP BY l.curso_id
      `, [socio.id]);
      for (const row of prog) {
        progresoCursos[row.curso_id] = row.completadas;
      }
    }

    res.render('landing/index', {
      layout: false, // Layout completo independiente Supabase Dark
      title: (process.env.GYM_NAME || 'Zona Fitness Pro') + ' · Gimnasio & Academia de Nutrición',
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      ownerPhone: process.env.GYM_OWNER_PHONE || '51902539354',
      planes,
      cursos,
      leccionesPorCurso,
      progresoCursos,
      culqiPublicKey: process.env.CULQI_PUBLIC_KEY || '',
      user: req.session ? req.session.user : null,
      socio
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// AUTENTICACIÓN DEL ALUMNO / CLIENTE (PORTAL SOCIOS & DOCENTOS)
// ============================================================================

/**
 * GET /academia/login - Formulario de ingreso para alumnos
 */
router.get('/academia/login', async (req, res) => {
  const nextUrl = req.query.next || '/academia';
  if (req.session && req.session.socio) {
    return res.redirect(nextUrl);
  }

  res.render('landing/login_alumno', {
    layout: false,
    title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
    gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
    next: nextUrl,
    error: null,
    tab: req.query.tab || 'login',
    identificador: '',
    dni: req.query.dni || ''
  });
});

/**
 * POST /academia/login - Procesar inicio de sesión de socio con Correo o DNI
 */
router.post('/academia/login', async (req, res, next) => {
  const nextUrl = req.body.next || req.query.next || '/academia';
  const identificador = String(req.body.identificador || '').trim();
  const password = String(req.body.password || '').trim();

  if (!identificador || !password) {
    return res.render('landing/login_alumno', {
      layout: false,
      title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      next: nextUrl,
      error: 'Por favor ingresa tu correo o DNI y tu contraseña.',
      tab: 'login',
      identificador,
      dni: ''
    });
  }

  try {
    // Buscar socio por Email o DNI
    const socio = await db.one(`
      SELECT s.*, e.estado_membresia, e.plan_nombre, e.dias_restantes
      FROM socios s
      LEFT JOIN v_socios_estado e ON e.id = s.id
      WHERE (LOWER(TRIM(s.email)) = LOWER($1) OR TRIM(s.dni) = $1) AND s.activo = true
      LIMIT 1
    `, [identificador]);

    if (!socio) {
      return res.render('landing/login_alumno', {
        layout: false,
        title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
        gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
        next: nextUrl,
        error: 'No encontramos ningún socio registrado con ese correo o DNI. Consulta en recepción o suscríbete a un plan.',
        tab: 'login',
        identificador,
        dni: ''
      });
    }

    // Caso 1: El socio todavía no tiene contraseña registrada
    if (!socio.password_hash) {
      // Si ingresó su DNI como contraseña provisional, se la activamos automáticamente
      if (password === socio.dni) {
        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE socios SET password_hash = $1, ultimo_login = now() WHERE id = $2', [hash, socio.id]);
      } else {
        return res.render('landing/login_alumno', {
          layout: false,
          title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
          gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
          next: nextUrl,
          error: 'Tu cuenta aún no tiene contraseña. Ingresa tu número de DNI como contraseña provisional para activarla, o usa la pestaña "Primer Acceso".',
          tab: 'login',
          identificador,
          dni: socio.dni
        });
      }
    } else {
      // Caso 2: Verificar contraseña con hash
      const coincide = await bcrypt.compare(password, socio.password_hash);
      if (!coincide) {
        return res.render('landing/login_alumno', {
          layout: false,
          title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
          gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
          next: nextUrl,
          error: 'Contraseña incorrecta. Si es tu primera vez o la olvidaste, actívala en la pestaña "Primer Acceso" con tu DNI.',
          tab: 'login',
          identificador,
          dni: ''
        });
      }
    }

    // Login exitoso: Registrar último login y guardar sesión del socio
    await db.query('UPDATE socios SET ultimo_login = now() WHERE id = $1', [socio.id]);

    req.session.socio = {
      id: socio.id,
      nombres: socio.nombres,
      apellidos: socio.apellidos,
      dni: socio.dni,
      email: socio.email,
      telefono: socio.telefono,
      foto_url: socio.foto_url,
      estado_membresia: socio.estado_membresia || 'sin_suscripcion',
      plan_nombre: socio.plan_nombre || null,
      dias_restantes: socio.dias_restantes || 0
    };

    return res.redirect(nextUrl);
  } catch (err) {
    console.error('[academia] Error en login de socio:', err);
    return res.render('landing/login_alumno', {
      layout: false,
      title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      next: nextUrl,
      error: 'Ocurrió un error inesperado al iniciar sesión. Inténtalo de nuevo.',
      tab: 'login',
      identificador,
      dni: ''
    });
  }
});

/**
 * POST /academia/activar - Primer acceso y creación de contraseña para socios registrados
 */
router.post('/academia/activar', async (req, res, next) => {
  const nextUrl = req.body.next || req.query.next || '/academia';
  const dni = String(req.body.dni || '').trim();
  const password = String(req.body.password || '').trim();
  const password_confirm = String(req.body.password_confirm || '').trim();

  if (!dni || !password) {
    return res.render('landing/login_alumno', {
      layout: false,
      title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      next: nextUrl,
      error: 'Por favor ingresa tu DNI y crea una contraseña.',
      tab: 'activar',
      identificador: '',
      dni
    });
  }

  if (password.length < 6) {
    return res.render('landing/login_alumno', {
      layout: false,
      title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      next: nextUrl,
      error: 'La contraseña debe tener un mínimo de 6 caracteres.',
      tab: 'activar',
      identificador: '',
      dni
    });
  }

  if (password !== password_confirm) {
    return res.render('landing/login_alumno', {
      layout: false,
      title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      next: nextUrl,
      error: 'Las contraseñas no coinciden. Por favor verifícalas.',
      tab: 'activar',
      identificador: '',
      dni
    });
  }

  try {
    const socio = await db.one(`
      SELECT s.*, e.estado_membresia, e.plan_nombre, e.dias_restantes
      FROM socios s
      LEFT JOIN v_socios_estado e ON e.id = s.id
      WHERE TRIM(s.dni) = $1 AND s.activo = true
      LIMIT 1
    `, [dni]);

    if (!socio) {
      return res.render('landing/login_alumno', {
        layout: false,
        title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
        gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
        next: nextUrl,
        error: 'El DNI ' + dni + ' no está registrado como socio en nuestro gimnasio. Consulta en recepción o adquiere tu plan.',
        tab: 'activar',
        identificador: '',
        dni
      });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE socios SET password_hash = $1, ultimo_login = now() WHERE id = $2', [hash, socio.id]);

    req.session.socio = {
      id: socio.id,
      nombres: socio.nombres,
      apellidos: socio.apellidos,
      dni: socio.dni,
      email: socio.email,
      telefono: socio.telefono,
      foto_url: socio.foto_url,
      estado_membresia: socio.estado_membresia || 'sin_suscripcion',
      plan_nombre: socio.plan_nombre || null,
      dias_restantes: socio.dias_restantes || 0
    };

    return res.redirect(nextUrl);
  } catch (err) {
    console.error('[academia] Error activando contraseña de socio:', err);
    return res.render('landing/login_alumno', {
      layout: false,
      title: 'Acceso Alumnos · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      next: nextUrl,
      error: 'Error al activar tu contraseña. Inténtalo nuevamente.',
      tab: 'activar',
      identificador: '',
      dni
    });
  }
});

/**
 * GET /academia/logout - Cerrar sesión de socio
 */
router.get('/academia/logout', (req, res) => {
  if (req.session) {
    req.session.socio = null;
  }
  res.redirect('/');
});

// ============================================================================
// PORTAL DEL ALUMNO / CATÁLOGO & PROGRESO DOCENTOS (/academia)
// ============================================================================

/**
 * GET /academia - Dashboard principal del alumno
 */
router.get('/academia', async (req, res, next) => {
  try {
    await refrescarEstadoSocio(req);
    const socio = req.session ? req.session.socio : null;

    if (!socio) {
      return res.redirect('/academia/login?next=/academia');
    }

    // 1. Cursos con progreso personal del socio
    const cursos = await db.rows(`
      SELECT 
        c.*,
        COUNT(DISTINCT l.id)::int AS total_lecciones,
        COALESCE(SUM(DISTINCT l.duracion_minutos), 0)::int AS duracion_total_minutos,
        COUNT(DISTINCT p.leccion_id)::int AS lecciones_completadas,
        CASE 
          WHEN COUNT(DISTINCT l.id) > 0 
          THEN ROUND((COUNT(DISTINCT p.leccion_id)::numeric / COUNT(DISTINCT l.id)::numeric) * 100)::int 
          ELSE 0 
        END AS porcentaje_progreso
      FROM cursos c
      LEFT JOIN lecciones l ON l.curso_id = c.id AND l.activo = true
      LEFT JOIN lecciones_progreso p ON p.leccion_id = l.id AND p.socio_id = $1 AND p.completada = true
      WHERE c.activo = true
      GROUP BY c.id
      ORDER BY c.orden ASC, c.creado_en ASC
    `, [socio.id]);

    // 2. Última lección visualizada para reanudar al instante
    const ultimaLeccion = await db.one(`
      SELECT 
        c.slug AS curso_slug,
        c.titulo AS curso_titulo,
        l.id AS leccion_id,
        l.titulo AS leccion_titulo
      FROM lecciones_progreso p
      JOIN lecciones l ON l.id = p.leccion_id
      JOIN cursos c ON c.id = l.curso_id
      WHERE p.socio_id = $1
      ORDER BY p.completada_en DESC
      LIMIT 1
    `, [socio.id]);

    // Estadísticas globales de aprendizaje del socio
    const totalLeccionesGym = cursos.reduce((acc, c) => acc + c.total_lecciones, 0);
    const totalCompletadasGym = cursos.reduce((acc, c) => acc + c.lecciones_completadas, 0);
    const porcentajeGlobal = totalLeccionesGym > 0 ? Math.round((totalCompletadasGym / totalLeccionesGym) * 100) : 0;

    res.render('landing/portal_alumno', {
      layout: false,
      title: 'Mi Aula Virtual · ' + (process.env.GYM_NAME || 'Zona Fitness Pro'),
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      socio,
      cursos,
      ultimaLeccion,
      stats: {
        totalLecciones: totalLeccionesGym,
        totalCompletadas: totalCompletadasGym,
        porcentajeGlobal
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// AULA VIRTUAL DOCENTOS (REPRODUCTOR DOS COLUMNAS: VIDEO + PLAYLIST)
// ============================================================================

/**
 * GET /academia/curso/:slug - Aula Virtual estilo DocentOS
 */
router.get('/academia/curso/:slug', async (req, res, next) => {
  try {
    await refrescarEstadoSocio(req);
    const socio = req.session ? req.session.socio : null;
    const slug = req.params.slug;

    // 1. Obtener datos del Curso
    const curso = await db.one('SELECT * FROM cursos WHERE slug = $1 AND activo = true', [slug]);
    if (!curso) {
      return res.status(404).render('error', {
        title: 'Curso no encontrado',
        code: 404,
        mensaje: 'El curso solicitado no existe o no se encuentra disponible.'
      });
    }

    // 2. Obtener todas las lecciones del curso ordenadas
    const lecciones = await db.rows(`
      SELECT * 
      FROM lecciones 
      WHERE curso_id = $1 AND activo = true 
      ORDER BY orden ASC, creado_en ASC
    `, [curso.id]);

    if (!lecciones || lecciones.length === 0) {
      return res.status(404).render('error', {
        title: 'Curso en preparación',
        code: 404,
        mensaje: 'Este curso no cuenta con lecciones publicadas aún.'
      });
    }

    // 3. Obtener lecciones completadas por el socio
    let progresoMap = {};
    if (socio) {
      const prog = await db.rows(`
        SELECT leccion_id 
        FROM lecciones_progreso 
        WHERE socio_id = $1 AND completada = true
      `, [socio.id]);
      for (const p of prog) {
        progresoMap[p.leccion_id] = true;
      }
    }

    // 4. Determinar lección activa (por query ?leccion=ID o primera lección pendiente)
    let leccionActiva = null;
    const leccionIdQuery = req.query.leccion;
    if (leccionIdQuery) {
      leccionActiva = lecciones.find(l => l.id === leccionIdQuery);
    }
    if (!leccionActiva) {
      // Buscar la primera que no haya completado
      leccionActiva = lecciones.find(l => !progresoMap[l.id]) || lecciones[0];
    }

    const indiceActivo = lecciones.findIndex(l => l.id === leccionActiva.id);
    const leccionAnterior = indiceActivo > 0 ? lecciones[indiceActivo - 1] : null;
    const leccionSiguiente = indiceActivo < lecciones.length - 1 ? lecciones[indiceActivo + 1] : null;

    // 5. Validar permisos de acceso a la lección actual
    let accesoConcedido = false;
    let motivoBloqueo = null; // 'requiere_login' | 'requiere_membresia'

    if (leccionActiva.es_preview) {
      accesoConcedido = true;
    } else if (!socio) {
      accesoConcedido = false;
      motivoBloqueo = 'requiere_login';
    } else if (socio.estado_membresia !== 'activo') {
      accesoConcedido = false;
      motivoBloqueo = 'requiere_membresia';
    } else {
      accesoConcedido = true;
    }

    // 6. Porcentaje completado del curso
    const totalCompletadas = lecciones.filter(l => progresoMap[l.id]).length;
    const porcentajeCurso = Math.round((totalCompletadas / lecciones.length) * 100);

    // 7. Apuntes del socio y consultas al entrenador de esta lección (DocentOS)
    let notaActual = '';
    if (socio) {
      const n = await db.one('SELECT contenido FROM lecciones_notas WHERE socio_id = $1 AND leccion_id = $2', [socio.id, leccionActiva.id]);
      if (n) notaActual = n.contenido;
    }

    const consultasLeccion = await db.rows(`
      SELECT c.*, s.nombres, s.apellidos
      FROM lecciones_consultas c
      JOIN socios s ON s.id = c.socio_id
      WHERE c.leccion_id = $1
      ORDER BY c.creado_en DESC
      LIMIT 20
    `, [leccionActiva.id]);

    res.render('landing/aula_virtual', {
      layout: false,
      title: curso.titulo + ' · DocentOS Classroom',
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
      curso,
      lecciones,
      leccionActiva,
      indiceActivo,
      leccionAnterior,
      leccionSiguiente,
      accesoConcedido,
      motivoBloqueo,
      progresoMap,
      totalCompletadas,
      porcentajeCurso,
      notaActual,
      consultasLeccion,
      socio
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/academia/leccion/:id/progreso - Alternar lección completada (DocentOS)
 */
router.post('/api/academia/leccion/:id/progreso', async (req, res) => {
  try {
    const socio = req.session ? req.session.socio : null;
    if (!socio) {
      return res.status(401).json({ ok: false, error: 'Debes iniciar sesión para guardar tu progreso.' });
    }

    const leccionId = req.params.id;
    const leccion = await db.one('SELECT id, curso_id FROM lecciones WHERE id = $1', [leccionId]);
    if (!leccion) {
      return res.status(404).json({ ok: false, error: 'Lección no encontrada.' });
    }

    // Verificar si ya estaba marcada como completada
    const existente = await db.one(
      'SELECT id, completada FROM lecciones_progreso WHERE socio_id = $1 AND leccion_id = $2',
      [socio.id, leccionId]
    );

    let nuevoEstado = true;
    if (existente) {
      nuevoEstado = !existente.completada;
      await db.query(
        'UPDATE lecciones_progreso SET completada = $1, completada_en = now() WHERE id = $2',
        [nuevoEstado, existente.id]
      );
    } else {
      await db.query(
        'INSERT INTO lecciones_progreso (socio_id, leccion_id, completada) VALUES ($1, $2, true)',
        [socio.id, leccionId]
      );
    }

    // Obtener métricas actualizadas del curso
    const stats = await db.one(`
      SELECT 
        COUNT(DISTINCT l.id)::int AS total,
        COUNT(DISTINCT p.leccion_id)::int AS completadas
      FROM lecciones l
      LEFT JOIN lecciones_progreso p ON p.leccion_id = l.id AND p.socio_id = $1 AND p.completada = true
      WHERE l.curso_id = $2 AND l.activo = true
    `, [socio.id, leccion.curso_id]);

    const porcentaje = stats.total > 0 ? Math.round((stats.completadas / stats.total) * 100) : 0;

    return res.json({
      ok: true,
      completada: nuevoEstado,
      totalCompletadas: stats.completadas,
      totalLecciones: stats.total,
      porcentaje
    });
  } catch (err) {
    console.error('[academia] Error alternando progreso de lección:', err);
    return res.status(500).json({ ok: false, error: 'Error del servidor al registrar progreso.' });
  }
});

// ============================================================================
// APIS DOCENTOS: AUTENTICACIÓN MODAL, APUNTES Y CONSULTAS AL COACH
// ============================================================================

/**
 * POST /api/academia/auth/login - Login asíncrono para el AuthModal flotante
 */
router.post('/api/academia/auth/login', async (req, res) => {
  try {
    const identificador = String(req.body.identificador || '').trim();
    const password = String(req.body.password || '').trim();
    const nextUrl = req.body.next || '/academia';

    if (!identificador || !password) {
      return res.status(400).json({ ok: false, error: 'Ingresa tu correo o DNI y tu contraseña.' });
    }

    const socio = await db.one(`
      SELECT s.*, e.estado_membresia, e.plan_nombre, e.dias_restantes
      FROM socios s
      LEFT JOIN v_socios_estado e ON e.id = s.id
      WHERE (LOWER(TRIM(s.email)) = LOWER($1) OR TRIM(s.dni) = $1) AND s.activo = true
      LIMIT 1
    `, [identificador]);

    if (!socio) {
      return res.status(404).json({ ok: false, error: 'No encontramos un socio registrado con ese correo o DNI.' });
    }

    if (!socio.password_hash) {
      if (password === socio.dni) {
        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE socios SET password_hash = $1, ultimo_login = now() WHERE id = $2', [hash, socio.id]);
      } else {
        return res.status(400).json({
          ok: false,
          error: 'Tu cuenta aún no tiene contraseña. Usa tu DNI como clave provisional para activarla.',
          requiereActivacion: true,
          dni: socio.dni
        });
      }
    } else {
      const coincide = await bcrypt.compare(password, socio.password_hash);
      if (!coincide) {
        return res.status(401).json({ ok: false, error: 'Contraseña incorrecta. Si es tu primera vez, actívala con tu DNI.' });
      }
    }

    await db.query('UPDATE socios SET ultimo_login = now() WHERE id = $1', [socio.id]);

    req.session.socio = {
      id: socio.id,
      nombres: socio.nombres,
      apellidos: socio.apellidos,
      dni: socio.dni,
      email: socio.email,
      telefono: socio.telefono,
      foto_url: socio.foto_url,
      estado_membresia: socio.estado_membresia || 'sin_suscripcion',
      plan_nombre: socio.plan_nombre || null,
      dias_restantes: socio.dias_restantes || 0
    };

    return res.json({
      ok: true,
      socio: req.session.socio,
      redirectUrl: nextUrl,
      mensaje: `¡Bienvenido de vuelta, ${socio.nombres}!`
    });
  } catch (err) {
    console.error('[academia-api] Error en login modal:', err);
    return res.status(500).json({ ok: false, error: 'Error del servidor al procesar inicio de sesión.' });
  }
});

/**
 * POST /api/academia/auth/activar - Activación asíncrona con DNI para AuthModal
 */
router.post('/api/academia/auth/activar', async (req, res) => {
  try {
    const dni = String(req.body.dni || '').trim();
    const password = String(req.body.password || '').trim();
    const password_confirm = String(req.body.password_confirm || '').trim();
    const nextUrl = req.body.next || '/academia';

    if (!dni || !password) {
      return res.status(400).json({ ok: false, error: 'Ingresa tu DNI registrado y una nueva contraseña.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    if (password !== password_confirm) {
      return res.status(400).json({ ok: false, error: 'Las contraseñas no coinciden.' });
    }

    const socio = await db.one(`
      SELECT s.*, e.estado_membresia, e.plan_nombre, e.dias_restantes
      FROM socios s
      LEFT JOIN v_socios_estado e ON e.id = s.id
      WHERE TRIM(s.dni) = $1 AND s.activo = true
      LIMIT 1
    `, [dni]);

    if (!socio) {
      return res.status(404).json({ ok: false, error: 'El DNI ' + dni + ' no está registrado como socio.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE socios SET password_hash = $1, ultimo_login = now() WHERE id = $2', [hash, socio.id]);

    req.session.socio = {
      id: socio.id,
      nombres: socio.nombres,
      apellidos: socio.apellidos,
      dni: socio.dni,
      email: socio.email,
      telefono: socio.telefono,
      foto_url: socio.foto_url,
      estado_membresia: socio.estado_membresia || 'sin_suscripcion',
      plan_nombre: socio.plan_nombre || null,
      dias_restantes: socio.dias_restantes || 0
    };

    return res.json({
      ok: true,
      socio: req.session.socio,
      redirectUrl: nextUrl,
      mensaje: `¡Cuenta activada con éxito! Bienvenido ${socio.nombres}.`
    });
  } catch (err) {
    console.error('[academia-api] Error activando en modal:', err);
    return res.status(500).json({ ok: false, error: 'Error del servidor al activar cuenta.' });
  }
});

/**
 * GET /api/academia/leccion/:id/notas - Obtener apuntes del socio
 */
router.get('/api/academia/leccion/:id/notas', async (req, res) => {
  const socio = req.session ? req.session.socio : null;
  if (!socio) return res.status(401).json({ ok: false, error: 'No autenticado.' });

  try {
    const nota = await db.one('SELECT contenido, actualizado_en FROM lecciones_notas WHERE socio_id = $1 AND leccion_id = $2', [socio.id, req.params.id]);
    return res.json({ ok: true, contenido: nota ? nota.contenido : '', actualizado_en: nota ? nota.actualizado_en : null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Error al cargar apuntes.' });
  }
});

/**
 * POST /api/academia/leccion/:id/notas - Guardar apuntes del socio (DocentOS NotesPanel)
 */
router.post('/api/academia/leccion/:id/notas', async (req, res) => {
  const socio = req.session ? req.session.socio : null;
  if (!socio) return res.status(401).json({ ok: false, error: 'Debes iniciar sesión para guardar tus apuntes.' });

  try {
    const contenido = String(req.body.contenido || '').trim();
    await db.query(`
      INSERT INTO lecciones_notas (socio_id, leccion_id, contenido, actualizado_en)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (socio_id, leccion_id)
      DO UPDATE SET contenido = EXCLUDED.contenido, actualizado_en = now()
    `, [socio.id, req.params.id, contenido]);

    return res.json({ ok: true, mensaje: 'Apuntes guardados con éxito.' });
  } catch (err) {
    console.error('[academia-api] Error guardando notas:', err);
    return res.status(500).json({ ok: false, error: 'No se pudieron guardar los apuntes.' });
  }
});

/**
 * GET /api/academia/leccion/:id/consultas - Obtener preguntas de la lección
 */
router.get('/api/academia/leccion/:id/consultas', async (req, res) => {
  try {
    const consultas = await db.rows(`
      SELECT c.*, s.nombres, s.apellidos
      FROM lecciones_consultas c
      JOIN socios s ON s.id = c.socio_id
      WHERE c.leccion_id = $1
      ORDER BY c.creado_en DESC
      LIMIT 20
    `, [req.params.id]);
    return res.json({ ok: true, consultas });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Error cargando consultas.' });
  }
});

/**
 * POST /api/academia/leccion/:id/consultas - Dejar una pregunta al coach (DocentOS MentorshipPanel)
 */
router.post('/api/academia/leccion/:id/consultas', async (req, res) => {
  const socio = req.session ? req.session.socio : null;
  if (!socio) return res.status(401).json({ ok: false, error: 'Debes iniciar sesión para consultar al coach.' });

  try {
    const pregunta = String(req.body.pregunta || '').trim();
    if (!pregunta) return res.status(400).json({ ok: false, error: 'Por favor escribe tu duda o pregunta.' });

    const nueva = await db.one(`
      INSERT INTO lecciones_consultas (socio_id, leccion_id, pregunta)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [socio.id, req.params.id, pregunta]);

    return res.json({
      ok: true,
      consulta: {
        ...nueva,
        nombres: socio.nombres,
        apellidos: socio.apellidos
      },
      mensaje: '¡Tu consulta ha sido enviada al equipo de entrenadores!'
    });
  } catch (err) {
    console.error('[academia-api] Error creando consulta:', err);
    return res.status(500).json({ ok: false, error: 'Error del servidor al registrar consulta.' });
  }
});

// ============================================================================
// APIS DE COMPATIBILIDAD
// ============================================================================

/**
 * API: Validar DNI de socio para desbloqueo rápido
 */
router.post('/api/academia/validar-acceso', async (req, res) => {
  try {
    const dni = String(req.body.dni || '').trim();
    if (!dni || dni.length < 6) {
      return res.status(400).json({ ok: false, error: 'Por favor ingresa un número de DNI válido.' });
    }

    const socio = await db.one(
      'SELECT id, nombres, apellidos, dni, telefono, email FROM socios WHERE dni = $1 AND activo = true',
      [dni]
    );

    if (!socio) {
      return res.json({
        ok: false,
        no_registrado: true,
        mensaje: 'DNI no encontrado. Inscríbete en uno de nuestros planes para desbloquear todos los cursos de Nutrición y Gym.'
      });
    }

    const estado = await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [socio.id]);
    const estadoMembresia = estado ? estado.estado_membresia : 'sin_suscripcion';

    if (estadoMembresia !== 'activo') {
      return res.json({
        ok: false,
        vencido: true,
        socio: {
          nombres: socio.nombres,
          apellidos: socio.apellidos,
          estado_membresia: estadoMembresia,
          plan_nombre: estado ? estado.plan_nombre : null
        },
        mensaje: `Hola ${socio.nombres}, tu membresía se encuentra ${estadoMembresia}. Renuévala para continuar accediendo a la Academia.`
      });
    }

    return res.json({
      ok: true,
      socio: {
        id: socio.id,
        nombres: socio.nombres,
        apellidos: socio.apellidos,
        dni: socio.dni,
        estado_membresia: estadoMembresia,
        plan_nombre: estado ? estado.plan_nombre : 'Plan Activo',
        dias_restantes: estado ? estado.dias_restantes : 30
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

    if (leccion.es_preview) {
      return res.json({ ok: true, leccion, modo: 'preview' });
    }

    if (!dni && (!req.session || !req.session.socio)) {
      return res.status(403).json({
        ok: false,
        bloqueado: true,
        error: 'Esta lección requiere membresía activa. Inicia sesión como alumno para verla.'
      });
    }

    const socioId = req.session && req.session.socio ? req.session.socio.id : null;
    let socio = null;
    if (socioId) {
      socio = await db.one('SELECT id FROM socios WHERE id = $1 AND activo = true', [socioId]);
    } else {
      socio = await db.one('SELECT id FROM socios WHERE dni = $1 AND activo = true', [dni]);
    }

    const estado = socio ? await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [socio.id]) : null;

    if (!estado || estado.estado_membresia !== 'activo') {
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
