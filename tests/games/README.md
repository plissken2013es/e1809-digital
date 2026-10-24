# Recorded games

Game codes (`E18.…`, «Copiar código» in the game) of real games, replayed by `tests/games.test.js`: each one must
replay whole and end in the same state (`fingerprint`). If a rule changes on purpose and a game stops matching,
look at where it diverges (`node tools/replay.mjs tests/games/<file> --decisions`) and, if the change is right,
remove or replace the game.

| File | Game |
|---|---|
| `2026-10-24-humano-fr-vs-bot-gb.e18` | The user (French) against the greedy British bot, 21 turns. French win: Bentinck and Manningham/Leith destroyed. Reviewed turn by turn on 2026-10-24: no rule errors. |
| `2026-10-24-humano-gb-vs-bot-fr-d54.e18` | The user (British) against the greedy French bot: the first 142 decisions are that game (reviewed on 2026-10-24: no rule errors; covers Soult's double activation, Moore felled on a move, Vacilación, A sangre y fuego and Maniobra sorpresa). In decision 143 the bot attacked Bentinck with the Artillery's −1 order while the plain one was there, which D-54 no longer offers, so two greedy bots finish it from there (24 turns, French win). |
| `2026-10-24-humano-gb-desbandadas.e18` | The user (British) against the French, 16 turns. British win: Delaborde and Merle routed by failed morale tests. Covers Cobardes, Baño de sangre, En el fragor, Riflemen vs. Voltigeurs, Coraje líquido, Soult, Curtido en mil batallas, Cirujanos, Rumores de muerte, Terreno escarpado and Voluntad. Reviewed on 2026-10-24: no rule errors. Decision 176 (Hill's orders) was re-answered by its label after D-54 renumbered them: same choice, Merle with 6 dice. |
