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
  return {
    nombres: row.nombres || '',
    apellidos: row.apellidos || '',
    plan: row.plan_nombre || row.plan || '',
    fecha_fin: row.fecha_fin ? fecha(row.fecha_fin) : '',
    dias_restantes: (row.dias_restantes === undefined || row.dias_restantes === null) ? '' : String(row.dias_restantes),
    monto: (row.monto === undefined || row.monto === null) ? '' : soles(row.monto).replace('S/ ', ''),
  };
}

module.exports = { plantillasMap, varsDe };
