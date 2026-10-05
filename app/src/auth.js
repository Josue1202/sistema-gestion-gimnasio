'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const router = express.Router();

async function needsSetup() {
  const r = await db.one("SELECT count(*)::int AS n FROM usuarios WHERE password_hash IS NOT NULL AND activo = true");
  return !r || r.n === 0;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.rol === 'admin') return next();
  return res.status(403).render('error', { title: 'Sin permiso', code: 403, mensaje: 'Necesitas rol de administrador.' });
}

// ---------- Setup inicial de contrasena ----------
router.get('/setup', async (req, res, next) => {
  try {
    if (!(await needsSetup())) return res.redirect('/login');
    const admin = await db.one("SELECT email FROM usuarios WHERE rol = 'admin' ORDER BY creado_en LIMIT 1");
    res.render('setup', { title: 'Configuracion inicial', layout: 'layout_blank', email: admin ? admin.email : 'admin@gimnasio.local' });
  } catch (e) { next(e); }
});

router.post('/setup', async (req, res, next) => {
  try {
    if (!(await needsSetup())) return res.redirect('/login');
    const { email, password, password2 } = req.body;
    if (!password || password.length < 6) { req.flash('error', 'La contrasena debe tener al menos 6 caracteres.'); return res.redirect('/setup'); }
    if (password !== password2) { req.flash('error', 'Las contrasenas no coinciden.'); return res.redirect('/setup'); }
    const hash = await bcrypt.hash(password, 10);
    const existing = await db.one('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existing) {
      await db.query('UPDATE usuarios SET password_hash = $1, activo = true WHERE id = $2', [hash, existing.id]);
    } else {
      await db.query("INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, 'admin')", ['Administrador', email, hash]);
    }
    req.flash('ok', 'Contrasena creada. Ya puedes iniciar sesion.');
    res.redirect('/login');
  } catch (e) { next(e); }
});

// Rate limiting en memoria para prevenir fuerza bruta
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_TIME_MS = 5 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return { blocked: false };
  if (entry.blockedUntil && entry.blockedUntil > now) {
    const mins = Math.ceil((entry.blockedUntil - now) / 60000);
    return { blocked: true, mins };
  }
  if (entry.firstAttempt && (now - entry.firstAttempt > BLOCK_TIME_MS)) {
    loginAttempts.delete(ip);
    return { blocked: false };
  }
  return { blocked: false };
}

function registerFailedAttempt(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_TIME_MS;
  }
  loginAttempts.set(ip, entry);
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// ---------- Login ----------
router.get('/login', async (req, res, next) => {
  try {
    if (req.session.user) return res.redirect('/dashboard');
    if (await needsSetup()) return res.redirect('/setup');
    res.render('login', { title: 'Ingresar', layout: 'layout_blank' });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rate = checkRateLimit(ip);
    if (rate.blocked) {
      req.flash('error', `Demasiados intentos fallidos. Por seguridad, espera ${rate.mins} minuto(s).`);
      return res.redirect('/login');
    }

    const { email, password } = req.body;
    const user = await db.one('SELECT * FROM usuarios WHERE lower(email) = lower($1) AND activo = true', [String(email || '').trim()]);
    if (!user || !user.password_hash || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
      registerFailedAttempt(ip);
      req.flash('error', 'Correo o contrasena incorrectos.');
      return res.redirect('/login');
    }

    clearAttempts(ip);
    req.session.user = { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol };
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});


module.exports = { router, requireAuth, requireAdmin, needsSetup };
