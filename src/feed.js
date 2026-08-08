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

// El feed viene en espanol (langId=14). Solo se traducen las cuatro que usa
// el indice de dominio; lo demas no hace falta.
const NOMBRES = {
  'Posesión': 'pos',
  'Total Remates': 'sh',
  'Remates a Puerta': 'sot',
  'Ataques': 'atk',
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
  // posesion: el feed la da como porcentaje del equipo; el indice usa la del local
  if (s.pos != null && s.pos > 1) s.pos /= 100;
  return Object.keys(s).length ? s : null;
}

module.exports = { partidosEnVivo, estadisticas };
