# Plan técnico del prototipo

Prototipo web para **depurar y equilibrar** las reglas de Elviña 1809. Sigue el stack y las convenciones de `49_Witch_Hunter_Digital_Clone` (que a su vez viene de `48_1997_EscapeFromNY` y `50_SoloGotMonth_Digital_Clones`): JS puro, motor puro como generador de decisiones y partidas grabadas como código.

Diferencias con Witch Hunter:
- **Dos jugadores** que deciden por turnos, también en el turno del otro (tácticas, arengas, salvar de la desbandada). Cada petición del motor dice **a quién** pregunta (`side`).
- **Información oculta:** las manos de Acción y el orden de los mazos. La interfaz en modo «hotseat» tapa la mano del jugador que no decide.
- El objetivo principal es el **equilibrio**: la simulación masiva con bots es un hito propio (M4).

---

## 1. Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Lenguaje | JS moderno con módulos ES + JSDoc, **sin build ni dependencias**; JSON con `import … with { type: 'json' }` | Igual que Witch Hunter |
| Interfaz | DOM + CSS sobre el mapa (`assets/board/map.webp`), se repinta tras cada decisión | El estado es pequeño y el motor es la única fuente de verdad |
| Aleatoriedad | mulberry32 con semilla, estado en `g.rng` | Partidas reproducibles |
| Tests | `node --test` (Node 22) | El motor no toca el DOM |
| Servidor | `python tools/serve.py 8012` (sin caché) | Los módulos ES no cargan desde `file://` |
| Datos e imágenes | Python + PyMuPDF + Pillow, solo en desarrollo | `extract_sources.py` (renders y PDF → PNG + textos de tácticas) y `build_assets.py` (PNG → WebP) |
| Móvil (más adelante) | Capacitor, como Witch Hunter y Paranormal | `tools/bundle.mjs` + `mobile/` |

**Idioma:** el código, en inglés; los textos del juego (cartas, tarjetas) y la interfaz, en **español**, porque el juego está impreso en español.

## 2. Arquitectura del motor

Como en Witch Hunter, **la partida entera es un generador** (`run(g)` en `game.js`):

- Cada decisión es `yield* choose(g, side, prompt, options)`; la sesión responde. Las de una sola opción se responden solas.
- **Una partida = setup + lista de respuestas** (`Session`): deshacer, rebobinar, guardar, códigos `E18.` + base64url(deflate(JSON)) y `tools/replay.mjs`.
- Pausas visibles (`beat`): tirada de dados, resultado aplicado, test de moral, cambio de control, para que la interfaz las anime.
- **Ventanas de tácticas** (docs/01 §11.1): en cada punto fijo, el motor pregunta primero al jugador activo y luego al otro si quieren jugar alguna táctica cuya `window` encaje; solo pregunta si hay alguna jugable.
- Fin de partida por excepción `GameEnd`.

```
src/engine/
  ask.js       choose / pick / confirm (con side), beat, GameEnd, log
  rng.js       mulberry32 y rollDie (con los dados forzados del escenario)
  data.js      catálogos (src/data/*.json) e índices
  state.js     consultas y cambios sin decisiones: condiciones de las órdenes, dados, cubos, bajas, eliminación, victoria
  combat.js    dados, relanzamientos, parejas, plazas, bajas
  morale.js    pérdidas, tests, desbandada, salvaciones (Reagrupación, Soult, Moore), reparto de pérdidas
  commanders.js  Moore (movimiento, Senda, arenga, muerte, la Artillería contra Moore)
  tactics.js   ventanas, regla de cada una de las 36 cartas (por id) y mercado
  turn.js      turno, activación, órdenes, refuerzos, racha, doble activación de Soult, reorganización
  game.js      preparación, opciones de reglas, escenario de depuración, bucle de rondas
  session.js   Session y códigos E18.
src/ai/        randomBot y greedyBot (y el automa oficial si aparece su material, docs/01 §13)
src/ui/        app.js (arranque, guardado), setup.js (bandos, reglas, escenario, códigos), view.js (mapa, ejércitos, manos, mercado, dados, registro, depuración)
```

Detalles del motor:
- **Toda carta está siempre en una zona.** Cartas de Acción: mano, mazo, descarte o `limbo` (la mano inicial mientras se elige y las dos cartas de Soult). Tácticas: mazo, fila o descarte del Mercado, o zona de un jugador. Los tests de simulación lo comprueban tras cada respuesta, junto con la conservación de los 25 cubos y que las fichas que pierde un bando coincidan con el contador de bajas del otro.
- El combate en curso vive en `g.combat` (las tácticas lo leen y lo cambian) y pasa a `g.lastCombat` al acabar.
- La victoria se comprueba en cada eliminación (`checkVictory` lanza `GameEnd`); si los dos bandos llegan a la vez, gana el activo (el atacante).

## 3. Herramientas de depuración

Las mismas que en Witch Hunter:
- **Escenario** en JSON (`DEFAULT_SETUP` en game.js): manos, cartas encima de los mazos, descartes, racha, control de las plazas, moral, bloques y estado de cada unidad, Moore, Soult, cubos, tácticas, Mercado y **dados forzados** (`dice`: los próximos resultados, en orden).
- **Opciones de reglas** (docs/01 §12).
- **Bot** por bando (humano / aleatorio / codicioso).
- **Deshacer** con suelo anti-trampas y **viaje en el tiempo** en Debug.
- **Códigos de partida** y `tools/replay.mjs`.

## 4. Interfaz (M2)

- **Pantalla:** a la izquierda, el mapa ilustrado con las fichas (bloques y discos en sus casillas impresas, cubos de control en Elviña y Palavea, Moore con su Senda), y debajo los dos ejércitos (moral con la zona de test marcada, fichas) y los comandantes. A la derecha, la decisión pendiente con el bando que decide y los dados del combate en curso; debajo, cada jugador (cubos, racha, mano, tácticas), el Mercado y el registro.
- **Bandos:** humano, bot codicioso o bot aleatorio, también a mitad de partida. Los bots se pueden pausar, avanzar de uno en uno o cambiar de velocidad.
- **Información oculta:** con un solo humano se ve su mano; con dos (hotseat), solo la del que decide. Depuración → «Ver las dos manos».
- **Preguntas automáticas** (barra superior): «Saltar ventanas sin cartas» (por defecto) pasa solas las ventanas de tácticas en las que solo se podría descartar 3; «Solo decisiones importantes» además no evita descartes del Mercado y roba la carta de arriba; «Preguntar todo» no responde nada solo.
- **Repetición** de cada respuesta, paso a paso, con las pausas (`beat`) del motor: turno, carta jugada, tirada, resultado, test de moral, riesgo y muerte de Moore (normal, lenta, rápida, con botón «Siguiente» o sin repetición). Al volver a un humano, «Lo que acaba de pasar» resume el registro desde la última decisión de un humano.
- **Hotseat:** con dos humanos, una pantalla «Pasa el dispositivo» cada vez que cambia el jugador que decide (se puede desactivar).
- **Deshacer** vuelve a la última decisión de un humano (con el suelo anti-trampas de la sesión); Depuración permite volver a cualquier decisión.
- **Móvil:** una columna, con la decisión fija abajo. La versión cuidada para móvil es parte de M5.
- **Pendiente:** animaciones de las fichas y las cartas (como `anim.js` de Witch Hunter).

## 5. Equilibrio (M4)

`tools/simulate.mjs`: miles de partidas bot contra bot, combinando bots y opciones de reglas. Informe por bando:
- % de victorias y forma de ganar (2 Divisiones / evacuación).
- Duración en rondas.
- Unidades que más caen, muertes de Moore y uso de Soult.
- Cubos ganados y gastados, y tácticas más compradas.

Sirve para responder, por ejemplo, si la Bayoneta como ±1 desequilibra, cuánto pesa la Senda del Sacrificio o qué cambia con las ideas de la v2.1.

## 6. Hoja de ruta

**Estado:** M0 ✅ · M1 ✅ · M2 ✅ (primera versión) · M3–M5 pendientes.

| Hito | Contenido | Hecho cuando |
|---|---|---|
| **M0 · Datos** | Imágenes (cartas, tarjetas, mapa ilustrado), textos de tácticas desde el PDF, tarjetas curadas a mano, posiciones del tablero; docs/01 con las decisiones `[D-n]` | ✅ 2026-10-23 |
| **M1 · Motor de 2 jugadores** | Todas las reglas de la v1.6c, las 36 tácticas, Moore y Soult, opciones de reglas; bots aleatorio y codicioso; tests por regla y simulación con invariantes | ✅ 2026-10-23: 30 tests; 6.000 partidas simuladas con todas las opciones, sin errores |
| **M2 · Prototipo de depuración** | Interfaz sobre el mapa, hotseat, escenario, deshacer, códigos, replay | ✅ 2026-10-24, primera versión: partidas a mano y bot contra bot en el navegador, sin errores |
| **M3 · Revisión de reglas** | Repasar las decisiones `[D-n]` con el diseñador; partidas a mano | decisiones confirmadas |
| **M4 · Equilibrio** | Simulador e informe; módulos de la v2.1 | primer informe |
| **M5 · Solitario y móvil** | Automa oficial (si aparece el material) y app Android | — |
