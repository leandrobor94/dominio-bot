'use strict';
// Bucle principal.
//
// POR QUE UN JOB LARGO Y NO UN CRON CADA 3 MINUTOS:
// GitHub Actions retrasa y se salta ejecuciones programadas, sobre todo con
// frecuencias altas y en repos con poca actividad. Un cron de */10 deja huecos
// de una hora dentro del mismo partido. Aqui el cron solo tiene que acertar
// 3 veces al dia; el intervalo real lo controla este bucle con un sleep, que
// no depende de nadie. (Leccion aprendida a base de datos perdidos en el bot
// hermano; no se cambia sin volver a medirlo.)
//
//   node run.js                 bucle de 290 minutos, avisa por Telegram
//   node run.js --una-vez       una pasada y sale
//   node run.js --dry           no envia nada, solo imprime
//   node run.js --minutos 60    duracion del bucle

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const feed = require('./src/feed');
const { detectar, CFG } = require('./src/dominio');
const notify = require('./src/notify');

const ESTADO = path.join(__dirname, 'estado.json');
const HISTORIAL = path.join(__dirname, 'historial.jsonl');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

const UNA_VEZ = flag('una-vez');
const DRY = flag('dry');
const SIN_RESUMEN = flag('sin-resumen');
const MINUTOS = Number(val('minutos', 290));
const INTERVALO_MS = Number(val('intervalo', 3)) * 60000;
const UMBRAL = Number(val('umbral', CFG.umbral));

// Margen para que el aviso no llegue justo cuando el partido ya cambio de fase
const VIDA_DEDUP_MS = 3 * 60 * 60 * 1000;

function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return { avisados: {} }; }
}
function guardarEstado(e) {
  const corte = Date.now() - VIDA_DEDUP_MS;
  for (const [k, v] of Object.entries(e.avisados)) if (!v || v.ts < corte) delete e.avisados[k];
  fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2));
}

/** Se guarda TODO lo mirado, no solo lo avisado: sin los negativos no se puede
 *  recalibrar el umbral mas adelante. */
function apuntar(filas) {
  if (!filas.length) return;
  const ts = new Date().toISOString();
  fs.appendFileSync(HISTORIAL, filas.map((f) => JSON.stringify({ ts, ...f })).join('\n') + '\n');
}

// ---------------------------------------------------------------- guardado
// El historial se sube CADA MEDIA HORA, no solo al final.
//
// Antes solo se guardaba al terminar el job, y con corridas de 4h50 eso
// significaba que los datos tardaban hasta cinco horas en llegar al repo — y si
// el job se cancelaba a mitad, ese tramo se perdia entero. El fichero es el
// unico activo que este bot acumula; no puede vivir cinco horas dentro de una
// maquina que GitHub puede apagar.
const GUARDAR_CADA_MS = 30 * 60000;
let ultimoGuardado = Date.now();

function gitGuardar(motivo) {
  if (!process.env.CI) return;              // en local no se toca el repo
  const cmd = (c) => execSync(c, { cwd: __dirname, stdio: 'pipe', encoding: 'utf8' });
  try {
    cmd('git add estado.json historial.jsonl');
    try {
      cmd('git diff --staged --quiet');
      return;                                // nada que guardar
    } catch { /* hay cambios, seguimos */ }
    cmd(`git commit -m "estado ${motivo}: ${new Date().toISOString().slice(0, 16)}Z"`);
    try { cmd('git pull --rebase --autostash'); } catch { /* si falla, el push dira */ }
    cmd('git push');
    console.log(`  historial subido (${motivo})`);
  } catch (e) {
    // Nunca tumbar el bucle por un fallo de git: el trabajo real es vigilar.
    console.log('  no se pudo subir el historial:', String(e.message || e).split('\n')[0].slice(0, 90));
  }
}

// Contadores de toda la corrida. Existen por una razon concreta: si el bot solo
// habla cuando hay aviso, el silencio es ambiguo — no se distingue "hoy ningun
// partido cumplio" de "el bot lleva tres dias caido". El resumen del final
// convierte el silencio en informacion.
const total = { vueltas: 0, vistos: 0, enVentana: 0, avisos: 0, motivos: {}, errores: 0 };

async function pasada(estado) {
  const partidos = await feed.partidosEnVivo();
  const enVentana = partidos.filter((p) =>
    CFG.ventanas.some(([a, b]) => p.minuto >= a && p.minuto <= b)
  );
  total.vistos += partidos.length;
  total.enVentana += enVentana.length;
  console.log(`  ${partidos.length} en vivo · ${enVentana.length} dentro de ventana`);
  if (!enVentana.length) return 0;

  const avisos = [];
  const registro = [];

  for (const p of enVentana) {
    // Solo se piden estadisticas de los partidos que estan en ventana: recorta
    // las peticiones a la cuarta parte y deja margen para ser educado con la API.
    const stats = p.hayStats ? await feed.estadisticas(p) : null;
    await new Promise((r) => setTimeout(r, 900));

    const res = detectar({ ...p, stats }, { umbral: UMBRAL, conMotivo: true });
    const motivo = res ? res.motivo : 'sinResultado';
    total.motivos[motivo] = (total.motivos[motivo] || 0) + 1;
    registro.push({
      id: p.id, min: p.minuto, marc: `${p.golesLocal}-${p.golesVisita}`,
      liga: p.liga, motivo: res ? res.motivo : 'sinResultado',
      tipo: res && res.tipo ? res.tipo : null,
      ind: res && res.indice != null ? res.indice : null, stats: stats || null,
    });

    if (!res || res.motivo !== 'avisa') continue;

    // El tipo entra en la clave: los dos gatillos son independientes y el mismo
    // partido puede merecer un aviso por cada uno.
    const clave = `${p.id}_${res.ventana}_${res.tipo}`;
    if (estado.avisados[clave]) continue;
    estado.avisados[clave] = { ts: Date.now(), minuto: p.minuto, estado: res.estado, tipo: res.tipo };
    avisos.push(res);
  }

  apuntar(registro);

  if (!avisos.length) {
    const motivos = {};
    for (const r of registro) motivos[r.motivo] = (motivos[r.motivo] || 0) + 1;
    console.log('  sin avisos ·', JSON.stringify(motivos));
    return 0;
  }

  for (const a of avisos) {
    console.log(`  >> ${a.estado.toUpperCase()} ${a.equipo} vs ${a.rival} ${a.marcador} min ${a.minuto} · dominio ${(100 * a.indice).toFixed(0)}%`);
  }

  const texto = notify.mensaje(avisos);
  // El dedup se apunta ANTES de enviar para no duplicar si algo falla a medias,
  // asi que hay que deshacerlo cuando el aviso no llego a salir. Incluye el modo
  // seco: si una prueba con --dry dejara la marca puesta, el siguiente arranque
  // de verdad se callaria justo esos partidos.
  const deshacer = () => { for (const a of avisos) delete estado.avisados[`${a.id}_${a.ventana}_${a.tipo}`]; };

  if (DRY) {
    console.log('  [dry] no se envia:\n' + texto.replace(/<[^>]+>/g, ''));
    deshacer();
  } else if (await notify.enviar(texto)) {
    console.log(`  enviado a Telegram (${avisos.length})`);
  } else {
    deshacer();
  }
  return avisos.length;
}

/** Latido: un mensaje al terminar la corrida, aunque no haya habido avisos. */
async function resumen() {
  const m = total.motivos;
  const orden = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const texto = [
    '🫀 <b>dominio-bot</b> — resumen de la corrida',
    `${total.vueltas} vueltas · ${total.vistos} partidos vistos · ${total.enVentana} en ventana`,
    `<b>${total.avisos}</b> aviso${total.avisos === 1 ? '' : 's'}` + (total.errores ? ` · ${total.errores} errores` : ''),
    orden.length ? '\n' + orden.map(([k, v]) => `· ${k}: ${v}`).join('\n') : null,
    total.enVentana === 0 ? '\n<i>Ningún partido llegó a los minutos 30-40 ni 68-80 mientras corría.</i>' : null,
  ].filter(Boolean).join('\n');

  console.log('\n' + texto.replace(/<[^>]+>/g, ''));
  if (!DRY && !SIN_RESUMEN) await notify.enviar(texto);
}

async function main() {
  console.log(`dominio-bot · umbral ${UMBRAL} · ventanas ${JSON.stringify(CFG.ventanas)}${DRY ? ' · DRY' : ''}`);
  const estado = leerEstado();
  const fin = Date.now() + MINUTOS * 60000;

  do {
    total.vueltas++;
    const t = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' });
    console.log(`[${t}] vuelta ${total.vueltas}`);
    try {
      total.avisos += await pasada(estado);
    } catch (e) {
      total.errores++;
      console.log('  error en la vuelta:', e.message);
    }
    guardarEstado(estado);
    if (Date.now() - ultimoGuardado >= GUARDAR_CADA_MS) {
      gitGuardar('parcial');
      ultimoGuardado = Date.now();
    }
    if (UNA_VEZ) break;
    const queda = fin - Date.now();
    if (queda <= INTERVALO_MS) break;
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  } while (Date.now() < fin);

  gitGuardar('final');
  await resumen();
}

main().catch((e) => { console.error(e); process.exit(1); });
