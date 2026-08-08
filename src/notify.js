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

async function enviar(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
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
    if (!j.ok) { console.log('  Telegram error:', j.description); return false; }
    return true;
  } catch (e) {
    console.log('  Telegram fallo:', e.message);
    return false;
  }
}

module.exports = { mensaje, enviar };
