'use strict';

// Comprobación de frescura justo antes de enviar. Un aviso calculado minutos
// antes (p. ej. mientras se consultaba contexto/IA) no debe salir con un gol
// ya marcado o cuando terminó su ventana de primer tiempo.
function validarAviso(aviso, partido) {
  if (!partido) return 'partido_no_disponible';
  if (partido.minuto < 30 || partido.minuto > 40 ||
      !Number.isFinite(partido.minutoFeed) ||
      partido.minutoFeed < 30 || partido.minutoFeed > 40) return 'fuera_de_ventana';
  if (Math.abs(partido.minuto - partido.minutoFeed) > 5) return 'reloj_incierto';
  const marcadorActual = `${partido.golesLocal}-${partido.golesVisita}`;
  const marcadorAnterior = aviso.lado === 'local'
    ? `${aviso.golesEquipo}-${aviso.golesRival}`
    : `${aviso.golesRival}-${aviso.golesEquipo}`;
  if (marcadorActual !== marcadorAnterior) return 'marcador_cambio';
  return null;
}

module.exports = { validarAviso };
