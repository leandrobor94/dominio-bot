'use strict';

// Detector EXPERIMENTAL de gol antes del descanso. Solo escribe en el historial:
// nunca se entrega a notify ni sustituye a los dos gatillos de dominio.
// Coeficientes congelados con partidos hasta 2026-09-01; el umbral se fijó por
// volumen de señales del 02 al 12 de septiembre, sin optimizar los aciertos.
const model = require('./ritmo-model.json');

const finiteNonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function evaluarRitmo(p, stats) {
  if (!Number.isFinite(p.minuto) || p.minuto < 30 || p.minuto > 40) return null;

  const base = { version: model.version, objetivo: 'gol_antes_descanso' };
  const shots = [stats?.sh, stats?.sha, stats?.sot, stats?.sota];
  if (!shots.every(finiteNonnegative)) return { ...base, disponible: false, motivo: 'remates_incompletos' };
  if (![p.golesLocal, p.golesVisita].every(finiteNonnegative)) {
    return { ...base, disponible: false, motivo: 'marcador_incompleto' };
  }

  const values = [
    p.minuto,
    p.golesLocal + p.golesVisita,
    Math.abs(p.golesLocal - p.golesVisita),
    stats.sh + stats.sha,
    stats.sot + stats.sota,
  ];
  let logit = model.weights[0];
  for (let i = 0; i < values.length; i++) {
    logit += model.weights[i + 1] * (values[i] - model.center[i]) / model.scale[i];
  }
  const probabilidad = 1 / (1 + Math.exp(-logit));
  return {
    ...base,
    disponible: true,
    probabilidad: Math.round(probabilidad * 10000) / 10000,
    cruzaUmbral: probabilidad >= model.threshold,
  };
}

module.exports = { evaluarRitmo, model };
