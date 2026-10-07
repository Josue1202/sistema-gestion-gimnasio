'use strict';
const db = require('./db');
const { fecha, soles } = require('./util');

/** { clave: {clave, descripcion, canal, asunto, cuerpo, activo} } */
async function plantillasMap() {
  const rows = await db.rows('SELECT clave, descripcion, canal, asunto, cuerpo, activo FROM plantillas_mensaje');
  const m = {};
  rows.forEach((r) => { m[r.clave] = r; });
  return m;
}

/** Variables estandar a partir de una fila de socio/suscripcion/pago */
function varsDe(row = {}) {
  const gymNombre = process.env.GYM_NAME || 'Zona Fitness';
  const baseUrl = process.env.APP_URL || 'http://100.117.103.36:8084';
  const dni = (row.dni || '').trim();
  const linkRenovacion = dni ? `${baseUrl}/membresias?dni=${encodeURIComponent(dni)}` : `${baseUrl}/membresias`;

  return {
    gym_nombre: gymNombre,
    nombres: (row.nombres || '').trim(),
    apellidos: (row.apellidos || '').trim(),
    dni,
    plan: (row.plan_nombre || row.plan || 'Zona Fitness').trim(),
    fecha_fin: row.fecha_fin ? fecha(row.fecha_fin) : '',
    dias_restantes: (row.dias_restantes === undefined || row.dias_restantes === null) ? '0' : String(row.dias_restantes),
    monto: (row.monto === undefined || row.monto === null) ? '0.00' : soles(row.monto).replace('S/ ', ''),
    url_renovacion: linkRenovacion,
  };
}

module.exports = { plantillasMap, varsDe };

