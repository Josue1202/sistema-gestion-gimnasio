'use strict';

const { pool } = require('./db');
const { sendEvolutionWhatsApp, renderPlantilla, normalizarTelefono, soles, fecha } = require('./util');

const TZ = process.env.TZ || 'America/Lima';

// Helper para pausas de seguridad anti-baneo (evita disparar en ráfaga)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Obtener fecha y hora actual en zona horaria America/Lima
function obtenerHoraLima() {
  const ahora = new Date();
  const fechaStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora); // 'YYYY-MM-DD'

  const horaStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(ahora); // 'HH:MM'

  return { fechaStr, horaStr };
}

// Registrar mensaje en tabla de auditoria mensajes_enviados
async function registrarLogMensaje(socioId, telefono, plantillaClave, contenido, estado, error = null, refTipo = 'cron') {
  try {
    await pool.query(
      `INSERT INTO mensajes_enviados (socio_id, telefono, canal, plantilla_clave, contenido, estado, error, enviado_en, referencia_tipo)
       VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6, now(), $7)`,
      [socioId || null, telefono, plantillaClave || null, contenido || '', estado, error, refTipo]
    );
  } catch (err) {
    console.error('[cron:log] Error guardando log en mensajes_enviados:', err.message);
  }
}

// -------------------------------------------------------------
// TAREA 1: Marcar suscripciones vencidas (diario a las 00:15)
// -------------------------------------------------------------
async function marcarVencidas() {
  try {
    console.log('[cron:marcarVencidas] Verificando suscripciones vencidas...');
    const res = await pool.query(
      `UPDATE suscripciones 
       SET estado = 'vencida' 
       WHERE estado = 'activa' AND fecha_fin < CURRENT_DATE 
       RETURNING id`
    );
    console.log(`[cron:marcarVencidas] Se actualizaron ${res.rowCount} suscripciones a estado "vencida".`);
    return { ok: true, actualizadas: res.rowCount };
  } catch (err) {
    console.error('[cron:marcarVencidas] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------
// TAREA 2: Recordatorios de vencimiento (diario a las 08:00 AM)
// -------------------------------------------------------------
async function enviarRecordatoriosVencimiento() {
  try {
    console.log('[cron:recordatorios] Buscando socios con vencimiento proximo (hoy o en 3 dias)...');
    const { rows } = await pool.query(`
      SELECT v.socio_id, v.suscripcion_id, v.nombres, v.apellidos, v.telefono, 
             v.plan_nombre, v.fecha_fin, v.dias_restantes, p.t_3d, p.t_hoy
      FROM v_suscripciones_por_vencer v
      CROSS JOIN (
        SELECT max(cuerpo) FILTER (WHERE clave = 'recordatorio_3d')  AS t_3d,
               max(cuerpo) FILTER (WHERE clave = 'recordatorio_hoy') AS t_hoy
        FROM plantillas_mensaje WHERE activo
      ) p
      WHERE v.dias_restantes IN (0, 1, 3)
        AND v.telefono IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM mensajes_enviados m
          WHERE m.socio_id = v.socio_id
            AND m.plantilla_clave IN ('recordatorio_3d', 'recordatorio_hoy')
            AND m.estado <> 'fallido'
            AND m.creado_en > now() - interval '5 days'
        )
      ORDER BY v.dias_restantes ASC
    `);

    if (rows.length === 0) {
      console.log('[cron:recordatorios] No hay recordatorios pendientes para enviar.');
      return { ok: true, total: 0 };
    }

    console.log(`[cron:recordatorios] Se encontraron ${rows.length} socios para notificar.`);
    let enviados = 0;

    for (const r of rows) {
      const esHoy = Number(r.dias_restantes) === 0;
      const clave = esHoy ? 'recordatorio_hoy' : 'recordatorio_3d';
      const cuerpoTpl = (esHoy ? r.t_hoy : r.t_3d) || 
        'Hola {{nombres}}, tu plan {{plan}} vence el {{fecha_fin}} (quedan {{dias_restantes}} dias). Te esperamos para renovar!';

      const vars = {
        nombres: (r.nombres || '').trim(),
        apellidos: (r.apellidos || '').trim(),
        plan: (r.plan_nombre || 'Gimnasio').trim(),
        fecha_fin: r.fecha_fin ? fecha(r.fecha_fin) : '',
        dias_restantes: String(r.dias_restantes ?? ''),
        monto: '',
      };

      const texto = renderPlantilla(cuerpoTpl, vars);
      const tel = normalizarTelefono(r.telefono);

      if (!tel) continue;

      const resEnvio = await sendEvolutionWhatsApp(tel, texto);

      if (resEnvio.ok) {
        await registrarLogMensaje(r.socio_id, tel, clave, texto, 'enviado', null, 'cron_vencimiento');
        enviados++;
        console.log(`[cron:recordatorios] Enviado a ${r.nombres} ${r.apellidos} (${tel})`);
      } else {
        await registrarLogMensaje(r.socio_id, tel, clave, texto, 'fallido', resEnvio.error, 'cron_vencimiento');
        console.warn(`[cron:recordatorios] Fallo envio a ${r.nombres}: ${resEnvio.error}`);
      }

      // Pausa anti-spam de 8 segundos entre cada socio
      await sleep(8000);
    }

    console.log(`[cron:recordatorios] Finalizado. Enviados: ${enviados} de ${rows.length}.`);
    return { ok: true, total: rows.length, enviados };
  } catch (err) {
    console.error('[cron:recordatorios] Error general:', err.message);
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------
// TAREA 3: Saludos de cumpleanos (diario a las 09:00 AM)
// -------------------------------------------------------------
async function enviarCumpleanos() {
  try {
    console.log('[cron:cumpleanos] Buscando cumpleaneros de hoy...');
    const { rows } = await pool.query(`
      SELECT c.socio_id, c.nombres, c.apellidos, c.telefono, p.cuerpo AS plantilla_cuerpo
      FROM v_cumpleanos_hoy c
      CROSS JOIN (
        SELECT cuerpo FROM plantillas_mensaje WHERE clave = 'cumpleanos' AND activo LIMIT 1
      ) p
      WHERE c.telefono IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM mensajes_enviados m
          WHERE m.socio_id = c.socio_id 
            AND m.plantilla_clave = 'cumpleanos'
            AND m.estado <> 'fallido' 
            AND m.creado_en > now() - interval '300 days'
        )
    `);

    if (rows.length === 0) {
      console.log('[cron:cumpleanos] No hay cumpleaneros pendientes hoy.');
      return { ok: true, total: 0 };
    }

    console.log(`[cron:cumpleanos] Se encontraron ${rows.length} cumpleaneros.`);
    let enviados = 0;

    for (const r of rows) {
      const cuerpoTpl = r.plantilla_cuerpo || '¡Feliz cumpleaños, {{nombres}}! 🎉 De parte de todo el equipo te deseamos un gran día lleno de energía.';
      const vars = {
        nombres: (r.nombres || '').trim(),
        apellidos: (r.apellidos || '').trim(),
        plan: '',
        fecha_fin: '',
        dias_restantes: '',
        monto: '',
      };

      const texto = renderPlantilla(cuerpoTpl, vars);
      const tel = normalizarTelefono(r.telefono);
      if (!tel) continue;

      const resEnvio = await sendEvolutionWhatsApp(tel, texto);
      if (resEnvio.ok) {
        await registrarLogMensaje(r.socio_id, tel, 'cumpleanos', texto, 'enviado', null, 'cron_cumpleanos');
        enviados++;
        console.log(`[cron:cumpleanos] Saludo enviado a ${r.nombres} ${r.apellidos}`);
      } else {
        await registrarLogMensaje(r.socio_id, tel, 'cumpleanos', texto, 'fallido', resEnvio.error, 'cron_cumpleanos');
      }

      await sleep(8000);
    }

    return { ok: true, total: rows.length, enviados };
  } catch (err) {
    console.error('[cron:cumpleanos] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------
// TAREA 4: Reactivacion "Te extranamos" (diario a las 10:00 AM)
// -------------------------------------------------------------
async function enviarTeExtranamos() {
  try {
    console.log('[cron:teExtranamos] Buscando socios con inasistencia prolongada (14+ dias)...');
    const { rows } = await pool.query(`
      SELECT r.socio_id, r.nombres, r.apellidos, r.telefono, r.dias_sin_venir, p.cuerpo AS plantilla_cuerpo
      FROM v_socios_en_riesgo r
      CROSS JOIN (
        SELECT cuerpo FROM plantillas_mensaje WHERE clave = 'te_extranamos' AND activo LIMIT 1
      ) p
      WHERE r.telefono IS NOT NULL
        AND r.dias_sin_venir >= 14
        AND NOT EXISTS (
          SELECT 1 FROM mensajes_enviados m
          WHERE m.socio_id = r.socio_id 
            AND m.plantilla_clave = 'te_extranamos'
            AND m.estado <> 'fallido' 
            AND m.creado_en > now() - interval '30 days'
        )
      LIMIT 20
    `);

    if (rows.length === 0) {
      console.log('[cron:teExtranamos] No hay socios en riesgo para notificar hoy.');
      return { ok: true, total: 0 };
    }

    console.log(`[cron:teExtranamos] Se encontraron ${rows.length} socios sin venir.`);
    let enviados = 0;

    for (const r of rows) {
      const cuerpoTpl = r.plantilla_cuerpo || '¡Hola {{nombres}}! Te extrañamos en el gimnasio 💪 Recuerda que la constancia es la clave. ¡Te esperamos hoy!';
      const vars = {
        nombres: (r.nombres || '').trim(),
        apellidos: (r.apellidos || '').trim(),
        plan: '',
        fecha_fin: '',
        dias_restantes: '',
        monto: '',
      };

      const texto = renderPlantilla(cuerpoTpl, vars);
      const tel = normalizarTelefono(r.telefono);
      if (!tel) continue;

      const resEnvio = await sendEvolutionWhatsApp(tel, texto);
      if (resEnvio.ok) {
        await registrarLogMensaje(r.socio_id, tel, 'te_extranamos', texto, 'enviado', null, 'cron_reactivacion');
        enviados++;
        console.log(`[cron:teExtranamos] Notificado ${r.nombres} (${r.dias_sin_venir} dias sin venir)`);
      } else {
        await registrarLogMensaje(r.socio_id, tel, 'te_extranamos', texto, 'fallido', resEnvio.error, 'cron_reactivacion');
      }

      await sleep(8000);
    }

    return { ok: true, total: rows.length, enviados };
  } catch (err) {
    console.error('[cron:teExtranamos] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------
// TAREA 5: Resumen diario al dueno del gimnasio (diario a las 21:00 PM)
// -------------------------------------------------------------
async function enviarResumenDiario() {
  const phone = process.env.GYM_OWNER_PHONE;
  if (!phone) {
    console.log('[cron:resumenDiario] GYM_OWNER_PHONE no configurado. Se omite resumen.');
    return { ok: false, skipped: true };
  }

  try {
    console.log('[cron:resumenDiario] Generando resumen diario de caja y asistencias...');
    const { rows } = await pool.query(`
      SELECT k.*,
        (SELECT count(*) FROM cajas WHERE estado = 'abierta') AS cajas_abiertas,
        (SELECT COALESCE(sum(monto), 0) FROM pagos p JOIN cajas c ON c.id = p.caja_id
           WHERE c.estado = 'abierta' AND p.metodo_pago = 'efectivo') AS efectivo_en_caja
      FROM v_kpis_hoy k
    `);

    if (rows.length === 0) return { ok: false, error: 'Sin datos de KPIs' };

    const k = rows[0];
    const { fechaStr } = obtenerHoraLima();
    const gymNombre = process.env.GYM_NAME || 'Zona Fitness';

    const texto = [
      `📊 *Resumen Diario · ${gymNombre}*`,
      `📅 Fecha: ${fechaStr}`,
      `━━━━━━━━━━━━━━━━━━`,
      `💰 Ingresos hoy: *${soles(k.ingresos_hoy)}*`,
      `📈 Ingresos del mes: *${soles(k.ingresos_mes)}*`,
      `🏋️ Asistencias de hoy: *${k.asistencias_hoy || 0}*`,
      `👥 Socios activos: *${k.socios_activos || 0}*`,
      `⚠️ Vencen en 7 días: *${k.vencen_7d || 0}*`,
      `❌ Socios vencidos: *${k.socios_vencidos || 0}*`,
      Number(k.cajas_abiertas) > 0 
        ? `🟢 Caja abierta (Efectivo esperado): *${soles(k.efectivo_en_caja)}*`
        : `⚪ Caja cerrada`,
    ].join('\n');

    const tel = normalizarTelefono(phone);
    if (!tel) return { ok: false, error: 'Telefono de dueno invalido' };

    const resEnvio = await sendEvolutionWhatsApp(tel, texto);
    if (resEnvio.ok) {
      await registrarLogMensaje(null, tel, 'resumen_diario', texto, 'enviado', null, 'cron_resumen_dueno');
      console.log(`[cron:resumenDiario] Resumen enviado con exito al dueno (${tel}).`);
      return { ok: true };
    } else {
      await registrarLogMensaje(null, tel, 'resumen_diario', texto, 'fallido', resEnvio.error, 'cron_resumen_dueno');
      console.warn(`[cron:resumenDiario] Fallo envio al dueno: ${resEnvio.error}`);
      return { ok: false, error: resEnvio.error };
    }
  } catch (err) {
    console.error('[cron:resumenDiario] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------
// EVENTO: Notificacion automatica de Pago Confirmado
// -------------------------------------------------------------
async function notificarPagoConfirmado(datos = {}) {
  try {
    const { socio_id, nombres, apellidos, telefono, plan, monto, fecha_fin, fecha_fin_txt } = datos;
    const tel = normalizarTelefono(telefono);
    if (!tel) return { ok: false, skipped: true, razon: 'Sin telefono' };

    // Buscar plantilla activa
    const { rows } = await pool.query(
      `SELECT cuerpo FROM plantillas_mensaje WHERE clave = 'pago_confirmado' AND activo LIMIT 1`
    );

    const cuerpoTpl = rows[0]?.cuerpo || 
      'Hola {{nombres}}, recibimos tu pago de S/ {{monto}}. Tu plan {{plan}} vence el {{fecha_fin}}. ¡Gracias por entrenar con nosotros!';

    const vars = {
      nombres: (nombres || '').trim(),
      apellidos: (apellidos || '').trim(),
      plan: (plan || 'Plan').trim(),
      fecha_fin: fecha_fin_txt || (fecha_fin ? fecha(fecha_fin) : ''),
      dias_restantes: '',
      monto: monto != null ? Number(monto).toFixed(2) : '0.00',
    };

    const texto = renderPlantilla(cuerpoTpl, vars);
    const resEnvio = await sendEvolutionWhatsApp(tel, texto);

    if (resEnvio.ok) {
      await registrarLogMensaje(socio_id, tel, 'pago_confirmado', texto, 'enviado', null, 'pago');
      console.log(`[cron:pagoConfirmado] WhatsApp de pago enviado a ${nombres} (${tel})`);
      return { ok: true };
    } else {
      await registrarLogMensaje(socio_id, tel, 'pago_confirmado', texto, 'fallido', resEnvio.error, 'pago');
      console.warn(`[cron:pagoConfirmado] No se pudo enviar WhatsApp de pago: ${resEnvio.error}`);
      return { ok: false, error: resEnvio.error };
    }
  } catch (err) {
    console.error('[cron:pagoConfirmado] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

// -------------------------------------------------------------
// MOTOR CRON (Verificacion periodica cada 30 segundos)
// -------------------------------------------------------------
const tareasEjecutadasHoy = new Set();
let timerId = null;

function verificarTareas() {
  const { fechaStr, horaStr } = obtenerHoraLima();

  // Limpiar memoria al cambiar de dia
  for (const clave of Array.from(tareasEjecutadasHoy)) {
    if (!clave.startsWith(fechaStr)) {
      tareasEjecutadasHoy.delete(clave);
    }
  }

  // 00:15 - Marcar suscripciones vencidas
  const clave0015 = `${fechaStr}_00:15`;
  if (horaStr === '00:15' && !tareasEjecutadasHoy.has(clave0015)) {
    tareasEjecutadasHoy.add(clave0015);
    marcarVencidas().catch(console.error);
  }

  // 08:00 - Recordatorios de vencimiento
  const clave0800 = `${fechaStr}_08:00`;
  if (horaStr === '08:00' && !tareasEjecutadasHoy.has(clave0800)) {
    tareasEjecutadasHoy.add(clave0800);
    enviarRecordatoriosVencimiento().catch(console.error);
  }

  // 09:00 - Saludos de cumpleanos
  const clave0900 = `${fechaStr}_09:00`;
  if (horaStr === '09:00' && !tareasEjecutadasHoy.has(clave0900)) {
    tareasEjecutadasHoy.add(clave0900);
    enviarCumpleanos().catch(console.error);
  }

  // 10:00 - Te extranamos (14+ dias ausente)
  const clave1000 = `${fechaStr}_10:00`;
  if (horaStr === '10:00' && !tareasEjecutadasHoy.has(clave1000)) {
    tareasEjecutadasHoy.add(clave1000);
    enviarTeExtranamos().catch(console.error);
  }

  // 21:00 - Resumen diario al dueno
  const clave2100 = `${fechaStr}_21:00`;
  if (horaStr === '21:00' && !tareasEjecutadasHoy.has(clave2100)) {
    tareasEjecutadasHoy.add(clave2100);
    enviarResumenDiario().catch(console.error);
  }
}

function iniciarCron() {
  console.log(`[cron] Motor de tareas programadas nativo iniciado en zona horaria ${TZ}.`);

  // Al arrancar, ejecutar de inmediato la revision de suscripciones vencidas
  marcarVencidas().catch(console.error);

  if (timerId) clearInterval(timerId);
  timerId = setInterval(verificarTareas, 30000);
}

module.exports = {
  iniciarCron,
  marcarVencidas,
  enviarRecordatoriosVencimiento,
  enviarCumpleanos,
  enviarTeExtranamos,
  enviarResumenDiario,
  notificarPagoConfirmado,
};
