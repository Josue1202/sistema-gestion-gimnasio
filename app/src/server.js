'use strict';
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./db');
const util = require('./util');
const { router: authRouter, requireAuth, needsSetup } = require('./auth');

const app = express();
app.set('trust proxy', 1);

// Vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Locals globales inmediatos
app.use((req, res, next) => {
  res.locals.gymName = process.env.GYM_NAME || 'Zona Fitness';
  res.locals.title = res.locals.gymName;
  res.locals.currentPath = req.path || '';
  res.locals.user = null;
  res.locals.u = util;
  next();
});

// Parsers y estaticos
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/public', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads'), { maxAge: '1h' }));

// Sesion
app.use(session({
  store: new PgSession({
    pool,
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15, // Limpiar sesiones vencidas cada 15 min
  }),
  secret: process.env.SESSION_SECRET || 'cambia-este-secreto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12 h
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
  },
}));

// Flash + locals comunes
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  req.flash = (type, msg) => { (req.session.flash ||= []).push({ type, msg }); };
  res.locals.user = req.session.user || null;
  res.locals.socio = req.session.socio || null;
  res.locals.currentPath = req.path;
  res.locals.u = util; // helpers en las vistas: u.soles(), u.fecha(), ...
  res.locals.gymName = process.env.GYM_NAME || 'Zona Fitness';
  res.locals.title = res.locals.gymName;
  next();

});

const cron = require('./cron');

// Salud (sin auth)
app.get('/health', (req, res) => res.type('text').send('ok'));

async function initDatabase() {
  // 1. Asegurar base de datos n8n
  try {
    const chkDb = await pool.query("SELECT 1 FROM pg_database WHERE datname = 'n8n'");
    if (chkDb.rows.length === 0) {
      console.log('[db] Creando base de datos n8n...');
      await pool.query('CREATE DATABASE n8n');
      console.log('[db] Base de datos n8n creada exitosamente!');
    }
  } catch (err) {
    console.error('[db] Error asegurando base de datos n8n:', err.message);
  }

  // 2. Tablas del gimnasio
  const chk = await pool.query("SELECT to_regclass('public.usuarios') AS tbl");
  if (!chk.rows[0].tbl) {
    console.log('[db] Inicializando tablas y datos base del gimnasio...');
    const fs = require('fs');
    const sqlPath = path.join(__dirname, 'init_db.sql');
    if (fs.existsSync(sqlPath)) {
      let sql = fs.readFileSync(sqlPath, 'utf8').replace(/^\uFEFF/, '');
      await pool.query(sql);
      console.log('[db] Tablas, vistas y datos base creados exitosamente!');
    }
  }

  // 3. Asegurar vista v_socios_estado con foto_url y cierre de membresías vencidas
  try {
    await pool.query(`
      CREATE OR REPLACE VIEW v_socios_estado AS
      SELECT
        s.id,
        s.nombres,
        s.apellidos,
        s.dni,
        s.telefono,
        s.email,
        s.fecha_nacimiento,
        s.acepta_marketing,
        s.fecha_registro,
        v.suscripcion_id,
        v.plan_nombre,
        v.fecha_inicio,
        v.fecha_fin,
        v.dias_restantes,
        CASE
          WHEN v.suscripcion_id IS NULL           THEN 'sin_suscripcion'
          WHEN v.suscripcion_estado = 'congelada' THEN 'congelado'
          WHEN v.fecha_fin >= CURRENT_DATE        THEN 'activo'
          ELSE 'vencido'
        END AS estado_membresia,
        s.foto_url
      FROM socios s
      LEFT JOIN v_socio_suscripcion_vigente v ON v.socio_id = s.id
      WHERE s.activo = true;
    `);

    // Cerrar automáticamente en BD las suscripciones cuya fecha ya pasó
    await pool.query(
      `UPDATE suscripciones 
       SET estado = 'vencida', actualizado_en = now()
       WHERE estado = 'activa' AND fecha_fin < CURRENT_DATE`
    );
    // 4. Asegurar tablas y contenidos de la Academia Fitness & Nutrición (DocentOS)
    try {
      const { initAcademiaDb } = require('./academia_db');
      await initAcademiaDb();
    } catch (err) {
      console.warn('[db] Advertencia inicializando academia_db:', err.message);
    }
  } catch (err) {
    console.warn('[db] Advertencia en migración v_socios_estado / marcar vencidas:', err.message);
  }
}

// Endpoint de inicializacion / diagnostico de base de datos
app.get('/init-db', async (req, res) => {
  try {
    await initDatabase();
    const dbs = await pool.query('SELECT datname FROM pg_database');
    const tbls = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    res.json({
      ok: true,
      message: 'Base de datos inicializada o tablas ya presentes',
      databases: dbs.rows.map(r => r.datname),
      tables: tbls.rows.map(r => r.table_name)
    });
  } catch (err) {
    console.error('[init-db] error:', err);
    res.status(500).json({ ok: false, error: err.message, stack: err.stack, detail: err.detail });
  }
});

// Endpoint diagnostico rapido para probar conexion con Meta Cloud API
app.get('/diag/test-meta', async (req, res) => {
  try {
    const tel = req.query.tel || '51902539354';
    const msg = req.query.msg || 'Prueba desde servidor';
    const r = await util.sendMetaWhatsApp(tel, msg);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Portal publico de Membresias Online & Pasarela de Pagos (Yape OTP / Tarjeta)
app.use('/', require('./routes/checkout'));

// Captura directa de fotos desde celular via QR (publico con token)
app.use('/', require('./routes/captura_foto').router);

// Landing Page Oficial del Gimnasio & Academia Fitness (DocentOS)
app.use('/', require('./routes/landing'));

// Auth (login / setup / logout)
app.use('/', authRouter);

// A partir de aca todo requiere sesion
app.use(requireAuth);

app.use('/dashboard', require('./routes/dashboard'));
app.use('/socios', require('./routes/socios'));
app.use('/suscripciones', require('./routes/suscripciones'));
app.use('/planes', require('./routes/planes'));
app.use('/caja', require('./routes/caja'));
app.use('/asistencia', require('./routes/asistencia'));
app.use('/productos', require('./routes/productos'));
app.use('/reportes', require('./routes/reportes'));
app.use('/mensajes', require('./routes/mensajes'));
app.use('/plantillas', require('./routes/plantillas'));
app.use('/whatsapp', require('./routes/whatsapp'));


// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Pagina no encontrada.' });
});

// Errores
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).render('error', {
    title: 'Error', code: 500,
    mensaje: String(err.message || err.stack || err),
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  if (!process.env.DATABASE_URL) {
    console.warn('[aviso] DATABASE_URL no esta definida.');
  }

  try {
    await pool.query('SELECT 1');
    console.log('[db] conexion OK');

    await initDatabase();

    const n = await needsSetup();
    if (n) console.log('[setup] No hay contrasena de admin. Ve a /setup para crearla.');

    // Iniciar motor de tareas programadas nativo (reemplazo de n8n)
    cron.iniciarCron();
  } catch (e) {
    console.error('[db] Error al inicializar:', e);
  }

  app.listen(PORT, () => console.log(`[app] escuchando en http://localhost:${PORT}`));
}

start();

