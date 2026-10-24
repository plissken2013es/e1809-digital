# Elviña 1809 — prototipo digital

Versión web de **Elviña 1809**, wargame de motor de cartas para dos jugadores sobre la batalla de Elviña (A Coruña, 16 de enero de 1809): Moore defiende el embarque británico frente a Soult. Es un prototipo para **depurar y equilibrar las reglas** (reglamento v1.6c).

**Jugar:** https://plissken2013es.github.io/e1809-digital/ · **Reglamento:** https://plissken2013es.github.io/e1809-digital/rules.html

- Dos jugadores en la misma pantalla, o contra un bot (cada bando puede ser humano o bot).
- Mapa ilustrado con las fichas, tarjetas de unidad, mano, Mercado de Táctica, dados 3D y registro.
- Cada decisión queda grabada: deshacer, guardar, compartir una partida como código (`E18.…`) y repetirla.

## En local

Sin dependencias ni compilación (JavaScript con módulos ES). Hace falta un servidor (los módulos no cargan desde `file://`):

```
python tools/serve.py 8012
```

y abrir http://localhost:8012. Tests: `npm test` (Node 22).

## Documentos

- [`docs/01-reglas-y-mecanicas.md`](docs/01-reglas-y-mecanicas.md): las reglas formalizadas y las decisiones `[D-n]` tomadas para la versión digital.
- [`docs/02-plan-tecnico.md`](docs/02-plan-tecnico.md): arquitectura, herramientas y hoja de ruta.

El arte, las cartas y el reglamento son del material del diseñador del juego; las escenas de combate usan pixel-art propio del autor del prototipo (de su versión digital de W1815); el código usa three.js y cannon-es (MIT, en `vendor/`) para los dados 3D.
