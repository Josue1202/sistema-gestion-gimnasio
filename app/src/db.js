'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en cliente inactivo', err);
});

/** Ejecuta una consulta. Devuelve el objeto result de pg. */
function query(text, params) {
  return pool.query(text, params);
}

/** Devuelve solo las filas. */
async function rows(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Devuelve la primera fila o null. */
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

/**
 * Ejecuta fn(client) dentro de una transaccion.
 * Hace COMMIT si fn resuelve, ROLLBACK si lanza.
 */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, rows, one, withTx };
