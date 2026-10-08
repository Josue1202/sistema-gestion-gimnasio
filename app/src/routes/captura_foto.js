'use strict';
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { guardarFotoSocioBase64 } = require('../util');

const router = express.Router();

function generarTokenFoto(socioId) {
  const secret = process.env.SESSION_SECRET || 'gym_pro_secret_key_2026';
  return crypto.createHmac('sha256', secret).update(String(socioId)).digest('hex').slice(0, 16);
}

// -------------------------------------------------------------
// 1. ENDPOINT PÚBLICO: Vista móvil para que el recepcionista tome
//    la foto directamente con su celular tras escanear el QR
// -------------------------------------------------------------
router.get('/foto-movil/:id/:token', async (req, res, next) => {
  try {
    const { id, token } = req.params;
    const tokenEsperado = generarTokenFoto(id);

    if (token !== tokenEsperado) {
      return res.status(403).send('Enlace de captura inválido o caducado.');
    }

    const socio = await db.one('SELECT id, nombres, apellidos, dni, foto_url FROM socios WHERE id = $1', [id]);
    if (!socio) {
      return res.status(404).send('Socio no encontrado.');
    }

    res.render('socios/captura_movil', {
      layout: false,
      title: 'Tomar Foto - ' + socio.nombres,
      socio,
      token,
      gymName: process.env.GYM_NAME || 'Zona Fitness Pro',
    });
  } catch (e) {
    next(e);
  }
});

// -------------------------------------------------------------
// 2. ENDPOINT PÚBLICO: Recibe la foto enviada desde el celular
// -------------------------------------------------------------
router.post('/foto-movil/:id/:token', async (req, res, next) => {
  try {
    const { id, token } = req.params;
    const tokenEsperado = generarTokenFoto(id);

    if (token !== tokenEsperado) {
      return res.status(403).json({ ok: false, error: 'Token inválido o caducado.' });
    }

    const { foto_base64 } = req.body;
    if (!foto_base64) {
      return res.status(400).json({ ok: false, error: 'No se recibió ninguna imagen.' });
    }

    const finalUrl = await guardarFotoSocioBase64(id, foto_base64);
    if (!finalUrl) {
      return res.status(400).json({ ok: false, error: 'Formato de imagen inválido.' });
    }

    await db.query('UPDATE socios SET foto_url = $1, actualizado_en = now() WHERE id = $2', [finalUrl, id]);

    res.json({ ok: true, foto_url: finalUrl, mensaje: 'Foto guardada con éxito.' });
  } catch (e) {
    console.error('[captura_foto:movil] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------------------
// 3. GENERAR QR Y DATOS PARA LA PANTALLA DE LA LAPTOP
//    (Ruta autenticada montada en /socios/:id/qr-foto)
// -------------------------------------------------------------
async function generarQRParaSocio(req, socioId) {
  const token = generarTokenFoto(socioId);
  const host = req.get('host');
  // Usar el protocolo de la petición o http
  const protocol = req.protocol || 'http';
  const movilUrl = `${protocol}://${host}/foto-movil/${socioId}/${token}`;
  const qrDataUrl = await QRCode.toDataURL(movilUrl, {
    width: 240,
    margin: 1,
    color: {
      dark: '#FFFFFF',
      light: '#18181B'
    }
  });

  return { movilUrl, qrDataUrl, token };
}

module.exports = {
  router,
  generarTokenFoto,
  generarQRParaSocio,
};
