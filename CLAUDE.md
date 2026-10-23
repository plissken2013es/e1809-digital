# CLAUDE.md

Prototipo web de **Elviña 1809** (wargame de motor de cartas para 2 jugadores, batalla de Elviña / A Coruña, 16 de enero de 1809) para **depurar y equilibrar sus reglas**. Proyecto hermano de `49_Witch_Hunter_Digital_Clone` (mismo stack y convenciones) y `50_SoloGotMonth_Digital_Clones`. Privado: usa el arte del diseñador.

## Estado (actualizar en el mismo cambio que cierra cada hito)

- ✅ M0 datos: tarjetas, cartas y mapa → `src/data/*.json` + `assets/`; reglas y decisiones `[D-n]` en docs/01 (2026-10-23)
- ⏳ M1 motor de 2 jugadores · M2 interfaz · M3 revisión de reglas · M4 equilibrio · M5 solitario y móvil

## Documentos (leer antes de tocar reglas o código)

- `docs/01-reglas-y-mecanicas.md`: **fuente de verdad de las reglas** (basada en el reglamento v1.6c) y tabla de decisiones `[D-n]`, todavía **propuestas sin revisar** con el diseñador. Si el código la contradice, manda el documento. Cada decisión nueva va a esa tabla; si conviene probar las dos lecturas, conviértela en opción de reglas (§12).
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
- Motor puro (`src/engine/`): sin DOM, sin timers, sin `Math.random`. Generador de decisiones como en Witch Hunter; cada petición lleva el bando (`side`) que decide (docs/02 §2).
- Servir con `python tools/serve.py 8012` (sin caché; está en `.claude/launch.json`).

## Datos

- `python -I tools/extract_sources.py` → `extracted/images/` (recortes a resolución completa, fuera de git) y `extracted/tactics_raw.json` (textos de las 36 tácticas leídos de la capa de texto de los PDF). `python -I tools/build_assets.py` → `assets/**/*.webp`.
- `src/data/units.json`, `actions.json`, `board.json` y `tactics.json` están **curados a mano** (ver `src/data/README.md`). Los textos impresos se guardan tal cual en `text`; al lado va su lectura formal.
- Los textos de `tactics.json` deben coincidir con `extracted/tactics_raw.json` (test); el coste de *Reorganización* es la única excepción ([D-36]).
- Las posiciones de `board.json` están en píxeles del mapa a resolución completa (7016 × 4960).

## Tests

- `npm test`: hoy solo la coherencia de los datos (`tests/data.test.js`).
