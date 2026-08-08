'use strict';
// ¿Cuantos avisos al dia manda cada umbral?
//
// Es LA pregunta de un filtro. Uno que avisa de 40 partidos al dia no sirve de
// nada (es lo mismo que mirarlos a mano) y uno que habla una vez por semana,
// tampoco. Se recalibra cada pocas semanas contra el historial propio.
//
//   node calibrar.js                      usa historial.jsonl
//   node calibrar.js ruta/otro.jsonl      usa otro fichero de capturas

const fs = require('fs');
const path = require('path');
const { detectar, CFG } = require('./src/dominio');

const fichero = process.argv[2] || path.join(__dirname, 'historial.jsonl');
if (!fs.existsSync(fichero)) {
  console.log(`No existe ${fichero}.`);
  console.log('El historial se llena solo cuando el bot corre. Deja pasar unos dias y vuelve.');
  process.exit(0);
}

const filas = fs.readFileSync(fichero, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

// Acepta el formato propio (historial.jsonl) y el de capturas del bot hermano,
// que trae los mismos campos con otros nombres.
function normalizar(f) {
  if (f.stats && f.min !== undefined) {
    return { id: f.id, minuto: f.min, liga: f.liga, stats: f.stats, ts: f.ts,
      golesLocal: Number(String(f.marc || '0-0').split('-')[0]) || 0,
      golesVisita: Number(String(f.marc || '0-0').split('-')[1]) || 0,
      local: 'Local', visita: 'Visita' };
  }
  if (f.s && f.minute !== undefined) {
    return { id: f.id, minuto: f.minute, liga: f.lg, stats: f.s, ts: f.ts,
      golesLocal: f.sh ?? 0, golesVisita: f.sa ?? 0, local: 'Local', visita: 'Visita' };
  }
  return null;
}

const datos = filas.map(normalizar).filter(Boolean);
const dias = new Set(datos.map((d) => (d.ts || '').slice(0, 10)).filter(Boolean));
const enVentana = datos.filter((d) => CFG.ventanas.some(([a, b]) => d.minuto >= a && d.minuto <= b));

console.log(`capturas: ${datos.length} · partidos: ${new Set(datos.map((d) => d.id)).size} · dias: ${dias.size}`);
console.log(`dentro de ventana: ${enVentana.length}\n`);
console.log('umbral   avisos   partidos   avisos/dia   perdiendo   empatando');

for (const umbral of [0.60, 0.64, 0.68, 0.72, 0.76, 0.80]) {
  const vistos = new Set();
  const avisos = [];
  for (const d of enVentana) {
    const r = detectar(d, { umbral });
    if (!r || r.motivo !== 'avisa') continue;
    const clave = `${d.id}_${r.ventana}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    avisos.push(r);
  }
  const perd = avisos.filter((a) => a.estado === 'perdiendo').length;
  console.log(
    `  ${umbral.toFixed(2)}   ${String(avisos.length).padStart(6)}   ${String(new Set(avisos.map((a) => a.id)).size).padStart(8)}   ` +
    `${(dias.size ? avisos.length / dias.size : 0).toFixed(1).padStart(10)}   ` +
    `${String(perd).padStart(9)}   ${String(avisos.length - perd).padStart(9)}`
  );
}

console.log('\nMOTIVOS DE DESCARTE (umbral ' + CFG.umbral + '):');
const motivos = {};
for (const d of enVentana) {
  const r = detectar(d, { conMotivo: true });
  const m = r ? r.motivo : 'sinResultado';
  motivos[m] = (motivos[m] || 0) + 1;
}
for (const [k, v] of Object.entries(motivos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(5)}  ${((100 * v) / enVentana.length).toFixed(1)}%`);
}

console.log('\nOJO: los avisos/dia son de los partidos que el bot estaba mirando, no de todo');
console.log('el futbol. Sirve para ORDENAR umbrales; la cifra absoluta sale a los pocos dias');
console.log('de tenerlo encendido de verdad.');
