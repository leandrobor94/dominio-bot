# Investigación de alertas de gol antes del descanso (27-09-2026)

## Qué se intenta predecir

Una alerta emitida entre los minutos 30 y 40 acierta **solo si hay al menos un gol después de recibirla y antes de terminar el primer tiempo**, incluida la compensación. No cuenta un gol del segundo tiempo ni un gol que ocurrió antes de que llegara el mensaje. La unidad de evaluación debe ser el **primer mensaje entregado por partido y tipo de señal**; los partidos sin final o descanso verificable son «sin etiqueta», no fallos. El reloj, el marcador y las estadísticas deben ser los disponibles *en ese instante*.

## Evidencia propia, hasta el 26 de septiembre

| Comparación | Resultado | Lectura |
| --- | ---: | --- |
| Candidatos 1T con desenlace verificable, 2–26 sep | 48/126 = 38,1 % | Base del filtro actual, no predicción de rentabilidad. |
| Candidatos 1T con desenlace verificable, 13–26 sep | 25/53 = 47,2 % | Mejora reciente observada, todavía con error amplio. |
| Base por minuto para esos 53 casos | 34,4 % | Comparación de reloj; no controla toda la selección. |
| Base por minuto y volumen para esos 53 | 36,8 % | El incremento que resta es modesto. |
| Posesión: todas / con más remates propios | 23/61 = 37,7 % / 20/49 = 40,8 % | La unión «posesión y remates» reduce volumen, pero no prueba un salto grande. |
| Señal experimental reloj + volumen, calibración 2–12 sep | 16/34 = 47,1 % | No avala por sí sola activarla. |
| Misma señal, prueba temporal 13–26 sep | 22/31 = 71,0 % | Prometedora, pero 31 casos y diferencia marcada entre períodos; todavía es sombra. |

Los primeros cinco renglones se reproducen con `analisis/alertas_2026-09-26_auditadas.csv`, `analisis/comparacion_reloj.csv` y `analisis/alertas_todas_enriquecidas.csv` del espacio de análisis local. Los dos últimos provienen de `analisis/prospectivo_1t_resultados_completo.csv`; el modelo congelado está en `src/ritmo-model.json`. Los porcentajes de 53 casos no deben mezclarse con los de 126 ni con los de 31: son poblaciones y señales diferentes. **El historial antiguo solo prueba que pasaron el filtro, no confirma entrega a Telegram**; por eso estas tasas son aproximaciones y la nueva bitácora de envíos es necesaria.

## Lo que el sistema observa y lo que no

El feed guarda remates, remates a puerta, posesión, ataques, córners y, con menor cobertura, grandes ocasiones y remates dentro del área. En la ventana reciente la disponibilidad de remates fue 90,2 %, a puerta 89,7 %, posesión 97,9 %, grandes ocasiones 44,4 % y remates dentro del área 28,6 % (`analisis/calidad_operativa.json`). No hay ubicación/ángulo de cada tiro, secuencia de posesiones ni presión defensiva detallada. La literatura de [StatsBomb sobre calidad de remates](https://statsbomb.com/articles/soccer/unpacking-ball-progression/) muestra por qué el conteo de tiros no reemplaza la calidad y el contexto de cada acción. [Los efectos del marcador](https://statsbomb.com/articles/soccer/score-effects/) también hacen peligroso interpretar igual los tiros del equipo que va perdiendo y los del que va ganando. [La investigación de modelos de amenaza por posesión](https://arxiv.org/abs/2011.09426) necesita eventos más finos que este feed.

Más variables no implican mejor resultado: la base es corta, hay ligas y equipos heterogéneos y varias estadísticas ricas faltan precisamente en ligas menores. Es preferible una abstención verificable a imputar «gran ocasión = 0» cuando el proveedor no la reporta.

## Hallazgos operativos de este cambio

1. `run.js` calculaba señales, esperaba potencialmente a Gemini y terminaba el barrido de partidos **antes** de enviar Telegram. Eso podía volver obsoleto un aviso. La IA ahora se consulta solo después del envío y permanece en sombra.
2. Antes, `motivo: avisa` en el historial significaba «pasó el filtro», no «llegó a Telegram». Ahora se registran por separado `envio_confirmado`, `envio_descartado` y `envio_fallido`; el sello de captura se conserva en las filas de observación. Para medir desempeño prospectivo se debe unir el evento entregado con su captura previa y etiquetar desde la **hora de entrega**.
3. Se consulta de nuevo el marcador y el reloj antes de enviar. Se abstiene si el partido salió de 30–40, cambió el marcador o el reloj del proveedor discrepa en más de cinco minutos. Un fallo del feed en esa comprobación suprime el aviso; no se presenta como victoria ni derrota.
4. Solo ocho capturas del 27 de septiembre tienen tanto `marcadorTs` como `statsTs`: el marcador precedía a la estadística por mediana de 22,5 segundos y tres tenían una divergencia de reloj superior a cinco minutos. **No hay alertas entregadas en esa muestra**. Es evidencia de riesgo técnico, no una estimación del cambio en acierto.
5. Gemini está configurado sin búsqueda web por defecto. Pedirle que «busque contexto» sin herramienta de búsqueda propiciaba contexto inventado; el prompt ahora dice explícitamente que solo puede usar los datos proporcionados. Su decisión no modifica Telegram.

## Qué falta antes de prometer 70 %

Mantener el detector de ritmo y el juicio de Gemini en sombra con configuración congelada. Durante las próximas semanas, registrar cada candidato, abstención, decisión y mensaje entregado; resolver el gol de la misma mitad con eventos del partido y marcar las etiquetas inciertas. Evaluar por **fecha y partido**, nunca dividir capturas del mismo encuentro entre entrenamiento y prueba. Comparar con la base por minuto, marcador y volumen; informar acierto, cobertura (avisos por día), tasa de datos faltantes e intervalos de confianza por partido. No seleccionar a posteriori el mejor de decenas de filtros como si fuera una prueba independiente: [scikit-learn explica el riesgo de fuga y selección en series temporales](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split).

Solo proponer un cambio de producción cuando un filtro congelado supere al actual y al reloj en **otro período prospectivo**, con suficientes casos para que el intervalo de incertidumbre sea útil. Llegar a 22/31 en dos semanas no demuestra una precisión verdadera de 70 %; tampoco puede garantizarse ese porcentaje para todas las ligas y horarios con estas fuentes. Una evaluación más rica de *dónde* y *cómo* se crean las ocasiones requeriría datos de eventos o tiros por ubicación que el feed actual no ofrece de forma sistemática.

La viabilidad de una IA como juez final se mediría con esa misma prueba prospectiva, sobre los **mismos candidatos**, y con la información que realmente tenga disponible antes del gol. No permitirle noticias posteriores, resultados finales ni estadísticas actualizadas después de la captura. Se mediría además abstención, latencia, coste y errores de identificación de partidos; sin mejora demostrada, seguirá en sombra.
