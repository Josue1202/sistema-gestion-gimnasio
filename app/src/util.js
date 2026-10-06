'use strict';

const TZ = process.env.TZ || 'America/Lima';

/** S/ 1,234.50 */
function soles(n) {
  const v = Number(n || 0);
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Date | string ISO -> "dd/mm/yyyy" */
function fecha(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('es-PE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Date | string ISO -> "dd/mm/yyyy HH:MM" */
function fechaHora(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleString('es-PE', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "yyyy-mm-dd" de hoy en la zona horaria local */
function hoyISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA da yyyy-mm-dd
}

/** Suma dias a una fecha "yyyy-mm-dd" y devuelve "yyyy-mm-dd" */
function addDias(iso, dias) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(dias));
  return dt.toISOString().slice(0, 10);
}

/** Solo digitos. Antepone 51 si parece numero peruano de 9 digitos. */
function normalizarTelefono(tel) {
  let s = String(tel || '').replace(/\D/g, '');
  if (s.length === 9) s = '51' + s;
  return s;
}

/** Reemplaza {{clave}} por vars[clave] (vacio si no existe) */
function renderPlantilla(cuerpo, vars) {
  return String(cuerpo || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

/** Link wa.me con texto pre-cargado */
function waLink(telefono, texto) {
  const tel = normalizarTelefono(telefono);
  return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto || '');
}

/** Escapa HTML para interpolar en atributos/markup manual */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** POST best-effort a n8n. Nunca lanza. */
async function postWebhook(path, body) {
  const base = process.env.N8N_WEBHOOK_URL;
  if (!base) return { ok: false, skipped: true };
  const url = base.replace(/\/$/, '') + '/' + String(path).replace(/^\//, '');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(4000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn('[webhook] fallo (ignorado):', err.message);
    return { ok: false, error: err.message };
  }
}

/** Convierte Date o string a "yyyy-mm-dd" respetando la zona horaria local */
function dateToISO(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.slice(0, 10))) {
    return d.slice(0, 10);
  }
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** Envio directo via Evolution API como respaldo si n8n no responde */
async function sendEvolutionWhatsApp(numero, texto) {
  const base = (process.env.EVOLUTION_API_URL || 'http://evolution-api:8080').replace(/\/$/, '');
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gym';
  if (!base || !key) return { ok: false, error: 'Falta configurar Evolution API' };
  const tel = normalizarTelefono(numero);
  if (!tel) return { ok: false, error: 'Número de teléfono inválido' };

  try {
    // Verificación rápida del estado de conexión de la instancia (fail-fast en 1.5s)
    try {
      const stateRes = await fetch(`${base}/instance/connectionState/${instance}`, {
        headers: { 'apikey': key },
        signal: AbortSignal.timeout(1500),
      });
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        const st = stateData?.instance?.state || stateData?.state;
        if (st && st !== 'open') {
          return {
            ok: false,
            error: 'WhatsApp no está vinculado o está desconectado. Ve a la pestaña "WhatsApp" y escanea el código QR.',
          };
        }
      }
    } catch (_) {
      // Si la verificacion ligera falla, continuar al intento de envio
    }

    const res = await fetch(`${base}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
      },
      body: JSON.stringify({ number: tel, text: texto }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const rawMsg = data?.response?.message || data?.message || data?.error || 'Error en servidor de WhatsApp';
      const friendly = (rawMsg === 'Connection Closed' || rawMsg === 'Unauthorized' || res.status === 401 || res.status === 500)
        ? 'WhatsApp no está vinculado o está desconectado. Escanea el código QR en la pestaña "WhatsApp" para activar el envío automático.'
        : rawMsg;
      return { ok: false, status: res.status, error: friendly, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    console.warn('[evolution-api] envio directo fallo:', err.message);
    const msg = (err.name === 'TimeoutError' || String(err.message).toLowerCase().includes('timeout') || String(err.message).toLowerCase().includes('abort'))
      ? 'WhatsApp no está vinculado o no responde a tiempo. Por favor verifica en la pestaña "WhatsApp" que el código QR esté escaneado.'
      : 'No se pudo contactar al servidor de WhatsApp: ' + err.message;
    return { ok: false, error: msg };
  }
}

/** Badge segun estado de membresia */
function badgeEstado(estado) {
  const map = {
    activo: 'ok', vencido: 'danger', congelado: 'muted',
    sin_suscripcion: 'muted', por_vencer: 'warn',
  };
  return map[estado] || 'muted';
}

const { icon } = require('./icons');

module.exports = {
  TZ, soles, fecha, fechaHora, hoyISO, addDias, dateToISO,
  normalizarTelefono, renderPlantilla, waLink, escapeHtml,
  postWebhook, sendEvolutionWhatsApp, badgeEstado, icon,
};

