'use strict';
const express = require('express');
const db = require('../db');
const { plantillasMap, varsDe } = require('../mensajeria');
const { renderPlantilla, waLink, sendEvolutionWhatsApp } = require('../util');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [kpis, porVencer, vencidos, cumples, riesgo, caja, plantillas] = await Promise.all([
      db.one('SELECT * FROM v_kpis_hoy'),
      db.rows('SELECT * FROM v_suscripciones_por_vencer WHERE dias_restantes BETWEEN 0 AND 7 ORDER BY dias_restantes, apellidos'),
      db.rows('SELECT * FROM v_socios_vencidos ORDER BY dias_vencido LIMIT 15'),
      db.rows('SELECT * FROM v_cumpleanos_hoy ORDER BY nombres'),
      db.rows('SELECT * FROM v_socios_en_riesgo ORDER BY dias_sin_venir DESC NULLS FIRST LIMIT 15'),
      db.one("SELECT * FROM v_resumen_caja WHERE estado = 'abierta' LIMIT 1"),
      plantillasMap(),
    ]);

    const linkPara = (clave, row) => {
      const p = plantillas[clave];
      if (!p || !row.telefono) return null;
      return waLink(row.telefono, renderPlantilla(p.cuerpo, varsDe(row)));
    };

    res.render('dashboard', {
      title: 'Inicio',
      kpis: kpis || {},
      porVencer, vencidos, cumples, riesgo, caja,
      linkPara,
    });
  } catch (e) { next(e); }
});

router.post('/enviar-whatsapp', async (req, res, next) => {
  try {
    const { socio_id, telefono, plantilla_clave } = req.body;
    if (!telefono) {
      req.flash('error', 'El socio no tiene teléfono registrado.');
      return res.redirect('/dashboard');
    }
    const plantillas = await plantillasMap();
    const p = plantillas[plantilla_clave];
    if (!p) {
      req.flash('error', 'Plantilla no encontrada: ' + plantilla_clave);
      return res.redirect('/dashboard');
    }
    const estado = await db.one('SELECT * FROM v_socios_estado WHERE id = $1', [socio_id]);
    const filaMsg = Object.assign({}, estado || {}, { telefono });
    const texto = renderPlantilla(p.cuerpo, varsDe(filaMsg));

    const r = await sendEvolutionWhatsApp(telefono, texto);
    if (r.ok) {
      await db.query(
        `INSERT INTO mensajes_enviados (socio_id, telefono, canal, plantilla_clave, contenido, estado, enviado_en, referencia_tipo)
         VALUES ($1, $2, 'whatsapp', $3, $4, 'enviado', now(), 'manual')`,
        [socio_id || null, telefono, plantilla_clave, texto]
      );
      req.flash('ok', '📲 Recordatorio enviado directamente por WhatsApp.');
    } else {
      await db.query(
        `INSERT INTO mensajes_enviados (socio_id, telefono, canal, plantilla_clave, contenido, estado, error, enviado_en, referencia_tipo)
         VALUES ($1, $2, 'whatsapp', $3, $4, 'fallido', $5, now(), 'manual')`,
        [socio_id || null, telefono, plantilla_clave, texto, r.error || 'Error desconocido']
      );
      req.flash('error', `No se pudo enviar por WhatsApp: ${r.error || 'Desconectado'}`);
    }
    res.redirect('/dashboard');
  } catch (e) { next(e); }
});

module.exports = router;
