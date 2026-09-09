'use strict';
const express = require('express');
const db = require('../db');
const { plantillasMap, varsDe } = require('../mensajeria');
const { renderPlantilla, waLink } = require('../util');

const router = express.Router();

// No repetir la misma plantilla al mismo socio dentro de N dias
const VENTANA = {
  recordatorio_3d: 10,
  recordatorio_hoy: 10,
  vencido: 20,
  te_extranamos: 20,
  cumpleanos: 300,
};

function noEnviadoRecien(clave) {
  const dias = VENTANA[clave] || 15;
  return `NOT EXISTS (SELECT 1 FROM mensajes_enviados m
     WHERE m.socio_id = base.socio_id AND m.plantilla_clave = '${clave}'
       AND m.estado <> 'fallido' AND m.creado_en > now() - interval '${dias} days')`;
}

router.get('/', async (req, res, next) => {
  try {
    const plantillas = await plantillasMap();

    const [porVencer, hoy, vencidos, riesgo, cumples, historial] = await Promise.all([
      db.rows(`SELECT base.* FROM v_suscripciones_por_vencer base WHERE dias_restantes = 3 AND ${noEnviadoRecien('recordatorio_3d')} ORDER BY apellidos`),
      db.rows(`SELECT base.* FROM v_suscripciones_por_vencer base WHERE dias_restantes = 0 AND ${noEnviadoRecien('recordatorio_hoy')} ORDER BY apellidos`),
      db.rows(`SELECT base.* FROM v_socios_vencidos base WHERE dias_vencido BETWEEN 1 AND 30 AND ${noEnviadoRecien('vencido')} ORDER BY dias_vencido`),
      db.rows(`SELECT base.* FROM v_socios_en_riesgo base WHERE ${noEnviadoRecien('te_extranamos')} ORDER BY dias_sin_venir DESC NULLS FIRST LIMIT 40`),
      db.rows(`SELECT base.* FROM v_cumpleanos_hoy base WHERE ${noEnviadoRecien('cumpleanos')} ORDER BY nombres`),
      db.rows(`SELECT m.*, s.nombres, s.apellidos FROM mensajes_enviados m LEFT JOIN socios s ON s.id = m.socio_id
               ORDER BY m.creado_en DESC LIMIT 40`),
    ]);

    const arma = (clave, rows) => {
      const p = plantillas[clave];
      return rows.map((r) => {
        const contenido = p ? renderPlantilla(p.cuerpo, varsDe(r)) : '';
        return {
          socio_id: r.socio_id, nombre: `${r.apellidos}, ${r.nombres}`, telefono: r.telefono,
          info: r.plan_nombre ? `${r.plan_nombre} · ${r.fecha_fin ? new Date(r.fecha_fin).toLocaleDateString('es-PE') : ''}` : (r.dias_sin_venir != null ? `${r.dias_sin_venir} dias sin venir` : (r.dias_vencido != null ? `vencido hace ${r.dias_vencido}d` : '')),
          contenido,
          link: (p && r.telefono) ? waLink(r.telefono, contenido) : null,
          clave,
        };
      });
    };

    res.render('mensajes/index', {
      title: 'Mensajes',
      grupos: [
        { titulo: 'Vencen en 3 dias', clave: 'recordatorio_3d', items: arma('recordatorio_3d', porVencer) },
        { titulo: 'Vencen hoy', clave: 'recordatorio_hoy', items: arma('recordatorio_hoy', hoy) },
        { titulo: 'Vencidos (1 a 30 dias)', clave: 'vencido', items: arma('vencido', vencidos) },
        { titulo: 'Sin venir hace 14+ dias', clave: 'te_extranamos', items: arma('te_extranamos', riesgo) },
        { titulo: 'Cumpleanos hoy', clave: 'cumpleanos', items: arma('cumpleanos', cumples) },
      ],
      historial,
      sinPlantilla: Object.keys(VENTANA).filter((k) => !plantillas[k]),
    });
  } catch (e) { next(e); }
});

router.post('/registrar', async (req, res, next) => {
  try {
    const b = req.body;
    await db.query(
      `INSERT INTO mensajes_enviados (socio_id, telefono, canal, plantilla_clave, contenido, estado, enviado_en, referencia_tipo)
       VALUES ($1,$2,'whatsapp',$3,$4,'enviado',now(),'manual')`,
      [b.socio_id || null, b.telefono || null, b.plantilla_clave || null, b.contenido || null]);
    req.flash('ok', 'Marcado como enviado.');
    res.redirect('/mensajes');
  } catch (e) { next(e); }
});

module.exports = router;
