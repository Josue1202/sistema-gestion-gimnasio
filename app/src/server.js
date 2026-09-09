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

// Parsers y estaticos
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Sesion
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
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
  res.locals.currentPath = req.path;
  res.locals.u = util; // helpers en las vistas: u.soles(), u.fecha(), ...
  res.locals.title = 'Gimnasio';
  next();
});

// Salud (sin auth)
app.get('/health', (req, res) => res.type('text').send('ok'));

// Auth (login / setup / logout)
app.use('/', authRouter);

// A partir de aca todo requiere sesion
app.use(requireAuth);

app.get('/', (req, res) => res.redirect('/dashboard'));
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

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'No encontrado', code: 404, mensaje: 'Pagina no encontrada.' });
});

// Errores
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).render('error', {
    title: 'Error', code: 500,
    mensaje: process.env.NODE_ENV === 'production' ? 'Ocurrio un error inesperado.' : String(err.stack || err),
  });
});

const PORT = process.env.PORT || 3000;

// Aviso temprano si falta configuracion critica
if (!process.env.DATABASE_URL) {
  console.warn('[aviso] DATABASE_URL no esta definida.');
}

pool.query('SELECT 1')
  .then(() => console.log('[db] conexion OK'))
  .catch((e) => console.error('[db] no se pudo conectar:', e.message));

needsSetup().then((n) => {
  if (n) console.log('[setup] No hay contrasena de admin. Ve a /setup para crearla.');
}).catch(() => {});

app.listen(PORT, () => console.log(`[app] escuchando en http://localhost:${PORT}`));
