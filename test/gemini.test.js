'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  leerClaves,
  normalizarRespuesta,
  evaluarGeminiSombra,
} = require('../src/gemini');

const entrada = {
  partido: {
    local: 'Local FC', visita: 'Visita FC', liga: 'Liga prueba', minuto: 35,
    golesLocal: 0, golesVisita: 0,
  },
  stats: { sh: 8, sha: 3, sot: 4, sota: 1, pos: 0.61, posa: 0.39, cor: 5, cora: 1 },
  aceleracion: 1.6,
  ritmo: { version: 'ritmo-1t-v1', probabilidad: 0.62, cruzaUmbral: true },
  dominio: { motivo: 'avisa', tipo: 'remates', indice: 0.71 },
  baseLocal: { posicion: 2, golesFav: 1.8, golesCon: 0.9, posMedia: 56 },
  baseVisita: { posicion: 14, golesFav: 0.8, golesCon: 1.5, posMedia: 43 },
};

function respuestaOk(decision = 'APROBAR') {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            decision,
            confianza: 78,
            razones: ['Presión coherente'],
            faltantes: [],
            contexto: 'Partido competitivo.',
          }) }] },
          groundingMetadata: {
            webSearchQueries: ['Local FC Visita FC tabla'],
            groundingChunks: [{ web: { titulo : 'Fuente', uri: 'https://example.com/partido' } }],
          },
        }],
      };
    },
  };
}

test('lee hasta cuatro claves multilínea y elimina líneas vacías', () => {
  assert.deepEqual(leerClaves(' clave-1 \n\nclave-2\r\nclave-3\nclave-4\nclave-5'), ['clave-1', 'clave-2', 'clave-3', 'clave-4']);
});

test('sin claves se abstiene sin llamar a la red', async () => {
  let llamadas = 0;
  const r = await evaluarGeminiSombra(entrada, {
    keys: [],
    fetchImpl: async () => { llamadas++; return respuestaOk(); },
  });
  assert.equal(r.disponible, false);
  assert.equal(r.motivo, 'sin_claves');
  assert.equal(llamadas, 0);
});

test('rota a la segunda clave ante 429 sin incluir claves en cuerpo o URL', async () => {
  const vistos = [];
  const r = await evaluarGeminiSombra(entrada, {
    keys: ['secreto-uno', 'secreto-dos'],
    modelo: 'modelo-prueba',
    fetchImpl: async (url, opciones) => {
      vistos.push({ url, opciones });
      if (vistos.length === 1) return { ok: false, status: 429 };
      return respuestaOk('DESCARTAR');
    },
  });

  assert.equal(r.disponible, true);
  assert.equal(r.decision, 'DESCARTAR');
  assert.equal(r.clave, 2);
  assert.equal(r.busquedaSolicitada, false);
  assert.equal(r.busquedaUsada, true);
  assert.equal(vistos[0].opciones.headers['x-goog-api-key'], 'secreto-uno');
  assert.equal(vistos[1].opciones.headers['x-goog-api-key'], 'secreto-dos');
  for (const v of vistos) {
    assert.equal(v.url.includes('secreto-'), false);
    assert.equal(v.opciones.body.includes('secreto-'), false);
    assert.equal(Object.hasOwn(JSON.parse(v.opciones.body), 'tools'), false);
  }
});

test('solo agrega Google Search cuando se habilita de forma explicita', async () => {
  let body;
  const r = await evaluarGeminiSombra(entrada, {
    keys: ['clave-prueba'],
    usarBusqueda: true,
    fetchImpl: async (_url, opciones) => {
      body = JSON.parse(opciones.body);
      return respuestaOk();
    },
  });
  assert.deepEqual(body.tools, [{ google_search: {} }]);
  assert.equal(r.busquedaSolicitada, true);
});

test('rechaza una decisión fuera del contrato', () => {
  assert.equal(normalizarRespuesta({ decision: 'APOSTAR', confianza: 99 }), null);
});
