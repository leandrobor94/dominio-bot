'use strict';

// Prueba manual y aislada del juez Gemini. No consulta partidos reales,
// no escribe historial y nunca envia mensajes a Telegram.

const { leerClaves, evaluarGeminiSombra } = require('../src/gemini');

async function main() {
  const keys = leerClaves();
  console.log(`Claves Gemini configuradas: ${keys.length}`);
  if (!keys.length) throw new Error('No se encontro el secreto GEMINI_API_KEYS.');

  const resultado = await evaluarGeminiSombra({
    partido: {
      local: 'Equipo Demostracion Local',
      visita: 'Equipo Demostracion Visita',
      liga: 'Prueba tecnica sin partido real',
      minuto: 34,
      golesLocal: 0,
      golesVisita: 0,
    },
    stats: {
      posesionLocal: 61,
      posesionVisita: 39,
      rematesLocal: 9,
      rematesVisita: 3,
      aPuertaLocal: 4,
      aPuertaVisita: 1,
      cornersLocal: 5,
      cornersVisita: 1,
    },
    aceleracion: { local: 2, visita: 0 },
    ritmo: { score: 78, ventana: '30-35' },
    dominio: { score: 72, lado: 'local' },
    baseLocal: null,
    baseVisita: null,
  });

  console.log(JSON.stringify({
    version: resultado.version,
    disponible: resultado.disponible,
    modelo: resultado.modelo,
    claveUsada: resultado.clave || null,
    intentos: resultado.intentos || null,
    latenciaMs: resultado.latenciaMs,
    decision: resultado.decision || null,
    confianza: resultado.confianza ?? null,
    busquedaUsada: resultado.busquedaUsada ?? null,
    busquedaSolicitada: resultado.busquedaSolicitada ?? null,
    motivo: resultado.motivo || null,
  }, null, 2));

  if (!resultado.disponible) {
    throw new Error(`Gemini no respondio correctamente: ${resultado.motivo || 'sin_detalle'}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
