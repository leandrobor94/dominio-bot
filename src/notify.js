'use strict';
// Telegram. Va al MISMO chat que el otro bot, asi que el mensaje tiene que
// distinguirse de un vistazo: cabecera propia y ninguna cifra de probabilidad
// ni de cuota, que es justo lo que manda el otro.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pc = (x) => (x === null || x === undefined ? '—' : `${Math.round(100 * x)}%`);

function mensaje(avisos) {
  if (!avisos.length) return null;
  // El modo HTML de Telegram solo admite unas pocas etiquetas y SOLO las
  // entidades &lt; &gt; &amp;. Nada de &nbsp; ni de <br>: o lo imprime literal
  // o rechaza el mensaje entero con "can't parse entities".
  // Todas las cifras van "lo del que domina vs lo del rival", con el nombre
  // delante. La version anterior imprimia local-visitante y era imposible saber
  // de quien era cada numero.
  // Los dos gatillos se marcan distinto a proposito: el de posesion esta a
  // prueba y hay que poder juzgarlos por separado dentro de unas semanas.
  const bloque = (a) => {
    const marca = a.tipo === 'posesion' ? '🧪' : (a.estado === 'perdiendo' ? '🔴' : '🟡');
    const cab = a.estado === 'perdiendo' ? 'PIERDE' : 'EMPATA';
    const lado = a.lado === 'local' ? '🏠 en casa' : '✈️ de visita';
    const fila = (etiqueta, fav, riv) => `  ${etiqueta.padEnd(9)} <b>${fav ?? '—'}</b>  vs  ${riv ?? '—'}`;
    const titulo = a.tipo === 'posesion'
      ? `manda la pelota y ${cab}`
      : `domina y ${cab}`;
    return [
      `${marca} <b>${titulo.toUpperCase()}</b> · min ${a.minuto}`,
      `<b>${esc(a.equipo)}</b> ${a.golesEquipo}-${a.golesRival} ${esc(a.rival)}`,
      a.liga ? `<i>${esc(a.liga)}</i>` : null,
      '',
      a.tipo === 'posesion'
        ? `<b>${esc(a.equipo)}</b> tiene <b>${pc(a.comps.pos)}</b> de la pelota (${lado})`
        : `<b>${esc(a.equipo)}</b> domina al <b>${(100 * a.indice).toFixed(0)}%</b> (${lado})`,
      fila('remates', a.crudos.shFav, a.crudos.shRiv),
      fila('a puerta', a.crudos.sotFav, a.crudos.sotRiv),
      fila('posesión', pc(a.comps.pos), pc(a.comps.pos === null ? null : 1 - a.comps.pos)),
      fila('ataques', pc(a.comps.atk), pc(a.comps.atk === null ? null : 1 - a.comps.atk)),
      a.cobertura < 0.8 ? '⚠️ datos parciales' : null,
    ].filter((l) => l !== null).join('\n');
  };

  const porRemates = avisos.filter((a) => a.tipo !== 'posesion');
  const porPosesion = avisos.filter((a) => a.tipo === 'posesion');
  const partes = [];

  if (porRemates.length) {
    partes.push('🎛️ <b>DOMINIO</b> — control sin premio\n\n' + porRemates.map(bloque).join('\n\n'));
  }
  if (porPosesion.length) {
    partes.push('🧪 <b>POSESIÓN</b> — a prueba, manda pero no marca\n\n' + porPosesion.map(bloque).join('\n\n'));
  }

  return partes.join('\n\n───────────\n\n')
    + '\n\n<i>Filtro, no pronóstico. Mira el partido y decide.</i>';
}

/**
 * Cuando el envio falla, la API de Telegram devuelve mensajes que no dicen cual
 * de los dos secretos esta mal: un token invalido da "Not Found" a secas.
 * getMe separa los dos casos — si getMe funciona, el token es bueno y el
 * problema es el chat. Nunca se imprime el token, solo su forma y su longitud.
 */
async function diagnosticar(token) {
  const formaOk = /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token);
  let quien = null, tokenOk = false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    tokenOk = !!j.ok;
    quien = j.ok ? '@' + j.result.username : j.description;
  } catch (e) {
    quien = 'sin conexion: ' + e.message;
  }
  console.log(`  diagnostico: token de ${token.length} caracteres, forma ${formaOk ? 'correcta' : 'INCORRECTA (deberia ser 123456789:AA...)'}`);
  if (tokenOk) {
    console.log(`  -> el TOKEN es valido (bot ${quien}). El problema esta en TELEGRAM_CHAT_ID.`);
    console.log('     Sacalo abriendo https://api.telegram.org/bot<TU_TOKEN>/getUpdates tras escribirle al bot.');
  } else {
    console.log(`  -> el TOKEN es el problema: getMe responde "${quien}".`);
    console.log('     Revisa TELEGRAM_BOT_TOKEN: sin el prefijo "bot", sin espacios ni saltos de linea.');
  }
}

async function enviar(texto) {
  // .trim(): pegar el secreto con un salto de linea al final es el error mas
  // comun y produce un 404 identico al de un token invalido.
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) {
    console.log('  Telegram sin configurar (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const j = await r.json();
    if (!j.ok) {
      console.log(`  Telegram error: ${j.description} (http ${r.status})`);
      await diagnosticar(token);
      return false;
    }
    return true;
  } catch (e) {
    console.log('  Telegram fallo:', e.message);
    return false;
  }
}

module.exports = { mensaje, enviar };
