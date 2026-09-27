'use strict';

// Auditoría reproducible, de solo lectura. Distingue captura, escritura y envío.
// Uso: node scripts/auditar-tiempos.js [historial.jsonl]
const fs = require('node:fs');
const path = require('node:path');

const archivo = path.resolve(process.argv[2] || path.join(__dirname, '..', 'historial.jsonl'));
const lines = fs.readFileSync(archivo, 'utf8').split('\n');
const all = [];
for (const line of lines) {
  if (!line.trim()) continue;
  try { all.push(JSON.parse(line)); } catch { /* historial heredado puede tener líneas truncadas */ }
}

function quantiles(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const at = (q) => Math.round(a[Math.floor((a.length - 1) * q)] * 10) / 10;
  return { n: a.length, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) };
}
function seconds(a, b) {
  if (!a || !b) return null;
  const delta = (Date.parse(a) - Date.parse(b)) / 1000;
  return Number.isFinite(delta) ? delta : null;
}
const window = all.filter((x) => x.min >= 30 && x.min <= 40 && x.motivo !== 'observado');
const eligible = window.filter((x) => x.motivo === 'avisa');
const first = new Map();
for (const a of eligible) {
  const key = `${a.id}:${a.tipo}`;
  if (!first.has(key)) first.set(key, a);
}
const firstRows = [...first.values()];
const datedWindow = window.filter((x) => x.statsTs && x.marcadorTs);
const statsAge = datedWindow.map((x) => seconds(x.ts, x.statsTs)).filter(Number.isFinite);
const scoreAge = datedWindow.map((x) => seconds(x.statsTs, x.marcadorTs)).filter(Number.isFinite);
const minuteDrift = window.filter((x) => Number.isFinite(x.minFeed)).map((x) => x.min - x.minFeed);
const byDate = {};
for (const a of datedWindow) {
  const day = (a.statsTs || a.ts || '').slice(0, 10);
  (byDate[day] ||= []).push(seconds(a.ts, a.statsTs));
}
const recent = firstRows.filter((x) => (x.ts || '') >= '2026-09-13');
const confirmed = all.filter((x) => x.motivo === 'envio_confirmado');
const deliveryGap = [];
const latestCapture = new Map();
for (const x of all) {
  const key = `${x.id}:${x.tipo}`;
  if (x.motivo === 'avisa') latestCapture.set(key, x);
  if (x.motivo === 'envio_confirmado') {
    const capture = latestCapture.get(key);
    if (capture) deliveryGap.push(seconds(x.ts, capture.capturaTs || capture.statsTs || capture.ts));
  }
}
console.log(JSON.stringify({
  file: archivo,
  allRows: all.length,
  firstHalfWindowRows: window.length,
  eligibleFirstHalfRows: eligible.length,
  distinctEligibleByMatchType: firstRows.length,
  recentDistinctEligible: recent.length,
  confirmedDeliveries: confirmed.length,
  captureToDeliverySeconds: quantiles(deliveryGap),
  windowRowsWithSourceTimestamps: datedWindow.length,
  eligibleRowsWithSourceTimestamps: eligible.filter((x) => x.statsTs && x.marcadorTs).length,
  statsToBatchTimestampSeconds: quantiles(statsAge),
  scoreToStatsSeconds: quantiles(scoreAge),
  casesStatsToBatchOver60Seconds: statsAge.filter((x) => x > 60).length,
  casesStatsToBatchOver180Seconds: statsAge.filter((x) => x > 180).length,
  minuteDrift: quantiles(minuteDrift),
  minuteDriftOver5: minuteDrift.filter((x) => x > 5).length,
  byDateStatsToBatchSeconds: Object.fromEntries(Object.entries(byDate).map(([d, a]) => [d, quantiles(a)])),
}, null, 2));
