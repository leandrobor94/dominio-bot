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
  const bloques = avisos.map((a) => {
    const cab = a.estado === 'perdiendo' ? '🔴 domina y PIERDE' : '🟡 domina y empata';
    const lado = a.lado === 'local' ? '🏠' : '✈️';
    return [
      `${cab} · min ${a.minuto}`,
      `${lado} <b>${esc(a.equipo)}</b> vs ${esc(a.rival)}  <b>${a.marcador}</b>`,
      a.liga ? `<i>${esc(a.liga)}</i>` : null,
      `dominio <b>${(100 * a.indice).toFixed(0)}%</b> · remates ${a.crudos.shL ?? '—'}-${a.crudos.shV ?? '—'} · a puerta ${a.crudos.sotL ?? '—'}-${a.crudos.sotV ?? '—'}`,
      `posesión ${pc(a.comps.pos)} · ataques ${pc(a.comps.atk)}`,
      a.cobertura < 0.8 ? '⚠️ datos parciales' : null,
    ].filter(Boolean).join('\n');
  });

  return '🎛️ <b>DOMINIO</b> — control sin premio\n\n'
    + bloques.join('\n\n')
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
