# Elviña 1809 – game data

Image paths point at the game copies in `assets/` (WebP), built from the full-resolution crops in
`extracted/images/` (`tools/extract_sources.py`, then `tools/build_assets.py`).

| File | Generated? | Contents |
|---|---|---|
| `units.json` | **no, hand-curated** from the unit cards | 10 units (dice, activations, morale track, blocks, orders, modifiers, Moore's position) and the 2 commanders |
| `actions.json` | **no, hand-curated** from the card images | 30 Action cards (15 per side): unit, Inertia cubes, horse icon |
| `tactics.json` | texts from `extracted/tactics_raw.json`; `window` and one cost curated by hand | 36 Tactic cards + the card ideas of the v2.1 draft (`ideas_v21`, optional module) |
| `board.json` | **no, measured** on the full-resolution map | Elviña and Palavea, Moore's 3 positions, start slots of every unit (Paget: #1 and #2) |
| `../../extracted/tactics_raw.json` | yes (`extract_sources.py`) | Tactic texts as read from the PDFs, to check `tactics.json` against |

Texts are kept as printed. Each JSON has a `_notes` list with what its fields mean; the rules they encode are in
`docs/01-reglas-y-mecanicas.md`.
