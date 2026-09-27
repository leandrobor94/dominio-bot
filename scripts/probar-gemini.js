'use strict';

// Prueba manual y aislada del juez Gemini. No consulta partidos reales,
// no escribe historial, no envia Telegram y nunca muestra las claves.

const { leerClaves, evaluarGeminiSombra } = require('../src/gemini');

const entrada = {
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
};

async function main() {
  const keys = leerClaves();
  console.log(`Claves Gemini configuradas: ${keys.length}`);
  if (!keys.length) throw new Error('No se encontro el secreto GEMINI_API_KEY.');

  const fallos = [];
  for (let i = 0; i < keys.length; i++) {
    console.log(`Probando clave Gemini ${i + 1}/${keys.length}...`);
    const resultado = await evaluarGeminiSombra(entrada, { keys: [keys[i]] });

    console.log(JSON.stringify({
      clave: i + 1,
      disponible: resultado.disponible,
      modelo: resultado.modelo,
      latenciaMs: resultado.latenciaMs,
      decision: resultado.decision || null,
      confianza: resultado.confianza ?? null,
      busquedaUsada: resultado.busquedaUsada ?? null,
      busquedaSolicitada: resultado.busquedaSolicitada ?? null,
      motivo: resultado.motivo || null,
    }, null, 2));

    if (!resultado.disponible) fallos.push(i + 1);
  }

  if (fallos.length) {
    throw new Error(`Claves Gemini con fallo: ${fallos.join(', ')}`);
  }
  console.log(`Verificacion completa: ${keys.length}/${keys.length} claves operativas.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
