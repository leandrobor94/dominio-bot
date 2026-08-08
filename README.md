# dominio-bot

Avisa por Telegram cuando **un equipo está controlando el partido y no va ganando**, en el
minuto 30-40 o en el 68-80. Nada más.

No predice goles. No calcula cuotas. No dice si apostar. Es un **filtro**: te ahorra
revisar los partidos a mano y te pone delante el que merece un vistazo. La decisión es
tuya.

Es un bot **independiente** de `gol-analyzer`: no comparte una sola línea de código con él.
Da la casualidad de que leen la misma API pública y escriben en el mismo chat de Telegram,
y ya está. Se puede romper este sin tocar aquel.

---

## Qué cuenta como "dominar"

Un índice de 0 a 1 donde 0,5 es un partido parejo:

| componente | peso |
|---|---|
| remates a puerta | 0,45 |
| remates totales | 0,35 |
| ataques | 0,10 |
| posesión | 0,10 |

Si falta algún dato, los pesos se renormalizan con lo que haya. **Sin dato de remates no se
avisa**: la posesión sola engaña demasiado.

Además hacen falta tres cosas más, para que "2 remates a 0" no dispare una alerta:

- **volumen mínimo** — 6 remates en el partido antes del minuto 45, 10 después
- **diferencia mínima** de 2 remates a puerta, cuando hay ese dato
- **el que domina no va ganando** — perdiendo o empatando

### Por qué esos pesos y no otros

Está medido sobre **1.273 capturas reales** del feed, no elegido a ojo:

| dato | cobertura | decisión |
|---|---|---|
| remates y remates a puerta | 62-74 % | **base del índice** |
| posesión y ataques | 79-84 % | solo apoyo, nunca solos |
| córners | 81-87 % | **fuera** — correlación −0,030 con los goles, no informan |
| remates en el área | 11-25 % | inservible |
| grandes ocasiones | 23-26 % | inservible |
| xG | 56 % real | **fuera** — 365scores lo *estima* de los remates: contarlo sería contar dos veces |

El peso bajo de ataques y posesión no es estético. En un modelo hermano, meterlos como
señal principal **hundió** el rendimiento fuera de muestra: AUC 0,644 → 0,538. Entran para
desempatar y nada más.

---

## Calibración

Con umbral **0,68** (el de fábrica), sobre el histórico real:

```
umbral   avisos   avisos/día   perdiendo   empatando
  0,60      28        7,0           4          24
  0,64      26        6,5           4          22
  0,68      18        4,5           1          17   <- por defecto
  0,72      15        3,8           0          15
  0,76       8        2,0           0           8
  0,80       6        1,5           0           6
```

**"Domina y va perdiendo" es raro: 1 de cada 18 avisos.** Tiene sentido — para ir perdiendo
dominando hace falta que el rival marque en una de las pocas que tuvo. Lo habitual es
"domina y empata". El mensaje distingue los dos casos con 🔴 y 🟡.

Por qué se descarta el resto: nadie domina 35 %, sin datos de remates 27 %, pocos remates
todavía 19 %, el que domina va ganando 8 %.

> Esas cifras salen de 4 días y 307 partidos, y solo de los partidos que ya se estaban
> mirando. Sirven para **ordenar** umbrales, no como número absoluto. El real sale a los
> pocos días de tenerlo encendido, y entonces se recalibra con `npm run calibrar`.

---

## Uso

```bash
node probar.js          # prueba de extremo a extremo con lo que haya en vivo ahora
node run.js --una-vez --dry   # una pasada sin enviar nada
npm start               # el bucle de verdad (290 min)
npm run calibrar        # recalibra el umbral con el historial propio
```

Opciones de `run.js`: `--minutos 60`, `--intervalo 3`, `--umbral 0.72`, `--dry`.

### Encenderlo en GitHub Actions

1. Repo nuevo, sube esta carpeta.
2. En **Settings → Secrets and variables → Actions**, añade `TELEGRAM_BOT_TOKEN` y
   `TELEGRAM_CHAT_ID`. Pueden ser **los mismos del otro bot**: los mensajes llegan al mismo
   chat y se distinguen por la cabecera 🎛️ DOMINIO.
3. Listo. Corre solo, 3 veces al día, gratis.

---

## Detalles que costaron tiempo

- **Un job largo, no un cron cada 3 minutos.** GitHub Actions retrasa y se salta
  ejecuciones programadas, sobre todo con frecuencia alta y repos poco activos: un `*/10`
  deja huecos de una hora *dentro* del mismo partido. Como este bot vive de mirar los
  minutos 30-40 y 68-80, saltarse la ventana lo inutiliza. Por eso el cron solo tiene que
  acertar 3 veces al día y el intervalo real lo lleva `run.js` con un `sleep`. Los tres
  arranques van separados 5 h para durar 4 h 50 y **no solaparse**: con
  `cancel-in-progress: false`, un job que pisa al anterior queda encolado y arrastra
  retraso en cascada.
- **Solo se piden estadísticas de los partidos que están en ventana.** Recorta las
  peticiones a la cuarta parte y deja margen para ser educado con la API (0,9 s entre
  llamadas).
- **La fecha se calcula en hora de Colombia, no en UTC.** El runner de Actions va en UTC:
  pasada la medianoche pediría los partidos de mañana, para los que no hay nada.
- **El minuto se recalcula desde la hora de inicio.** El feed a veces se queda congelado;
  si el desfase es grande se corrige, y por encima del 98 se descarta el partido.
- **Telegram en modo HTML solo admite las entidades `&lt;` `&gt;` `&amp;`.** Un `&nbsp;`
  hace que rechace el mensaje entero con *can't parse entities*. Los nombres de equipo se
  escapan siempre: hay equipos con `&` en el nombre.
- **Se guarda todo lo mirado en `historial.jsonl`, no solo lo avisado.** Sin los negativos
  no se puede recalibrar el umbral más adelante, y ese fichero es el único activo que este
  bot acumula.

## Lo que este bot NO es

No tiene ventaja sobre el mercado y no pretende tenerla. Hay una auditoría aparte
(proyecto `prepartido`, 48.340 partidos fuera de muestra) que mide que un modelo de goles
no le gana al precio, y una medición sobre 76.385 partidos según la cual el favorito que
va perdiendo al descanso marca +2,8 puntos por encima de lo esperado — un efecto real, pero
del mismo tamaño que la comisión del mercado en vivo.

Este bot no depende de nada de eso, porque **no apuesta**. Solo mira y avisa.
