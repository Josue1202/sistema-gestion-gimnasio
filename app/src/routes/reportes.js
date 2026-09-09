'use strict';
const express = require('express');
const db = require('../db');

const router = express.Router();
const TZ = process.env.TZ || 'America/Lima';

router.get('/', async (req, res, next) => {
  try {
    const [ingresosDia, ingresosMes, porMetodo, porPlan, renovacion, asistDia, asistHora] = await Promise.all([
      db.rows(
        `SELECT (creado_en AT TIME ZONE $1)::date AS dia, SUM(monto) AS total, COUNT(*) AS n
         FROM pagos WHERE creado_en >= now() - interval '30 days'
         GROUP BY 1 ORDER BY 1`, [TZ]),
      db.rows('SELECT * FROM v_ingresos_mensuales LIMIT 12'),
      db.rows('SELECT * FROM v_ingresos_por_metodo'),
      db.rows('SELECT * FROM v_ingresos_por_plan LIMIT 15'),
      db.rows('SELECT * FROM v_renovaciones_mensuales LIMIT 12'),
      db.rows('SELECT * FROM v_asistencias_por_dia LIMIT 30'),
      db.rows('SELECT * FROM v_asistencias_por_hora'),
    ]);
    res.render('reportes/index', {
      title: 'Reportes',
      ingresosDia, ingresosMes, porMetodo, porPlan, renovacion,
      asistDia: asistDia.slice().reverse(),
      asistHora,
    });
  } catch (e) { next(e); }
});

module.exports = router;
