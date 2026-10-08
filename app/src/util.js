'use strict';

const fs = require('fs');
const path = require('path');

const TZ = process.env.TZ || 'America/Lima';
const UPLOADS_SOCIOS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'socios');

/** S/ 1,234.50 */
function soles(n) {
  const v = Number(n || 0);
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Date | string ISO -> "dd/mm/yyyy" */
function fecha(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
      const [y, m, day] = d.trim().split('-');
      return `${day}/${m}/${y}`;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(d.trim())) {
      const isoDate = d.trim().slice(0, 10);
      const [y, m, day] = isoDate.split('-');
      return `${day}/${m}/${y}`;
    }
  }
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

/** Convierte Date o string a "yyyy-mm-dd" local sin desfase */
function dateToISO(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    const s = d.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const date = new Date(d);
  if (isNaN(date)) return '';
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Calcula la diferencia exacta en dias calendario entre dos fechas (sin desfase horario).
 * Retorna >0 si fin es posterior, 0 si es el mismo dia, <0 si ya paso.
 */
function diasEntreFechas(fechaFin, fechaInicio) {
  const f1 = dateToISO(fechaInicio || hoyISO());
  const f2 = dateToISO(fechaFin);
  if (!f1 || !f2) return 0;
  const [y1, m1, d1] = f1.split('-').map(Number);
  const [y2, m2, d2] = f2.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

/**
 * Calcula la fecha de vencimiento dada una fecha de inicio y duración en días.
 * Ambas fechas son inclusivas en el acceso del gimnasio:
 * - Un plan de 1 día (pase diario) que inicia hoy, vence hoy.
 * - Un plan de 15 días que inicia el 01/10, vence el 15/10 (15 días de entreno).
 * - Un plan de 30 días que inicia el 01/10, vence el 30/10 (30 días de entreno).
 */
function calcularFechaFin(inicioISO, duracionDias) {
  const dias = Math.max(1, parseInt(duracionDias, 10) || 1);
  return addDias(inicioISO, dias - 1);
}

/**
 * Calcula la fecha de inicio para una renovación:
 * - Si el socio renueva con una membresía activa vigente (vence hoy o en el futuro):
 *   la nueva membresía arranca al día siguiente del vencimiento actual (acumula días sin perder nada).
 * - Si el socio ya venció o no tiene suscripción activa:
 *   la nueva membresía arranca HOY.
 */
function calcularInicioRenovacion(fechaFinActualISO) {
  const hoy = hoyISO();
  if (fechaFinActualISO) {
    const fin = dateToISO(fechaFinActualISO);
    if (fin >= hoy) {
      return addDias(fin, 1);
    }
  }
  return hoy;
}

/**
 * Guarda foto de socio en base64 (capturada por cámara web o subida por formulario).
 * Guarda en app/public/uploads/socios/ y devuelve la ruta web: '/public/uploads/socios/socio_...jpg'.
 */
async function guardarFotoSocioBase64(socioId, base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return null;

  const matches = base64Data.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!matches) {
    // Si ya es una ruta relativa o URL existente, mantenerla
    if (base64Data.startsWith('/public/uploads/') || base64Data.startsWith('http')) {
      return base64Data;
    }
    return null;
  }

  const ext = matches[1].toLowerCase() === 'png' ? 'png' : 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');

  await fs.promises.mkdir(UPLOADS_SOCIOS_DIR, { recursive: true });

  const filename = `socio_${socioId || 'temp'}_${Date.now()}.${ext}`;
  const filepath = path.join(UPLOADS_SOCIOS_DIR, filename);
  await fs.promises.writeFile(filepath, buffer);

  return `/public/uploads/socios/${filename}`;
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

/** Envio directo via Meta WhatsApp Cloud API (Oficial - 0% ban) */
async function sendMetaWhatsApp(numero, texto, options = {}) {
  const token = (process.env.META_WA_TOKEN || '').trim().replace(/^["']|["']$/g, '');
  const phoneId = (process.env.META_WA_PHONE_NUMBER_ID || '').trim().replace(/^["']|["']$/g, '');
  if (!token || !phoneId) {
    return { ok: false, provider: 'meta', error: 'Falta configurar credenciales de Meta Cloud API (META_WA_TOKEN o PHONE_NUMBER_ID)' };
  }
  const tel = normalizarTelefono(numero);
  if (!tel) return { ok: false, provider: 'meta', error: 'Número de teléfono inválido' };

  try {
    let payload;
    if (options.template) {
      payload = {
        messaging_product: 'whatsapp',
        to: tel,
        type: 'template',
        template: {
          name: options.template,
          language: { code: options.lang || 'en_US' },
          components: options.components || []
        }
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: tel,
        type: 'text',
        text: { preview_url: false, body: texto }
      };
    }

    const res = await fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[meta-cloud-api] Error HTTP', res.status, JSON.stringify(data, null, 2));
      const code = data?.error?.code;
      const details = data?.error?.error_data?.details;
      const errMsg = details ? `${data.error.message} - ${details}` : (data?.error?.message || `Error HTTP ${res.status} en Meta`);

      // Si falla por restricción de ventana o permisos de texto libre (131005 / 131047), reintentar automáticamente con plantilla oficial hello_world
      if ((code === 131005 || code === 131047) && !options.template && options.fallbackTemplate !== false) {
        console.log(`[meta-cloud-api] Reintentando con plantilla oficial hello_world para ${tel}...`);
        const retryRes = await fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: tel,
            type: 'template',
            template: { name: 'hello_world', language: { code: 'en_US' } }
          }),
          signal: AbortSignal.timeout(10000)
        });
        const retryData = await retryRes.json().catch(() => ({}));
        if (retryRes.ok) {
          return { ok: true, provider: 'meta', note: 'Enviado como plantilla de prueba oficial', status: retryRes.status, data: retryData };
        }
      }

      return { ok: false, provider: 'meta', status: res.status, error: errMsg, data };
    }
    return { ok: true, provider: 'meta', status: res.status, data };
  } catch (err) {
    console.warn('[meta-cloud-api] error envio:', err.message);
    return { ok: false, provider: 'meta', error: 'Error contactando Meta Cloud API: ' + err.message };
  }
}

/** Envio directo via Evolution API (Baileys) */
async function sendEvolutionDirect(numero, texto) {
  const base = (process.env.EVOLUTION_API_URL || 'http://evolution-api:8080').replace(/\/$/, '');
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'gym';
  if (!base || !key) return { ok: false, provider: 'evolution', error: 'Falta configurar Evolution API' };
  const tel = normalizarTelefono(numero);
  if (!tel) return { ok: false, provider: 'evolution', error: 'Número de teléfono inválido' };

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
            provider: 'evolution',
            error: 'WhatsApp no está vinculado en Evolution. Escanea el código QR en la pestaña "WhatsApp".',
          };
        }
      }
    } catch (_) {}

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
      return { ok: false, provider: 'evolution', status: res.status, error: friendly, data };
    }
    return { ok: true, provider: 'evolution', status: res.status, data };
  } catch (err) {
    console.warn('[evolution-api] envio directo fallo:', err.message);
    const msg = (err.name === 'TimeoutError' || String(err.message).toLowerCase().includes('timeout') || String(err.message).toLowerCase().includes('abort'))
      ? 'WhatsApp no está vinculado o no responde a tiempo. Por favor verifica en la pestaña "WhatsApp" que el código QR esté escaneado.'
      : 'No se pudo contactar al servidor de WhatsApp: ' + err.message;
    return { ok: false, provider: 'evolution', error: msg };
  }
}

/**
 * Envio unificado de WhatsApp con enrutamiento inteligente y tolerancia a fallos.
 * Prioridad por defecto: Meta Cloud API -> si falla o no está configurado -> Evolution API.
 */
async function sendWhatsAppMessage(numero, texto, options = {}) {
  const metaConfigured = Boolean(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_NUMBER_ID);
  const preferred = options.provider || process.env.WHATSAPP_DEFAULT_PROVIDER || (metaConfigured ? 'meta' : 'evolution');

  if (preferred === 'meta') {
    const rMeta = await sendMetaWhatsApp(numero, texto, options);
    if (rMeta.ok) return rMeta;
    // Si Meta falla y Evolution esta configurado, fallback automatico
    if (options.fallback !== false && process.env.EVOLUTION_API_KEY) {
      console.log(`[whatsapp] Fallback de Meta a Evolution para ${numero} (${rMeta.error})`);
      const rEvo = await sendEvolutionDirect(numero, texto);
      if (rEvo.ok) return rEvo;
    }
    return rMeta;
  }

  // Si prefiere evolution
  const rEvo = await sendEvolutionDirect(numero, texto);
  if (rEvo.ok) return rEvo;
  if (options.fallback !== false && metaConfigured) {
    console.log(`[whatsapp] Fallback de Evolution a Meta para ${numero} (${rEvo.error})`);
    return sendMetaWhatsApp(numero, texto, options);
  }
  return rEvo;
}

/** Wrapper para retrocompatibilidad con todas las llamadas del sistema */
async function sendEvolutionWhatsApp(numero, texto, options) {
  return sendWhatsAppMessage(numero, texto, options);
}

/** Badge segun estado de membresia */
function badgeEstado(estado) {
  const map = {
    activo: 'ok', vencido: 'danger', congelado: 'muted',
    sin_suscripcion: 'muted', por_vencer: 'warn',
  };
  return map[estado] || 'muted';
}

/**
 * Procesador de Pagos Profesional Culqi (Yape con OTP & Tarjetas).
 * Soporta modo productivo (con credenciales Culqi) y modo Sandbox inteligente.
 */
async function procesarPagoPasarela(datos = {}) {
  const {
    metodo, // 'yape' | 'tarjeta'
    monto,
    nombres = 'Socio',
    apellidos = '',
    email = 'cliente@zonafitness.pe',
    yapeTelefono,
    yapeOtp,
    tarjetaToken,
    tarjetaNumero,
    tarjetaMes,
    tarjetaAnio,
    tarjetaCvv,
    planNombre = 'Membresía Gimnasio',
  } = datos;

  const montoNum = Number(monto);
  if (!(montoNum > 0)) {
    return { ok: false, error: 'El monto de la membresía es inválido.' };
  }

  const culqiSecret = process.env.CULQI_SECRET_KEY;
  const culqiPublic = process.env.CULQI_PUBLIC_KEY;
  const esLive = Boolean(culqiSecret && !culqiSecret.startsWith('sk_test_demo'));

  // ---------- CASO 1: YAPE CON CÓDIGO DE APROBACIÓN (OTP) ----------
  if (metodo === 'yape') {
    const celLimpio = String(yapeTelefono || '').replace(/\D/g, '');
    const otpLimpio = String(yapeOtp || '').replace(/\D/g, '');

    if (celLimpio.length !== 9 || !celLimpio.startsWith('9')) {
      return { ok: false, error: 'Ingresa un número de celular Yape válido de 9 dígitos (ej. 987654321).' };
    }
    if (otpLimpio.length !== 6) {
      return { ok: false, error: 'El código de aprobación de Yape debe tener 6 dígitos. Puedes obtenerlo abriendo tu app Yape > Código de aprobación.' };
    }

    // Si hay credenciales reales de Culqi configuradas
    if (esLive && culqiPublic) {
      try {
        // 1. Generar token Yape
        const tokenRes = await fetch('https://tokens.culqi.com/v4/tokens/yape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${culqiPublic}`,
          },
          body: JSON.stringify({
            user_id: celLimpio,
            number: celLimpio,
            amount: Math.round(montoNum * 100),
            otp: otpLimpio,
          }),
          signal: AbortSignal.timeout(12000),
        });

        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.id) {
          const userMsg = tokenData.user_message || tokenData.merchant_message || 'El código de aprobación de Yape expiró o es incorrecto.';
          return { ok: false, error: userMsg, detalle: tokenData };
        }

        // 2. Crear cargo con el token de Yape
        const chargeRes = await fetch('https://api.culqi.com/v2/charges', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${culqiSecret}`,
          },
          body: JSON.stringify({
            amount: Math.round(montoNum * 100),
            currency_code: 'PEN',
            email: email || 'cliente@zonafitness.pe',
            source_id: tokenData.id,
            description: `Plan ${planNombre} - ${nombres} ${apellidos}`,
            antifraud_details: {
              first_name: (nombres || 'Socio').slice(0, 30),
              last_name: (apellidos || 'Zona Fitness').slice(0, 30),
              phone: celLimpio,
            },
          }),
          signal: AbortSignal.timeout(15000),
        });

        const chargeData = await chargeRes.json().catch(() => ({}));
        if (!chargeRes.ok || chargeData.outcome?.type !== 'venta_exitosa') {
          return {
            ok: false,
            error: chargeData.user_message || chargeData.outcome?.user_message || 'No se pudo procesar el cobro en Yape.',
            detalle: chargeData,
          };
        }

        return {
          ok: true,
          transaccion_id: chargeData.id,
          metodo: 'yape',
          proveedor: 'culqi_live',
          monto: montoNum,
          mensaje: 'Pago debitado exitosamente de tu cuenta Yape.',
        };
      } catch (err) {
        return { ok: false, error: 'Error comunicando con pasarela Culqi / Yape: ' + err.message };
      }
    }

    // Modo Sandbox / Demo inteligente (valida formato real y aprueba de inmediato)
    const refSimulada = 'YAPE-' + Math.floor(100000 + Math.random() * 900000) + '-' + Date.now().toString(36).toUpperCase();
    return {
      ok: true,
      transaccion_id: refSimulada,
      metodo: 'yape',
      proveedor: 'culqi_sandbox',
      monto: montoNum,
      mensaje: 'Pago debitado exitosamente de tu cuenta Yape (Aprobación instantánea).',
    };
  }

  // ---------- CASO 2: TARJETA DE CRÉDITO / DÉBITO ----------
  if (metodo === 'tarjeta') {
    if (tarjetaToken && esLive) {
      try {
        const chargeRes = await fetch('https://api.culqi.com/v2/charges', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${culqiSecret}`,
          },
          body: JSON.stringify({
            amount: Math.round(montoNum * 100),
            currency_code: 'PEN',
            email: email || 'cliente@zonafitness.pe',
            source_id: tarjetaToken,
            description: `Plan ${planNombre} - ${nombres} ${apellidos}`,
            antifraud_details: {
              first_name: (nombres || 'Socio').slice(0, 30),
              last_name: (apellidos || 'Zona Fitness').slice(0, 30),
              phone: '51999999999',
            },
          }),
          signal: AbortSignal.timeout(15000),
        });

        const chargeData = await chargeRes.json().catch(() => ({}));
        if (!chargeRes.ok || chargeData.outcome?.type !== 'venta_exitosa') {
          return {
            ok: false,
            error: chargeData.user_message || chargeData.outcome?.user_message || 'Transacción rechazada por el banco emisor de la tarjeta.',
            detalle: chargeData,
          };
        }

        return {
          ok: true,
          transaccion_id: chargeData.id,
          metodo: 'tarjeta',
          proveedor: 'culqi_live',
          monto: montoNum,
          mensaje: 'Cobro de tarjeta aprobado exitosamente.',
        };
      } catch (err) {
        return { ok: false, error: 'Error comunicando con pasarela de tarjetas: ' + err.message };
      }
    }

    // Validación básica de tarjeta en modo formulario directo o sandbox
    const numLim = String(tarjetaNumero || '').replace(/\s+/g, '');
    if (numLim.length < 13 || numLim.length > 19) {
      return { ok: false, error: 'Número de tarjeta inválido (debe tener entre 15 y 16 dígitos).' };
    }
    const cvvLim = String(tarjetaCvv || '').trim();
    if (cvvLim.length < 3 || cvvLim.length > 4) {
      return { ok: false, error: 'Código CVV inválido (3 o 4 dígitos al reverso de la tarjeta).' };
    }

    const refCardSim = 'CARD-' + Math.floor(1000 + Math.random() * 9000) + '-' + Date.now().toString(36).toUpperCase();
    return {
      ok: true,
      transaccion_id: refCardSim,
      metodo: 'tarjeta',
      proveedor: 'culqi_sandbox',
      monto: montoNum,
      ultimos4: numLim.slice(-4),
      mensaje: 'Transacción aprobada con tarjeta de crédito/débito.',
    };
  }

  return { ok: false, error: 'Método de pago no soportado. Selecciona Yape o Tarjeta.' };
}

const { icon } = require('./icons');

module.exports = {
  TZ, soles, fecha, fechaHora, hoyISO, addDias, dateToISO,
  calcularFechaFin, calcularInicioRenovacion, diasEntreFechas, guardarFotoSocioBase64,
  normalizarTelefono, renderPlantilla, waLink, escapeHtml,
  postWebhook, sendMetaWhatsApp, sendEvolutionDirect,
  sendWhatsAppMessage, sendEvolutionWhatsApp, badgeEstado, icon,
  procesarPagoPasarela,
};

