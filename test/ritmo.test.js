'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluarRitmo, model } = require('../src/ritmo');

test('solo evalúa la ventana 30–40 del primer tiempo', () => {
  const stats = { sh: 8, sha: 4, sot: 4, sota: 2 };
  assert.equal(evaluarRitmo({ minuto: 29, golesLocal: 2, golesVisita: 0 }, stats), null);
  assert.equal(evaluarRitmo({ minuto: 68, golesLocal: 2, golesVisita: 0 }, stats), null);
});

test('se abstiene si falta un contador de remates', () => {
  const x = evaluarRitmo({ minuto: 30, golesLocal: 0, golesVisita: 0 }, { sh: 8, sha: 4, sot: 3 });
  assert.equal(x.disponible, false);
  assert.equal(x.cruzaUmbral, undefined);
});

test('reproduce la fórmula congelada y puede señalar aunque vaya ganando un equipo', () => {
  const x = evaluarRitmo({ minuto: 30, golesLocal: 2, golesVisita: 0 }, { sh: 8, sha: 4, sot: 4, sota: 2 });
  assert.equal(x.version, 'ritmo-1t-v1');
  assert.equal(x.probabilidad, 0.5185);
  assert.equal(x.cruzaUmbral, true);
  assert.equal(model.threshold, 0.47758141333481735);
});

test('no envía señal cuando el ritmo estimado queda bajo el umbral', () => {
  const x = evaluarRitmo({ minuto: 33, golesLocal: 0, golesVisita: 0 }, { sh: 3, sha: 2, sot: 1, sota: 1 });
  assert.equal(x.probabilidad, 0.346);
  assert.equal(x.cruzaUmbral, false);
});
