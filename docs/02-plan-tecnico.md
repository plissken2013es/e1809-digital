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
  rng.js       mulberry32
  data.js      catálogos (src/data/*.json) e índices
  state.js     estado inicial, consultas (en juego, control, condiciones de las órdenes)
  combat.js    dados, relanzamientos, parejas, plazas, bajas
  morale.js    tests, desbandada, salvaciones (Moore, Soult, Reagrupación)
  commanders.js  Moore (movimiento, Senda, apoyo, arenga, muerte) y Soult
  tactics.js   mercado y regla de cada una de las 36 cartas (por id)
  turn.js      planificación, combate, reorganización, racha de Inercia
  game.js      preparación, opciones de reglas, escenario de depuración, bucle de rondas
  session.js   Session y códigos E18.
src/ai/        randomBot, greedyBot y, si llega el material, el automa oficial (§13 de docs/01)
src/ui/        app.js, view.js (mapa, tarjetas, mano, mercado, registro, depuración)
```

## 3. Herramientas de depuración

Las mismas que en Witch Hunter:
- **Escenario** en JSON: cartas encima de los mazos, control de las plazas, moral y bloques de cada unidad, Senda de Moore.
- **Opciones de reglas** (docs/01 §12).
- **Bot** por bando (humano / aleatorio / codicioso).
- **Deshacer** con suelo anti-trampas y **viaje en el tiempo** en Debug.
- **Códigos de partida** y `tools/replay.mjs`.

## 4. Equilibrio (M4)

`tools/simulate.mjs`: miles de partidas bot contra bot, combinando bots y opciones de reglas. Informe por bando:
- % de victorias y forma de ganar (2 Divisiones / evacuación).
- Duración en rondas.
- Unidades que más caen, muertes de Moore y uso de Soult.
- Cubos ganados y gastados, y tácticas más compradas.

Sirve para responder, por ejemplo, si la Bayoneta como ±1 desequilibra, cuánto pesa la Senda del Sacrificio o qué cambia con las ideas de la v2.1.

## 5. Hoja de ruta

**Estado:** M0 ✅ · M1–M5 pendientes.

| Hito | Contenido | Hecho cuando |
|---|---|---|
| **M0 · Datos** | Imágenes (cartas, tarjetas, mapa ilustrado), textos de tácticas desde el PDF, tarjetas curadas a mano, posiciones del tablero; docs/01 con las decisiones `[D-n]` | ✅ 2026-10-23 |
| **M1 · Motor de 2 jugadores** | Todas las reglas de la v1.6c, las 36 tácticas, Moore y Soult, opciones de reglas; bots aleatorio y codicioso; tests por regla y simulación con invariantes | partidas completas bot contra bot sin errores |
| **M2 · Prototipo de depuración** | Interfaz sobre el mapa, hotseat, escenario, deshacer, códigos, replay | partida jugable a mano |
| **M3 · Revisión de reglas** | Repasar las decisiones `[D-n]` con el diseñador; partidas a mano | decisiones confirmadas |
| **M4 · Equilibrio** | Simulador e informe; módulos de la v2.1 | primer informe |
| **M5 · Solitario y móvil** | Automa oficial (si aparece el material) y app Android | — |
