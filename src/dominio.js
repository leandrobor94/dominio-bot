'use strict';
// EL DETECTOR.
//
// No predice nada. Es un FILTRO: avisa de que un equipo esta controlando el
// partido y NO va ganando, para que tu mires ese partido y decidas. Por eso
// aqui no hay probabilidades, ni cuotas, ni valor esperado: si despues cae el
// gol o no, no es la metrica de este bot. La metrica es cuantos avisos manda
// al dia y si, al abrirlos, el partido era lo que decia.
//
// QUE SE PUEDE USAR Y QUE NO (medido sobre 1.273 capturas reales del feed):
//   remates y remates a puerta ... 62-74% de cobertura -> BASE del indice
//   posesion y ataques .......... 79-84% -> solo APOYO, nunca solos
//   corners ..................... 81-87% de cobertura pero corr -0.030 con los
//                                 goles: no informan de nada -> fuera
//   remates en el area .......... 11-25% -> inservible
//   grandes ocasiones ........... 23-26% -> inservible
//   xG .......................... 56% real, y 365scores lo ESTIMA a partir de
//                                 los remates, asi que usarlo junto a los
//                                 remates seria contar lo mismo dos veces -> fuera
//
// Los pesos cargan en los remates a proposito. Hay una medicion previa que
// avala esa decision: en un modelo hermano, meter ataques y posesion como
// senal principal HUNDIO el rendimiento fuera de muestra (AUC 0.644 -> 0.538).
// Aqui entran solo para desempatar, y con peso bajo.

const CFG = {
  // ventanas de minuto donde se mira (el usuario pidio "35 o 75")
  ventanas: [[30, 40], [68, 80]],

  // cuanto hay que dominar. 0.5 = parejo, 1.0 = monologo. Calibrado: ver README.
  umbral: 0.68,

  // volumen minimo: "2 remates a 0" no es dominar, es que no ha pasado nada
  minRematesPartido: { primera: 6, segunda: 10 },

  // ademas de la cuota, diferencia absoluta minima de tiros a puerta
  minDifSot: 2,

  // pesos del indice; se renormalizan si falta algun componente
  pesos: { sot: 0.45, sh: 0.35, atk: 0.10, pos: 0.10 },

  // sin dato de remates no se avisa: la posesion sola engana mucho
  exigirRemates: true,

  avisarPerdiendo: true,
  avisarEmpatando: true,
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Cuota del local sobre el total. null si no hay dato o el total es 0. */
function cuota(local, visita) {
  const l = num(local), v = num(visita);
  if (l === null || v === null) return null;
  const t = l + v;
  return t > 0 ? l / t : null;
}

/** Indice de dominio del LOCAL, de 0 a 1 (0.5 = parejo). null si no hay datos. */
function indice(s, cfg = CFG) {
  if (!s) return null;

  let pos = num(s.pos);
  if (pos !== null && pos > 1) pos /= 100;

  const comps = {
    sot: cuota(s.sot, s.sota),
    sh: cuota(s.sh, s.sha),
    atk: cuota(s.atk, s.atka),
    pos: pos !== null && pos > 0 && pos < 1 ? pos : null,
  };

  if (cfg.exigirRemates && comps.sot === null && comps.sh === null) return null;

  let suma = 0, peso = 0;
  for (const [k, v] of Object.entries(comps)) {
    if (v === null) continue;
    suma += cfg.pesos[k] * v;
    peso += cfg.pesos[k];
  }
  if (peso <= 0) return null;

  return {
    valor: suma / peso,
    comps,
    cobertura: peso,
    crudos: { sotL: num(s.sot), sotV: num(s.sota), shL: num(s.sh), shV: num(s.sha) },
  };
}

function ventanaDe(minuto, cfg) {
  return cfg.ventanas.find(([a, b]) => minuto >= a && minuto <= b) || null;
}

/**
 * ¿Hay que avisar de este partido ahora?
 * @param {{id,local,visita,golesLocal,golesVisita,minuto,liga,stats}} p
 * @returns {null | object} el aviso, o null con el motivo del descarte en .motivo
 *          si se pide con {conMotivo:true} (lo usa el calibrador)
 */
function detectar(p, opciones = {}) {
  const cfg = { ...CFG, ...opciones };
  const fallo = (motivo) => (opciones.conMotivo ? { motivo } : null);

  const minuto = num(p.minuto);
  if (minuto === null) return fallo('sinMinuto');

  const ventana = ventanaDe(minuto, cfg);
  if (!ventana) return fallo('fueraDeVentana');

  const d = indice(p.stats, cfg);
  if (!d) return fallo('sinRemates');

  const totalRemates = (d.crudos.shL || 0) + (d.crudos.shV || 0);
  const minVol = minuto < 45 ? cfg.minRematesPartido.primera : cfg.minRematesPartido.segunda;
  if (totalRemates < minVol) return fallo('pocoVolumen');

  const dominaLocal = d.valor >= cfg.umbral;
  const dominaVisita = 1 - d.valor >= cfg.umbral;
  if (!dominaLocal && !dominaVisita) return fallo('noDomina');

  if (d.comps.sot !== null) {
    const dif = dominaLocal ? d.crudos.sotL - d.crudos.sotV : d.crudos.sotV - d.crudos.sotL;
    if (dif < cfg.minDifSot) return fallo('difSotBaja');
  }

  const gl = num(p.golesLocal) ?? 0;
  const gv = num(p.golesVisita) ?? 0;
  const difGoles = dominaLocal ? gl - gv : gv - gl;

  if (difGoles > 0) return fallo('vaGanando');
  const estado = difGoles < 0 ? 'perdiendo' : 'empatando';
  if (estado === 'perdiendo' && !cfg.avisarPerdiendo) return fallo('estadoNoPedido');
  if (estado === 'empatando' && !cfg.avisarEmpatando) return fallo('estadoNoPedido');

  // TODO lo que sale de aqui va desde el punto de vista del que DOMINA, no del
  // local. `indice` ya se giraba, pero comps y crudos no: cuando dominaba el
  // visitante, el aviso ensenaba la posesion y los ataques del equipo
  // equivocado. Girarlo aqui, una sola vez, evita que cada consumidor tenga que
  // acordarse de hacerlo.
  const gira = (x) => (x === null || x === undefined ? null : dominaLocal ? x : 1 - x);

  return {
    motivo: 'avisa',
    id: p.id,
    lado: dominaLocal ? 'local' : 'visita',
    equipo: dominaLocal ? p.local : p.visita,
    rival: dominaLocal ? p.visita : p.local,
    golesEquipo: dominaLocal ? gl : gv,
    golesRival: dominaLocal ? gv : gl,
    marcador: `${gl}-${gv}`,
    indice: Math.round((dominaLocal ? d.valor : 1 - d.valor) * 1000) / 1000,
    minuto,
    ventana: `${ventana[0]}-${ventana[1]}`,
    estado,
    comps: { sot: gira(d.comps.sot), sh: gira(d.comps.sh), atk: gira(d.comps.atk), pos: gira(d.comps.pos) },
    crudos: {
      shFav: dominaLocal ? d.crudos.shL : d.crudos.shV,
      shRiv: dominaLocal ? d.crudos.shV : d.crudos.shL,
      sotFav: dominaLocal ? d.crudos.sotL : d.crudos.sotV,
      sotRiv: dominaLocal ? d.crudos.sotV : d.crudos.sotL,
    },
    cobertura: Math.round(d.cobertura * 100) / 100,
    liga: p.liga || null,
  };
}

module.exports = { detectar, indice, CFG };
