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

Si falta algún dato, los pesos se renormalizan con lo que haya. Además hacen falta tres
cosas más, para que "2 remates a 0" no dispare una alerta:

- **volumen mínimo** — 6 remates en el partido antes del minuto 45, 10 después
- **diferencia mínima** de 2 remates a puerta, cuando hay ese dato
- **suelo de posesión del 35 %** — guardarraíl, no umbral medido (ver abajo)
- **el que domina no va ganando** — perdiendo o empatando

## El segundo gatillo: 🧪 POSESIÓN (a prueba)

Hay un segundo detector, independiente, que salta con **≥65 % de posesión sin exigir
ventaja de remates**. Existe porque una medición sobre 551 partidos **contradijo el diseño
del primero**.

Partiendo los equipos en cuadrantes, los goles que meten en lo que queda de partido:

| | goles a favor |
|---|---|
| mucha posesión + pocos remates (*estéril*) | **0,758** |
| mucha posesión + muchos remates | 0,691 |
| poca posesión + muchos remates (*contragolpe*) | 0,418 |
| poca posesión + pocos remates | 0,370 |

Los dos cuadrantes **con** balón van por delante de los dos sin balón. Comparado de forma
pareada dentro del mismo partido —el que tiene la pelota contra el que tiene los remates,
mismo minuto y misma liga—: **+0,340 goles**, IC95 [0,157, 0,536], y aguanta Bonferroni
sobre las 35 comparaciones hechas.

Y hay un porqué mecánico: **la cuota de remates a puerta predice el marcador ya jugado a
AUC 0,891** — un gol *es* un remate a puerta. El primer gatillo estaba repitiendo en parte
el electrónico, que es información gastada.

El umbral de 65 % sale de medir los goles posteriores por escalón (n=770 observaciones de
equipos que no van ganando; media general 0,573):

| posesión | n | goles después | IC95 |
|---|---|---|---|
| ≥55 % | 246 | 0,780 | [0,64, 0,91] |
| ≥60 % | 141 | 0,858 | [0,62, 1,06] |
| **≥65 %** | 63 | **0,937** | [0,68, 1,25] |

Se eligió 65 % porque es el escalón más fuerte **y** dispara menos que la regla de remates
(8,2 % de las observaciones frente al 13,6 %), así que no infla el volumen.

### Por qué está "a prueba" y no ha sustituido al primero

1. **Puede ser calidad de dato, no fútbol.** Al minuto 60 hay ~5 remates a puerta en total:
   esa cuota se calcula sobre 5 sucesos y tiene un ruido binomial enorme. La posesión es
   continua y se mide con precisión. Quizá no es "la posesión importa más que rematar" sino
   "en este feed la posesión está bien medida y los remates a lo bruto".
2. **Con una etiqueta más corta el signo se invierte.** El mismo fichero medido sobre "gol
   en los próximos 15 minutos" da lo contrario. El hallazgo depende de la etiqueta.
3. **La etiqueta usada son ~40 minutos**, que se parece más a "qué equipo es mejor" que a lo
   que mira el bot, que son ventanas de 10.

Por eso corren los dos, marcados distinto, y se comparan con datos propios en unas semanas.

### El suelo del 35 % es un guardarraíl, no un hallazgo

Los datos **no** permiten fijar una posesión mínima para el gatillo de remates: por debajo
del 35 % solo había n=5 observaciones, y en la franja 35-40 %, n=1. Se puso en 35 % porque
recorta el único grupo claramente malo (0,200 goles) sin tocar el volumen (−0,7 %), y solo
se aplica cuando el dato de posesión existe. No se defiende como umbral medido.

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

Con umbral **0,68** (el de fábrica) y los dos gatillos activos, sobre el histórico real:

| gatillo | avisos | por día |
|---|---|---|
| 🎛️ remates | 18 | 4,5 |
| 🧪 posesión | 11 | 2,8 |
| **total** | **29** | **7,3** |

**El gatillo de posesión multiplica por nueve los avisos de "va perdiendo":**

| | avisos | perdiendo | empatando |
|---|---|---|---|
| solo remates | 18 | **1** | 17 |
| los dos | 29 | **9** | 20 |

Tiene sentido: un equipo con el 68 % del balón que va perdiendo es común —va persiguiendo
el partido—; uno que domina en remates *y* pierde es rarísimo, porque hace falta que el
rival marque en una de las pocas que tuvo.

Por qué se descarta el resto: nadie domina 29 %, sin datos de remates 27 %, pocos remates
todavía 19 %, va ganando 6,6 %.

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
