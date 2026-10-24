# Recorded games

Game codes (`E18.…`, «Copiar código» in the game) of real games, replayed by `tests/games.test.js`: each one must
replay whole and end in the same state (`fingerprint`). If a rule changes on purpose and a game stops matching,
look at where it diverges (`node tools/replay.mjs tests/games/<file> --decisions`) and, if the change is right,
remove or replace the game.

| File | Game |
|---|---|
| `2026-10-24-humano-fr-vs-bot-gb.e18` | The user (French) against the greedy British bot, 21 turns. French win: Bentinck and Manningham/Leith destroyed. Reviewed turn by turn on 2026-10-24: no rule errors. |
