'use strict';
const express = require('express');
const db = require('../db');
const { plantillasMap, varsDe } = require('../mensajeria');
const { renderPlantilla, waLink } = require('../util');

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

module.exports = router;
