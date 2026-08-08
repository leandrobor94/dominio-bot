'use strict';
// Prueba de extremo a extremo sin esperar a que haya un partido en ventana.
// Coge los partidos en vivo que haya AHORA, pide sus estadisticas, ensena el
// indice de dominio de cada uno y por que avisaria o no. No envia nada.
//
//   node probar.js              con las ventanas abiertas de par en par
//   node probar.js --telegram   ademas manda un mensaje de prueba al chat

const feed = require('./src/feed');
const { detectar, indice } = require('./src/dominio');
const notify = require('./src/notify');

const TODO_EL_PARTIDO = { ventanas: [[1, 98]] };

async function main() {
  const partidos = await feed.partidosEnVivo();
  console.log(`${partidos.length} partidos en vivo\n`);
  if (!partidos.length) {
    console.log('No hay futbol ahora mismo. Vuelve a probar en horario de partidos.');
    return;
  }

  const avisos = [];
  for (const p of partidos) {
    const stats = p.hayStats ? await feed.estadisticas(p) : null;
    await new Promise((r) => setTimeout(r, 900));

    const d = indice(stats);
    const res = detectar({ ...p, stats }, { ...TODO_EL_PARTIDO, conMotivo: true });
    const etiqueta = `${p.local} vs ${p.visita}`.slice(0, 38).padEnd(38);
    const ind = d ? `${(100 * d.valor).toFixed(0)}%` : '  —';

    console.log(
      `  min ${String(p.minuto).padStart(2)}  ${etiqueta} ${p.golesLocal}-${p.golesVisita}  ` +
      `dominio local ${ind.padStart(4)}  remates ${stats?.sh ?? '—'}-${stats?.sha ?? '—'}  ` +
      `a puerta ${stats?.sot ?? '—'}-${stats?.sota ?? '—'}  -> ${res ? res.motivo : 'sinResultado'}`
    );

    if (res && res.motivo === 'avisa') avisos.push(res);
  }

  console.log('');
  if (!avisos.length) {
    console.log('Ninguno cumple el filtro ahora mismo (es lo normal: solo ~8% lo cumple).');
    return;
  }
  const texto = notify.mensaje(avisos);
  console.log('--- mensaje que se enviaria ---');
  console.log(texto.replace(/<[^>]+>/g, ''));
  if (process.argv.includes('--telegram')) {
    console.log(await notify.enviar(texto) ? '\nEnviado.' : '\nNo se pudo enviar.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
