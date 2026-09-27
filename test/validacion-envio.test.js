'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarAviso } = require('../src/validacion-envio');

const local = { lado: 'local', golesEquipo: 0, golesRival: 1 };
const visita = { lado: 'visita', golesEquipo: 0, golesRival: 1 };
const actual = { minuto: 36, minutoFeed: 35, golesLocal: 0, golesVisita: 1 };

test('confirma un marcador sin cambios dentro de la ventana', () => {
  assert.equal(validarAviso(local, actual), null);
  assert.equal(validarAviso(visita, actual), 'marcador_cambio');
  assert.equal(validarAviso(visita, { ...actual, golesLocal: 1, golesVisita: 0 }), null);
});

test('descarta gol nuevo, fase nueva y ausencia de partido', () => {
  assert.equal(validarAviso(local, { ...actual, golesLocal: 1 }), 'marcador_cambio');
  assert.equal(validarAviso(local, { ...actual, minuto: 46, minutoFeed: 46 }), 'fuera_de_ventana');
  assert.equal(validarAviso(local, null), 'partido_no_disponible');
});

test('se abstiene cuando el minuto reconstruido no coincide con el feed', () => {
  assert.equal(validarAviso(local, { ...actual, minuto: 40, minutoFeed: 34 }), 'reloj_incierto');
  assert.equal(validarAviso(local, { ...actual, minuto: 38, minutoFeed: 28 }), 'fuera_de_ventana');
  assert.equal(validarAviso(local, { ...actual, minutoFeed: null }), 'fuera_de_ventana');
});
