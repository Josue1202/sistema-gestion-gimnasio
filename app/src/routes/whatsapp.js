'use strict';
const express = require('express');
const { sendEvolutionWhatsApp, normalizarTelefono } = require('../util');

const router = express.Router();

function getEvoConfig() {
  const base = (process.env.EVOLUTION_API_URL || 'http://evolution-api:8080').replace(/\/$/, '');
  const key = process.env.EVOLUTION_API_KEY || '';
  const instance = process.env.EVOLUTION_INSTANCE || 'gym';
  return { base, key, instance };
}

async function fetchEvo(path, options = {}) {
  const { base, key } = getEvoConfig();
  const url = `${base}${path}`;
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'apikey': key,
  }, options.headers || {});

  return fetch(url, Object.assign({}, options, {
    headers,
    signal: AbortSignal.timeout(6000),
  }));
}

// Obtener estado de la conexion y datos de instancia
async function obtenerEstado() {
  const { instance } = getEvoConfig();
  try {
    const res = await fetchEvo(`/instance/connectionState/${instance}`);
    if (res.ok) {
      const data = await res.json();
      return data?.instance?.state || data?.state || 'close';
    }
    if (res.status === 404) {
      return 'not_created';
    }
    return 'close';
  } catch (err) {
    return 'offline';
  }
}

async function obtenerDetallesInstancia() {
  const { instance } = getEvoConfig();
  try {
    const res = await fetchEvo('/instance/fetchInstances');
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        return list.find((i) => i.name === instance) || null;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Obtener o generar QR
async function obtenerQR() {
  const { instance } = getEvoConfig();
  try {
    // 1. Intentar conectar
    let res = await fetchEvo(`/instance/connect/${instance}`);
    if (res.ok) {
      const data = await res.json();
      return data.base64 || data.qrcode?.base64 || data.code || null;
    }

    // 2. Si la instancia no existe, crearla
    if (res.status === 404) {
      const createRes = await fetchEvo('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: instance,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
        }),
      });
      if (createRes.ok) {
        const createData = await createRes.json();
        return createData.qrcode?.base64 || createData.base64 || null;
      }
    }
    return null;
  } catch (err) {
    console.error('[whatsapp] error obteniendo QR:', err.message);
    return null;
  }
}

// ---------- Vistas y endpoints ----------

router.get('/', async (req, res, next) => {
  try {
    const { instance } = getEvoConfig();
    const estado = await obtenerEstado();
    const info = await obtenerDetallesInstancia();
    let qr = null;

    if (estado !== 'open') {
      qr = await obtenerQR();
    }

    res.render('whatsapp/index', {
      title: 'WhatsApp',
      estado,
      instance,
      info,
      qr,
    });
  } catch (e) { next(e); }
});

router.get('/estado', async (req, res) => {
  try {
    const estado = await obtenerEstado();
    res.json({ ok: true, estado });
  } catch (e) {
    res.json({ ok: false, estado: 'offline', error: e.message });
  }
});

router.get('/qr-live', async (req, res) => {
  try {
    const qr = await obtenerQR();
    const estado = await obtenerEstado();
    res.json({ ok: true, qr, estado });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/conectar', async (req, res) => {
  try {
    const qr = await obtenerQR();
    if (qr) req.flash('ok', 'Código QR actualizado.');
    else req.flash('info', 'Revisa que Evolution API esté en ejecución.');
    res.redirect('/whatsapp');
  } catch (e) {
    req.flash('error', 'Error al conectar: ' + e.message);
    res.redirect('/whatsapp');
  }
});

// Reiniciar instancia de cero (elimina sesiones corruptas previas)
router.post('/reiniciar', async (req, res) => {
  const { instance } = getEvoConfig();
  try {
    await fetchEvo(`/instance/delete/${instance}`, { method: 'DELETE' }).catch(() => {});
    const createRes = await fetchEvo('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      }),
    });
    if (createRes.ok) {
      req.flash('ok', 'Instancia reiniciada desde cero. Ya puedes escanear el nuevo código QR.');
    } else {
      req.flash('info', 'Instancia reiniciada. Generando código QR...');
    }
    res.redirect('/whatsapp');
  } catch (e) {
    req.flash('error', 'Error al reiniciar instancia: ' + e.message);
    res.redirect('/whatsapp');
  }
});

router.post('/desconectar', async (req, res) => {
  const { instance } = getEvoConfig();
  try {
    await fetchEvo(`/instance/logout/${instance}`, { method: 'DELETE' });
    req.flash('ok', 'Sesión de WhatsApp cerrada.');
    res.redirect('/whatsapp');
  } catch (e) {
    req.flash('error', 'Error al desconectar: ' + e.message);
    res.redirect('/whatsapp');
  }
});

router.post('/probar', async (req, res) => {
  try {
    const { telefono, mensaje } = req.body;
    const num = normalizarTelefono(telefono);
    if (!num) {
      req.flash('error', 'Número de teléfono inválido.');
      return res.redirect('/whatsapp');
    }
    const texto = (mensaje || '').trim() || 'Prueba de envío desde el Sistema de Gimnasio 🏋️';
    const r = await sendEvolutionWhatsApp(num, texto);
    if (r.ok) {
      req.flash('ok', `Mensaje de prueba enviado exitosamente a ${num}.`);
    } else {
      req.flash('error', `Falló el envío (${r.error || r.status}). Verifica que WhatsApp esté vinculado.`);
    }
    res.redirect('/whatsapp');
  } catch (e) {
    req.flash('error', 'Error: ' + e.message);
    res.redirect('/whatsapp');
  }
});

module.exports = router;
