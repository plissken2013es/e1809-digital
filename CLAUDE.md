# CLAUDE.md

Prototipo web de **Elviña 1809** (wargame de motor de cartas para 2 jugadores, batalla de Elviña / A Coruña, 16 de enero de 1809) para **depurar y equilibrar sus reglas**. Proyecto hermano de `49_Witch_Hunter_Digital_Clone` (mismo stack y convenciones) y `50_SoloGotMonth_Digital_Clones`. Privado: usa el arte del diseñador.

## Estado (actualizar en el mismo cambio que cierra cada hito)

- ✅ M0 datos: tarjetas, cartas y mapa → `src/data/*.json` + `assets/`; reglas y decisiones `[D-n]` en docs/01 (2026-10-23)
- ✅ M1 motor de 2 jugadores: todas las reglas de la v1.6c, 36 tácticas, Moore, Soult, opciones de reglas, bots aleatorio y codicioso (2026-10-23)
- ⏳ M2 interfaz · M3 revisión de reglas · M4 equilibrio · M5 solitario y móvil

## Documentos (leer antes de tocar reglas o código)

- `docs/01-reglas-y-mecanicas.md`: **fuente de verdad de las reglas** (basada en el reglamento v1.6c) y tabla de decisiones `[D-n]`: las marcadas ✔ están confirmadas (12, revisadas el 2026-10-23); el resto siguen siendo propuestas. Si el código la contradice, manda el documento. Cada decisión nueva va a esa tabla; si conviene probar las dos lecturas, conviértela en opción de reglas (§12).
- `docs/02-plan-tecnico.md`: arquitectura, herramientas y hoja de ruta.

## Material de origen

`__ProyectoTipoFreemansFarm/` (fuera de git, no se edita):
- `Reglas Elviña 1809_v1.6b.pdf`: reglamento **v1.6c** (2026-02), el que manda.
- `_Iñaki/…v2.1.odt`: borrador de revisión de 2023, **anterior** a la v1.6c pese al número; solo aporta ideas (docs/01 §15). Usa tachado manual, no control de cambios.
- `Reglas…v1.0b.pdf`: primera versión (2023), solo histórico.
- `render/versión Tabletopia/`: hojas de cartas sin sangrado (acción y tácticas de 2026-02; tarjetas de unidad de 2022).
- `__reordenado para IA/`: lo más nuevo (2026-02): mapa ilustrado A2, tarjetas de Moore y Soult con arte nuevo, PDF de tácticas con capa de texto.

## Stack y convenciones

- **JS puro con módulos ES, sin build ni dependencias**; JSON con `with { type: 'json' }`. Código en inglés; **textos del juego e interfaz en español** (el juego está impreso en español); documentos en español.
- Motor puro (`src/engine/`): sin DOM, sin timers, sin `Math.random` (PRNG en `g.rng`; los dados con `rollDie`, que respeta los dados forzados del escenario).
- **El motor es un generador** (`run(g)` en game.js), como en Witch Hunter: cada decisión es `yield* choose(g, side, …)` / `pick` / `confirm` (ask.js) y **lleva el bando que decide** (`side`), porque los dos deciden también en el turno del otro. Las de una sola opción se responden solas. Olvidar el `yield*` deja la regla sin ejecutar sin dar error. `kind` clasifica la petición para los bots y la interfaz.
- Las funciones de state.js no preguntan (no son generadores); las que pueden preguntar (morale, commanders, combat, tactics, turn) sí.
- **Tácticas:** cada carta en `RULES` de tactics.js (`can` + `play`), ofrecida por `tacticWindow(g, punto, ctx)` según su `window` (docs/01 §11.1). *Reagrupación* va en morale.js, *A sangre y fuego* en las órdenes (turn.js) y *Los hombres están agotados* en `rerollCubeCost`.
- `Session` (session.js) = setup + respuestas: deshacer (con suelo en la última respuesta que movió el PRNG), rebobinar, códigos `E18.` y `node tools/replay.mjs fichero --state --decisions`.
- Servir con `python tools/serve.py 8012` (sin caché; está en `.claude/launch.json`).

## Datos

- `python -I tools/extract_sources.py` → `extracted/images/` (recortes a resolución completa, fuera de git) y `extracted/tactics_raw.json` (textos de las 36 tácticas leídos de la capa de texto de los PDF). `python -I tools/build_assets.py` → `assets/**/*.webp`.
- `src/data/units.json`, `actions.json`, `board.json` y `tactics.json` están **curados a mano** (ver `src/data/README.md`). Los textos impresos se guardan tal cual en `text`; al lado va su lectura formal.
- Los textos de `tactics.json` deben coincidir con `extracted/tactics_raw.json` (test); el coste de *Reorganización* es la única excepción ([D-36]).
- Las posiciones de `board.json` están en píxeles del mapa a resolución completa (7016 × 4960).

## Tests

- `npm test`: datos (`data.test.js`), reglas con escenarios y dados forzados (`rules.test.js`) y simulación (`simulation.test.js`: bots aleatorio, codicioso y mixto con todas las opciones de reglas; invariantes tras cada respuesta). `SIM_GAMES=2000 npm test` para más partidas.
- Helpers en `tests/helpers.js`: `answer(session, 'texto de la opción')`, `until(session, 'texto del prompt', passive)`, `checkInvariants(g)`, `playOut(session, bot)`, `bySide({ french, british })`.
