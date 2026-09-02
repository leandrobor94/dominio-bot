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
const total = {
  vueltas: 0, vistos: 0, enVentana: 0, avisos: 0, motivos: {}, errores: 0,
  vueltasVacias: 0,      // el feed no devolvio ni un partido: sospechoso
  duraciones: [],        // para detectar que una vuelta tarda mas que el intervalo
  ultimoError: null,
  telegramFallos: 0,
};

// MEMORIA DE TRAYECTORIA.
// El bot ya no mira solo los partidos en ventana: muestrea todos para poder
// calcular como VIENE el partido, no solo como esta. El nivel (cuantos remates
// lleva) resulto ser peor que una moneda fuera de muestra; la aceleracion
// (cuantos lleva AHORA respecto a su propio ritmo) fue lo unico que aguanto.
const memoria = new Map(); // id -> [{min, tot}] con los ultimos vistazos

function recordar(id, minuto, totalRemates) {
  if (!Number.isFinite(totalRemates)) return;
  const h = memoria.get(id) || [];
  if (!h.length || minuto > h[h.length - 1].min) h.push({ min: minuto, tot: totalRemates });
  while (h.length > 8) h.shift();
  memoria.set(id, h);
}

/** Ritmo de remates de los ultimos ~10 min dividido por el ritmo del partido. */
function aceleracionDe(id, minuto, totalRemates) {
  const h = memoria.get(id);
  if (!h || h.length < 2 || !Number.isFinite(totalRemates) || minuto <= 0) return null;
  // el vistazo mas antiguo dentro de los ultimos 15 minutos
  const previo = h.filter((x) => x.min < minuto && minuto - x.min <= 15).sort((a, b) => a.min - b.min)[0];
  if (!previo) return null;
  const dmin = minuto - previo.min;
  if (dmin < 2) return null;
  const ritmoVentana = (totalRemates - previo.tot) / dmin;
  const ritmoPartido = totalRemates / minuto;
  if (!(ritmoPartido > 0)) return null;
  return ritmoVentana / ritmoPartido;
}

const enAlgunaVentana = (m) => CFG.ventanas.some(([a, b]) => m >= a && m <= b);

async function pasada(estado) {
  const partidos = await feed.partidosEnVivo();
  // Se observa todo el partido util; solo se AVISA dentro de las ventanas.
  const observables = partidos.filter((p) => p.hayStats && p.minuto >= 12 && p.minuto <= 96);
  const enVentana = partidos.filter((p) => enAlgunaVentana(p.minuto));
  total.vistos += partidos.length;
  total.enVentana += enVentana.length;
  if (!partidos.length) total.vueltasVacias++;
  console.log(`  ${partidos.length} en vivo · ${observables.length} observables · ${enVentana.length} en ventana`);
  if (!observables.length) return 0;

  const avisos = [];
  const registro = [];

  for (const p of observables) {
    const stats = await feed.estadisticas(p);
    await new Promise((r) => setTimeout(r, 700));

    const totalRemates = stats && Number.isFinite(stats.sh) && Number.isFinite(stats.sha) ? stats.sh + stats.sha : null;
    const acel = aceleracionDe(p.id, p.minuto, totalRemates);
    recordar(p.id, p.minuto, totalRemates);

    // Fuera de ventana solo se observa: alimenta la trayectoria y el historial.
    if (!enAlgunaVentana(p.minuto)) {
      registro.push({ id: p.id, min: p.minuto, marc: `${p.golesLocal}-${p.golesVisita}`, liga: p.liga, motivo: 'observado', acel, stats: stats || null });
      continue;
    }

    const ctx = await feed.contexto(p.competicion);
    const entrada = {
      ...p, stats, aceleracion: acel,
      baseLocal: ctx ? ctx.get(p.idLocal) : null,
      baseVisita: ctx ? ctx.get(p.idVisita) : null,
    };
    const res = detectar(entrada, { umbral: UMBRAL, conMotivo: true });
    const motivo = res ? res.motivo : 'sinResultado';
    total.motivos[motivo] = (total.motivos[motivo] || 0) + 1;
    registro.push({
      id: p.id, min: p.minuto, marc: `${p.golesLocal}-${p.golesVisita}`,
      liga: p.liga, motivo,
      tipo: res && res.tipo ? res.tipo : null,
      acel,
      posSobreBase: res && res.posSobreBase != null ? res.posSobreBase : null,
      ind: res && res.indice != null ? res.indice : null, stats: stats || null,
    });

    if (!res || res.motivo !== 'avisa') continue;

    // Se registro como aviso (queda en el historial y se puede auditar), pero
    // solo se envia si su ventana esta en la lista de envio.
    if (CFG.ventanasEnvio && !CFG.ventanasEnvio.includes(res.ventana)) continue;

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
    total.telegramFallos++;
    deshacer();
  }
  return avisos.length;
}

/**
 * PARTE DE SALUD. Va al final de cada corrida, haya avisos o no.
 *
 * Con los filtros nuevos el bot habla poco a proposito, y entonces el silencio
 * deja de distinguir "hoy no hubo nada que valiera la pena" de "el feed lleva
 * dos horas caido". Este mensaje tiene que responder a eso solo: si algo va
 * mal, que se vea en la primera linea sin leer el resto.
 */
async function resumen() {
  const NOMBRES = {
    observado: 'fuera de ventana (solo observado)',
    sinRemates: 'el feed no da remates',
    pocoVolumen: 'aún pocos remates',
    noDomina: 'nadie domina',
    noAcelera: 'domina pero no aprieta ahora',
    partidoRoto: 'partido roto (3+ de diferencia)',
    vaGanando: 'el que domina va ganando',
    difSotBaja: 'poca ventaja a puerta',
    posesionMuyBaja: 'sin la pelota',
    posesionVaGanando: 'manda la pelota pero gana',
  };

  const dur = total.duraciones;
  const durMedia = dur.length ? dur.reduce((a, b) => a + b, 0) / dur.length : 0;
  const lentas = dur.filter((d) => d > INTERVALO_MS).length;

  // Problemas, en orden de gravedad. Si esta lista esta vacia, todo va bien.
  const problemas = [];
  if (total.vueltas === 0) problemas.push('no completó ni una vuelta');
  if (total.vueltasVacias >= 3) problemas.push(`el feed devolvió 0 partidos en ${total.vueltasVacias} vueltas`);
  if (total.errores > 0) problemas.push(`${total.errores} vuelta(s) con error${total.ultimoError ? ': ' + total.ultimoError : ''}`);
  if (total.telegramFallos > 0) problemas.push(`${total.telegramFallos} envío(s) a Telegram fallaron`);
  if (lentas > 0) problemas.push(`${lentas} vuelta(s) tardaron más que el intervalo (${(durMedia / 1000).toFixed(0)}s de media)`);

  const sano = problemas.length === 0;
  const filtros = Object.entries(total.motivos)
    .filter(([k]) => k !== 'avisa' && k !== 'observado')
    .sort((a, b) => b[1] - a[1]).slice(0, 5);

  const texto = [
    sano ? '🫀 <b>dominio-bot</b> — todo en orden' : '🚨 <b>dominio-bot</b> — REVISAR',
    !sano ? problemas.map((p) => `⚠️ ${p}`).join('\n') : null,
    '',
    `${total.vueltas} vueltas · ${total.vistos} partidos mirados · ${total.enVentana} en ventana`,
    `<b>${total.avisos}</b> aviso${total.avisos === 1 ? '' : 's'} enviado${total.avisos === 1 ? '' : 's'}`,
    filtros.length ? '\n<i>por qué no avisó del resto:</i>\n' + filtros.map(([k, v]) => `· ${NOMBRES[k] || k}: ${v}`).join('\n') : null,
    total.enVentana === 0 ? '\n<i>Ningún partido llegó a las ventanas mientras corría — normal a horas muertas.</i>' : null,
    sano && total.avisos === 0 && total.enVentana > 0
      ? '\n<i>Cero avisos pero el bot funcionó: ninguno pasó los filtros. Es lo esperado la mayoría de las veces.</i>' : null,
  ].filter((l) => l !== null).join('\n');

  console.log('\n' + texto.replace(/<[^>]+>/g, ''));
  if (!DRY && !SIN_RESUMEN) await notify.enviar(texto);
}

async function main() {
  console.log(`dominio-bot · umbral ${UMBRAL} · ventanas ${JSON.stringify(CFG.ventanas)}${DRY ? ' · DRY' : ''}`);
  const estado = leerEstado();
  const fin = Date.now() + MINUTOS * 60000;

  do {
    total.vueltas++;
    const t0 = Date.now();
    const t = new Date().toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' });
    console.log(`[${t}] vuelta ${total.vueltas}`);
    try {
      total.avisos += await pasada(estado);
    } catch (e) {
      total.errores++;
      total.ultimoError = String(e.message || e).slice(0, 70);
      console.log('  error en la vuelta:', e.message);
    }
    total.duraciones.push(Date.now() - t0);
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
