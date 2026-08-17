'use strict';
// Cliente minimo de 365scores. Solo pide lo que este bot necesita:
// partidos en vivo, y estadisticas de los que estan dentro de una ventana.
//
// Deliberadamente NO se comparte codigo con gol-analyzer: son dos bots
// independientes que dan la casualidad de leer la misma API publica.

const API = 'https://webws.365scores.com/web';
const PARAMS = 'appTypeId=5&langId=14&timezoneName=America/Bogota&userCountryId=109';
const UA = 'Mozilla/5.0 (compatible; dominio-bot/1.0)';

async function pedir(url, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw ultimo;
}

/** Fecha de Colombia, no UTC: en Actions el runner va en UTC y pasada la
 *  medianoche pediria el dia siguiente, para el que no hay partidos todavia. */
function fechaColombia() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Minuto corregido. El feed a veces se queda congelado; se recalcula desde la
 * hora de inicio y se descarta el partido si el desfase es absurdo.
 */
function minutoReal(g, ahora) {
  if (!g.startTime) return g.gameTime || 0;
  const transcurrido = (ahora - new Date(g.startTime)) / 60000;
  let real;
  if (transcurrido <= 47) real = transcurrido;
  else if (transcurrido <= 62) real = 45;            // descanso
  else real = 45 + (transcurrido - 62);
  if (real > g.gameTime + 5) return Math.min(98, Math.round(real));
  return g.gameTime;
}

async function partidosEnVivo() {
  const f = fechaColombia();
  const url = `${API}/games/allscores/?${PARAMS}&sports=1&startDate=${f}&endDate=${f}&onlyLiveGames=true`;
  let j;
  try { j = await pedir(url); } catch { return []; }
  if (!j || !j.games) return [];

  const ahora = new Date();
  const salida = [];
  for (const g of j.games) {
    if (g.statusGroup !== 3 || !g.gameTime || g.gameTime <= 0) continue;
    const minuto = minutoReal(g, ahora);
    if (minuto >= 98) continue;
    salida.push({
      id: String(g.id),
      competicion: g.competitionId || null,
      local: (g.homeCompetitor && g.homeCompetitor.name) || '?',
      visita: (g.awayCompetitor && g.awayCompetitor.name) || '?',
      idLocal: g.homeCompetitor && g.homeCompetitor.id,
      idVisita: g.awayCompetitor && g.awayCompetitor.id,
      golesLocal: (g.homeCompetitor && g.homeCompetitor.score) ?? 0,
      golesVisita: (g.awayCompetitor && g.awayCompetitor.score) ?? 0,
      minuto,
      liga: (g.competitionDisplayName || '').trim() || null,
      hayStats: !!g.hasStats,
    });
  }
  return salida;
}

// El feed viene en espanol (langId=14).
//
// Las cuatro primeras alimentan el indice. El resto NO se usa para decidir: se
// guarda porque viene gratis en la misma peticion y sin ellas no se puede
// probar nada mas adelante. Los corners en particular llegan en el 100% de los
// partidos —mas que los remates, que llegan en el 89%— y llevabamos semanas
// tirandolos por una correlacion medida en otro contexto.
const NOMBRES = {
  // usadas por el indice
  'Posesión': 'pos',
  'Total Remates': 'sh',
  'Remates a Puerta': 'sot',
  'Ataques': 'atk',
  // guardadas para poder medir despues
  'Saques de Esquina': 'cor',
  'Remates Fuera': 'off',
  'Pelotas al poste': 'palo',
  'Grandes chances': 'bc',
  'Remates dentro del área': 'box',
  'Fueras de Juego': 'fj',
  'Tarjetas Amarillas': 'ta',
  'Tarjetas Rojas': 'tr',
  'Faltas': 'fal',
  'Saques de banda': 'sb',
  'Saques de puerta': 'sp',
};

/** Estadisticas de un partido: {sh, sha, sot, sota, atk, atka, pos} o null. */
async function estadisticas(p) {
  let j;
  try { j = await pedir(`${API}/game/stats/?${PARAMS}&games=${p.id}`, 2); } catch { return null; }
  if (!j || !Array.isArray(j.statistics) || !j.statistics.length) return null;

  const s = {};
  for (const st of j.statistics) {
    const clave = NOMBRES[st.name];
    if (!clave) continue;
    const valor = parseFloat(st.value);
    if (!Number.isFinite(valor)) continue;
    if (st.competitorId === p.idLocal) s[clave] = valor;
    else if (st.competitorId === p.idVisita) s[clave + 'a'] = valor;
  }
  // Posesion a 0-1 en los DOS lados. Antes solo se normalizaba la del local
  // porque era la unica que se leia; ahora que se guarda todo, dejarlas en
  // escalas distintas (0.58 y 42) romperia cualquier analisis posterior.
  for (const k of ['pos', 'posa']) if (s[k] != null && s[k] > 1) s[k] /= 100;
  return Object.keys(s).length ? s : null;
}

// ------------------------------------------------------------- linea base
// "¿Esta arrasando o juega asi siempre?" no se puede responder mirando solo el
// partido. El feed publica la media de temporada de cada equipo en
// competitorsStats, y la clasificacion da posicion y forma. Se cachea por
// competicion durante toda la corrida: cambia una vez por jornada, no cada
// vuelta.
const cacheCtx = new Map();

// El valor vive en fila.stats[0].value y viene como texto: "60%", "1,35".
// Leerlo de fila.statValue —que no existe— devolvia null siempre y dejaba la
// linea base vacia sin que nada fallara visiblemente.
const NUM = (fila) => {
  const bruto = fila && Array.isArray(fila.stats) && fila.stats.length ? fila.stats[0].value : null;
  if (bruto == null) return null;
  const n = parseFloat(String(bruto).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

async function contexto(competitionId) {
  if (!competitionId) return null;
  if (cacheCtx.has(competitionId)) return cacheCtx.get(competitionId);

  const base = new Map(); // idEquipo -> { posMedia, golesFav, golesCon, corners, pos, jugados, puntos }
  try {
    const j = await pedir(`${API}/stats/?${PARAMS}&competitions=${competitionId}&competitors=`, 2);
    for (const bloque of (j.stats && j.stats.competitorsStats) || []) {
      const clave = { 'Goles por partido': 'golesFav', 'Goles recibidos por partido': 'golesCon', 'Posesión del balón': 'posMedia', 'Cornes por partido': 'corners' }[bloque.name];
      if (!clave) continue;
      for (const fila of bloque.rows || []) {
        const id = fila.entity && fila.entity.id;
        if (!id) continue;
        if (!base.has(id)) base.set(id, {});
        base.get(id)[clave] = NUM(fila);
      }
    }
  } catch { /* sin medias de temporada */ }

  try {
    const j = await pedir(`${API}/standings/?${PARAMS}&competitions=${competitionId}&live=false`, 2);
    for (const tabla of j.standings || []) {
      for (const fila of tabla.rows || []) {
        const id = fila.competitor && fila.competitor.id;
        if (!id) continue;
        if (!base.has(id)) base.set(id, {});
        Object.assign(base.get(id), {
          posicion: fila.position, jugados: fila.gamePlayed, puntos: fila.points,
          equipos: (tabla.rows || []).length,
        });
      }
    }
  } catch { /* sin clasificacion: es normal en copas y amistosos */ }

  const res = base.size ? base : null;
  cacheCtx.set(competitionId, res);
  return res;
}

module.exports = { partidosEnVivo, estadisticas, contexto };
