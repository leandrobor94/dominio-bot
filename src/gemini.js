'use strict';

// Juez contextual EXPERIMENTAL. Nunca decide Telegram: recibe solamente el
// primer cruce del detector de ritmo 1T y deja su veredicto en historial.jsonl.
// La API key viaja en un header y nunca se escribe en logs, estado ni historial.

const VERSION = 'gemini-contexto-1t-v1';
const MODELO = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 18000;

const DECISIONES = new Set(['APROBAR', 'DESCARTAR', 'INCIERTO']);

function leerClaves(valor = process.env.GEMINI_API_KEYS || '') {
  return String(valor)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function limpiarLista(valor, max = 4) {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, max);
}

function normalizarRespuesta(valor) {
  if (!valor || typeof valor !== 'object' || !DECISIONES.has(valor.decision)) return null;
  const confianza = Math.max(0, Math.min(100, Math.round(Number(valor.confianza) || 0)));
  return {
    decision: valor.decision,
    confianza,
    razones: limpiarLista(valor.razones),
    faltantes: limpiarLista(valor.faltantes),
    contexto: String(valor.contexto || '').replace(/\s+/g, ' ').trim().slice(0, 500),
  };
}

function esquema() {
  return {
    type: 'OBJECT',
    properties: {
      decision: {
        type: 'STRING', enum: ['APROBAR', 'DESCARTAR', 'INCIERTO'],
        description: 'APROBAR solo con evidencia fuerte; INCIERTO ante datos insuficientes o contradictorios.',
      },
      confianza: { type: 'INTEGER', minimum: 0, maximum: 100 },
      razones: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 4 },
      faltantes: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 4 },
      contexto: { type: 'STRING', description: 'Resumen breve del contexto externo realmente encontrado.' },
    },
    required: ['decision', 'confianza', 'razones', 'faltantes', 'contexto'],
  };
}

function construirPrompt(x) {
  const datos = {
    objetivo: 'al menos un gol DESPUES de esta captura y ANTES del descanso',
    partido: {
      local: x.partido.local,
      visita: x.partido.visita,
      liga: x.partido.liga,
      minuto: x.partido.minuto,
      marcador: `${x.partido.golesLocal}-${x.partido.golesVisita}`,
    },
    estadisticas: x.stats,
    trayectoria: { aceleracionRemates: x.aceleracion },
    modeloRitmo: x.ritmo,
    filtroDominio: x.dominio,
    contextoTemporada: {
      local: x.baseLocal,
      visita: x.baseVisita,
    },
  };

  return [
    'Actua como un juez MUY CONSERVADOR de una señal de gol antes del descanso.',
    'No uses ni busques cuotas. No evalúes goles del segundo tiempo.',
    'Usa Google Search solo para contexto verificable que pueda cambiar la decisión: formato de la competición, importancia del resultado, clasificación, estilos habituales, marcador global, expulsiones o alineaciones relevantes.',
    'Da más peso a la presión live y a su cambio reciente que a estadísticas históricas genéricas.',
    'No confundas posesión con peligro, ni muchos remates desviados con ocasiones claras.',
    'APROBAR exige señales live coherentes, tiempo suficiente y contexto que no contradiga el gol.',
    'DESCARTAR cuando el dominio sea estéril, el partido haya perdido urgencia o las señales sean engañosas.',
    'INCIERTO si faltan datos importantes, las fuentes no identifican bien el partido o existe contradicción.',
    'No inventes información. Explica solo evidencia disponible.',
    '',
    'DATOS DEL CANDIDATO:',
    JSON.stringify(datos),
  ].join('\n');
}

function textoYGrounding(json) {
  const candidato = json && Array.isArray(json.candidates) ? json.candidates[0] : null;
  const partes = candidato?.content?.parts || [];
  const texto = partes.map((p) => p && p.text).filter(Boolean).join('\n').trim();
  const meta = candidato?.groundingMetadata || {};
  const consultas = limpiarLista(meta.webSearchQueries, 6);
  const fuentes = [];
  for (const c of meta.groundingChunks || []) {
    const web = c && c.web;
    if (!web || !web.uri) continue;
    fuentes.push({
      titulo: String(web.title || '').slice(0, 160),
      url: String(web.uri).slice(0, 700),
    });
    if (fuentes.length >= 6) break;
  }
  return { texto, consultas, fuentes };
}

async function evaluarGeminiSombra(entrada, opciones = {}) {
  const keys = opciones.keys || leerClaves();
  const fetchImpl = opciones.fetchImpl || global.fetch;
  const modelo = opciones.modelo || MODELO;
  if (!keys.length) return { version: VERSION, disponible: false, motivo: 'sin_claves' };
  if (typeof fetchImpl !== 'function') return { version: VERSION, disponible: false, motivo: 'sin_fetch' };

  const body = {
    contents: [{ role: 'user', parts: [{ text: construirPrompt(entrada) }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 650,
      responseMimeType: 'application/json',
      responseSchema: esquema(),
    },
  };

  const inicio = Date.now();
  let ultimo = 'sin_respuesta';
  for (let i = 0; i < keys.length; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opciones.timeoutMs || TIMEOUT_MS);
    try {
      const r = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': keys[i] },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        },
      );
      if (!r.ok) {
        ultimo = `http_${r.status}`;
        // Una petición inválida seguirá siéndolo con otra clave. Los demás
        // casos pueden ser cuota, credencial o indisponibilidad del proyecto.
        if (r.status === 400) break;
        continue;
      }

      const json = await r.json();
      const { texto, consultas, fuentes } = textoYGrounding(json);
      let parsed;
      try { parsed = JSON.parse(texto); } catch { ultimo = 'json_invalido'; continue; }
      const normal = normalizarRespuesta(parsed);
      if (!normal) { ultimo = 'respuesta_invalida'; continue; }
      return {
        version: VERSION,
        disponible: true,
        modelo,
        clave: i + 1,
        latenciaMs: Date.now() - inicio,
        busquedaUsada: consultas.length > 0 || fuentes.length > 0,
        consultas,
        fuentes,
        ...normal,
      };
    } catch (e) {
      ultimo = e && e.name === 'AbortError' ? 'timeout' : 'red_o_api';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    version: VERSION,
    disponible: false,
    modelo,
    motivo: ultimo,
    intentos: keys.length,
    latenciaMs: Date.now() - inicio,
  };
}

module.exports = {
  VERSION,
  MODELO,
  leerClaves,
  normalizarRespuesta,
  construirPrompt,
  evaluarGeminiSombra,
};
