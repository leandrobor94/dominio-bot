'use strict';
// LOS DETECTORES.
//
// No predicen nada. Son FILTROS: avisan de que un equipo esta controlando el
// partido y NO va ganando, para que tu mires ese partido y decidas. Por eso
// aqui no hay probabilidades, ni cuotas, ni valor esperado. La metrica es
// cuantos avisos manda al dia y si, al abrirlos, el partido era lo que decia.
//
// HAY DOS GATILLOS, Y COMPITEN A PROPOSITO:
//
//   'remates'  — el original. Indice ponderado con el grueso en los remates.
//   'posesion' — EXPERIMENTAL. Salta con >=65% de posesion aunque NO tenga
//                ventaja de remates.
//
// El segundo existe porque una medicion sobre 551 partidos contradijo el diseno
// del primero. Partiendo los equipos en cuadrantes, los goles que meten en lo
// que queda de partido salen asi:
//     mucha posesion + pocos remates ... 0.758   <- "posesion esteril"
//     mucha posesion + muchos remates .. 0.691
//     poca posesion + muchos remates ... 0.418   <- contragolpe
//     poca posesion + pocos remates .... 0.370
// Los dos cuadrantes CON balon van por delante de los dos sin balon. Comparado
// de forma pareada dentro del mismo partido (el que tiene la pelota contra el
// que tiene los remates, mismo minuto, misma liga): +0.340 goles a favor del
// que tiene la pelota, IC95 [0.157, 0.536], y aguanta Bonferroni.
//
// Y hay un porque: la cuota de remates a puerta predice el marcador YA JUGADO a
// AUC 0.891 — un gol ES un remate a puerta. O sea que el gatillo de remates
// repite en parte el electronico, que es informacion gastada.
//
// PERO NO SE DA POR BUENO, y por eso el segundo gatillo va marcado como
// experimental en vez de sustituir al primero:
//   1. Puede ser calidad de dato, no futbol: al minuto 60 hay ~5 remates a
//      puerta en total, asi que esa cuota se calcula sobre 5 sucesos y es
//      ruidosisima; la posesion es continua y precisa.
//   2. Con una etiqueta mas corta ("gol en 15 min") el signo se INVIERTE, sobre
//      el mismo fichero. El hallazgo depende de la etiqueta.
//   3. La etiqueta usada son los goles de ~40 minutos restantes, que se parece
//      mas a "que equipo es mejor" que a lo que mira el bot, que son 10 minutos.
// Se dejan los dos corriendo unas semanas y se comparan con datos propios.

const CFG = {
  // ventanas de minuto donde se mira
  ventanas: [[30, 40], [68, 80]],

  // --- gatillo 'remates' ---
  umbral: 0.68,                                  // cuanto hay que dominar (0.5 = parejo)
  minRematesPartido: { primera: 6, segunda: 10 },// "2 remates a 0" no es dominar
  minDifSot: 2,                                  // diferencia absoluta de tiros a puerta
  // Suelo de posesion. OJO: es un guardarrail, NO un umbral medido. Por debajo
  // del 35% solo habia n=5 observaciones (que marcaron 0.200, el peor grupo);
  // con ese n no se fija un umbral, asi que se pone donde no cuesta casi nada
  // (recorta el 0.7% del volumen) y evita los casos absurdos de 25% de balon.
  // Solo se aplica cuando el dato de posesion EXISTE: bloquear por un dato que
  // falta el 20% de las veces seria peor que no tener suelo.
  minPosesion: 0.35,

  // --- gatillo 'posesion' (experimental) ---
  posesionActiva: true,
  // 0.68 y no 0.65: peticion del dueno, que sigue los avisos y dice que por
  // debajo de 67 no le sirven. Los dos numeros que se ENSENAN en el mensaje
  // —"domina al X%" y "tiene X% de la pelota"— quedan asi ambos en 68 o mas.
  // (0.65 venia de que era el escalon con mas goles a favor, 0.937 [0.68, 1.25]
  // con n=63; subirlo a 0.68 recorta volumen y el dueno lo prefiere asi.)
  posesionGatillo: 0.68,

  // --- ACELERACION: el cambio, no el nivel ---
  // El hallazgo que justifica esto: sobre 1.036 ventanas con trayectoria, el
  // NIVEL (la cuota de remates, que es la variable de la casa vista como la ve
  // la casa) da AUC 0.530 en descubrimiento y 0.460 en los dias reservados —
  // peor que una moneda. La ACELERACION da 0.531 y 0.606. Por terciles, la tasa
  // de gol sube 45.4 -> 51.1 -> 54.5% en descubrimiento y 51.9 -> 55.6 -> 72.4%
  // en reserva: monotona en las dos mitades.
  //
  //   aceleracion = (remates en la ventana / minutos)  /  (remates totales / minuto)
  //   >1 = esta rematando por encima de su propio ritmo del partido
  //
  // OJO: la reserva son 83 ventanas. Es una pista fuerte, no un hecho cerrado.
  // Por eso el umbral es bajo (1.2) y se registra siempre, se dispare o no.
  acelActiva: true,
  minAceleracion: 1.2,

  // pesos del indice; se renormalizan si falta algun componente
  pesos: { sot: 0.45, sh: 0.35, atk: 0.10, pos: 0.10 },

  exigirRemates: true,   // sin dato de remates no salta el gatillo 'remates'
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

/** Posesion del local, normalizada a 0-1. null si no hay dato creible. */
function posesionLocal(s) {
  let p = num(s.pos);
  if (p === null) return null;
  if (p > 1) p /= 100;
  return p > 0 && p < 1 ? p : null;
}

/** Indice de dominio del LOCAL, de 0 a 1 (0.5 = parejo). null si no hay datos. */
function indice(s, cfg = CFG) {
  if (!s) return null;

  const comps = {
    sot: cuota(s.sot, s.sota),
    sh: cuota(s.sh, s.sha),
    atk: cuota(s.atk, s.atka),
    pos: posesionLocal(s),
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
 * Empaqueta el aviso SIEMPRE desde el punto de vista del que domina. Girar aqui,
 * una sola vez, evita que cada consumidor tenga que acordarse: antes comps.pos y
 * comps.atk salian del local aunque dominara el visitante, y un aviso llego a
 * mostrar "posesion 44%" cuando el que dominaba tenia el 56%.
 */
function empaquetar(p, d, ventana, dominaLocal, tipo, gl, gv) {
  const gira = (x) => (x === null || x === undefined ? null : dominaLocal ? x : 1 - x);
  const difGoles = dominaLocal ? gl - gv : gv - gl;

  // ¿ARRASANDO O JUEGA ASI SIEMPRE? — Y CONTRA ESTE RIVAL.
  //
  // No basta la media del propio equipo: esa media mezcla los partidos contra el
  // 3o y contra el colero. Medido sobre 76.328 predicciones fuera de muestra,
  // ajustar por el rival sube la correlacion de 0.353 a 0.430 (+22%).
  //
  // Con la posesion sale exacto porque es de suma cero: si el equipo promedia
  // 44% y el rival 40%, lo ESPERADO en este partido es 44-40+50 = 54%. Tener el
  // 62% entonces son +8 sobre lo esperado, no +18 sobre su media.
  const bFav = dominaLocal ? p.baseLocal : p.baseVisita;
  const bRiv = dominaLocal ? p.baseVisita : p.baseLocal;
  const posFav = gira(d.comps.pos);
  const hayPos = bFav && bRiv && Number.isFinite(bFav.posMedia) && Number.isFinite(bRiv.posMedia);

  const posEsperada = hayPos ? Math.round((bFav.posMedia - bRiv.posMedia + 50) * 10) / 10 : null;
  const posSobreEsperada = (posEsperada !== null && posFav !== null)
    ? Math.round((100 * posFav - posEsperada) * 10) / 10 : null;
  // se conserva la version plana para poder comparar las dos al auditar
  const posSobreBase = (bFav && Number.isFinite(bFav.posMedia) && posFav !== null)
    ? Math.round((100 * posFav - bFav.posMedia) * 10) / 10 : null;

  // goles esperados del partido: el ataque de cada uno contra la defensa del otro
  const golesEsperados = (bFav && bRiv
    && Number.isFinite(bFav.golesFav) && Number.isFinite(bRiv.golesCon)
    && Number.isFinite(bRiv.golesFav) && Number.isFinite(bFav.golesCon))
    ? Math.round(((bFav.golesFav + bRiv.golesCon) / 2 + (bRiv.golesFav + bFav.golesCon) / 2) * 100) / 100
    : null;

  return {
    motivo: 'avisa',
    tipo,
    aceleracion: Number.isFinite(p.aceleracion) ? Math.round(p.aceleracion * 100) / 100 : null,
    posSobreEsperada,
    posEsperada,
    posSobreBase,
    posBase: bFav && Number.isFinite(bFav.posMedia) ? bFav.posMedia : null,
    golesEsperados,
    posicion: bFav && bFav.posicion ? bFav.posicion : null,
    posicionRival: bRiv && bRiv.posicion ? bRiv.posicion : null,
    equiposLiga: bFav && bFav.equipos ? bFav.equipos : null,
    id: p.id,
    lado: dominaLocal ? 'local' : 'visita',
    equipo: dominaLocal ? p.local : p.visita,
    rival: dominaLocal ? p.visita : p.local,
    golesEquipo: dominaLocal ? gl : gv,
    golesRival: dominaLocal ? gv : gl,
    marcador: `${gl}-${gv}`,
    indice: Math.round((dominaLocal ? d.valor : 1 - d.valor) * 1000) / 1000,
    minuto: p.minuto,
    ventana: `${ventana[0]}-${ventana[1]}`,
    estado: difGoles < 0 ? 'perdiendo' : 'empatando',
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

/**
 * ¿Hay que avisar de este partido ahora?
 * @param {{id,local,visita,golesLocal,golesVisita,minuto,liga,stats}} p
 * @returns {null | object} el aviso (con .tipo), o null. Con {conMotivo:true}
 *          devuelve {motivo} explicando el descarte (lo usa el calibrador).
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

  const gl = num(p.golesLocal) ?? 0;
  const gv = num(p.golesVisita) ?? 0;
  const noGana = (esLocal) => (esLocal ? gl - gv : gv - gl) <= 0;
  const estadoPedido = (esLocal) => {
    const dif = esLocal ? gl - gv : gv - gl;
    return dif < 0 ? cfg.avisarPerdiendo : cfg.avisarEmpatando;
  };

  const totalRemates = (d.crudos.shL || 0) + (d.crudos.shV || 0);
  const hayVolumen = totalRemates >= (minuto < 45 ? cfg.minRematesPartido.primera : cfg.minRematesPartido.segunda);

  // ---------------------------------------------------- gatillo 'remates'
  let descarteRemates = null;
  if (!hayVolumen) {
    descarteRemates = 'pocoVolumen';
  } else {
    const dominaLocal = d.valor >= cfg.umbral;
    const dominaVisita = 1 - d.valor >= cfg.umbral;
    if (!dominaLocal && !dominaVisita) {
      descarteRemates = 'noDomina';
    } else {
      const esLocal = dominaLocal;
      const posFav = d.comps.pos === null ? null : (esLocal ? d.comps.pos : 1 - d.comps.pos);
      const difSot = d.comps.sot === null ? null
        : (esLocal ? d.crudos.sotL - d.crudos.sotV : d.crudos.sotV - d.crudos.sotL);

      if (difSot !== null && difSot < cfg.minDifSot) descarteRemates = 'difSotBaja';
      else if (posFav !== null && posFav < cfg.minPosesion) descarteRemates = 'posesionMuyBaja';
      else if (!noGana(esLocal)) descarteRemates = 'vaGanando';
      else if (!estadoPedido(esLocal)) descarteRemates = 'estadoNoPedido';
      // El gatillo nuevo: solo si esta apretando AHORA. Si no hay dato de
      // aceleracion (primera muestra del partido) no se bloquea: se avisa igual
      // y queda registrado como aceleracion desconocida.
      else if (cfg.acelActiva && Number.isFinite(p.aceleracion) && p.aceleracion < cfg.minAceleracion) descarteRemates = 'noAcelera';
      else return empaquetar(p, d, ventana, esLocal, 'remates', gl, gv);
    }
  }

  // --------------------------------------------------- gatillo 'posesion'
  // Independiente del anterior: NO exige ventaja de remates, que es justo lo que
  // le impedia saltar al equipo de posesion esteril con cualquier peso.
  let descartePosesion = null;
  if (cfg.posesionActiva && d.comps.pos !== null && hayVolumen) {
    const local = d.comps.pos >= cfg.posesionGatillo;
    const visita = 1 - d.comps.pos >= cfg.posesionGatillo;
    if (!local && !visita) {
      descartePosesion = 'posesionInsuficiente';
    } else {
      const esLocal = local;
      if (!noGana(esLocal)) descartePosesion = 'posesionVaGanando';
      else if (!estadoPedido(esLocal)) descartePosesion = 'estadoNoPedido';
      else return empaquetar(p, d, ventana, esLocal, 'posesion', gl, gv);
    }
  }

  // Se reporta el descarte mas informativo: si el gatillo de posesion llego a
  // tener el balon suficiente y solo fallo por el marcador, eso dice mas que
  // "noDomina" del otro gatillo. Sin esto, la comparacion entre los dos
  // gatillos dentro de unas semanas seria ilegible.
  const informativo = descartePosesion === 'posesionVaGanando' ? descartePosesion : null;
  return fallo(informativo || descarteRemates || descartePosesion || 'noDomina');
}

module.exports = { detectar, indice, CFG };
