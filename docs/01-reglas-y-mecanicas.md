# Elviña 1809 — Reglas y mecánicas

Documento de diseño del clon digital. Formaliza las reglas del juego a partir de:

- `__ProyectoTipoFreemansFarm/Reglas Elviña 1809_v1.6b.pdf` (reglamento **v1.6c**, 18 páginas, febrero de 2026): **fuente de verdad**.
- Las tarjetas y cartas impresas, pasadas a `src/data/` (`units.json`, `actions.json`, `tactics.json`, `board.json`).
- `_Iñaki/Reglas Elviña 1809__v2.1.odt` (borrador de revisión de febrero de 2023, anterior a la v1.6c pese al número): solo como fuente de **ideas y variantes** (§15).

**Este documento manda sobre el código.** Cuando el reglamento es ambiguo, se contradice con una tarjeta o no cubre un caso, la regla lleva una marca **[D-n]** y la decisión tomada está en la [§14](#14-decisiones-para-la-versión-digital). Las decisiones que conviene poder probar de las dos maneras son **opciones de reglas** del setup (§12).

El texto exacto de cada tarjeta y carta está en `src/data/`; aquí solo se explica cómo se interpreta.

---

## 1. Resumen

- **Jugadores:** 2 (británico y francés). Solitario contra un automa en §13 (falta material).
- **Motor de cartas:** cada bando tiene un mazo de 15 cartas de Acción; cada carta activa una Unidad y da cubos de Inercia. Mano de 3.
- **Ronda:** turno francés y luego turno británico. Unas 15 rondas: la partida acaba cuando ninguno tiene cartas en la mano.
- **Victoria:** eliminar 2 Divisiones enemigas (destruidas o desbandadas). Si se acaban las cartas, gana el británico (evacuación).
- **Tablero estático:** las unidades no se mueven, salvo Paget (#1 → #2) y Moore (#1, #2, #3). Se disputan dos plazas, Elviña y Palavea.

## 2. Componentes en juego

| Componente | Estado digital |
|---|---|
| Unidad (tarjeta de División) | bloques en el tablero, moral (0..máx.; la Reserva no tiene), eliminada (destruida / desbandada), posición (Paget) |
| Moore | posición (1..3), Senda del Sacrificio (1..12), abatido (pendiente de retirar / retirado) |
| Soult | disponible / agotado |
| Elviña, Palavea | bando que la controla |
| Mazo de Acción (×2) | mazo, mano, cartas jugadas (en orden, para la racha de Inercia) |
| Inercia | reserva común (25 cubos, [D-24]) y reserva de cada jugador |
| Mercado de Táctica | mazo, fila de 3 cartas (con los cubos que tengan encima), descarte |
| Tácticas de cada jugador | boca arriba en su zona; permanentes en juego |
| Contador de bajas (×2) | fichas del rival recibidas y umbrales ya cobrados (§4.4) |

Unidades (`units.json`):

| Bando | Unidad | Dados | Moral | Bloques | Cartas de Acción | Moore |
|---|---|---|---|---|---|---|
| Británico | Hill | 5 | 10 | 3 | 3 | #3 |
| | Bentinck | 5 | 10 | 3 | 4 | #1 |
| | Paget | 5 | 9 | 2 | 2 | #1 |
| | Manningham/Leith | 5 | 10 | 3 | 4 | #2 |
| | Reserva (Crawfurd/Warde) | 0 | — | 3 | 2 | — |
| Francés | Mermet | 5 | 11 | 5 | 4 | |
| | Delaborde | 5 | 10 | 4 | 3 | |
| | Merle | 4 | 11 | 5 | 4 | |
| | La Houssaye (caballería) | 4 | 9 | 2 | 2 | |
| | Artillería | 4 | 10 | 3 discos | 2 | |

## 3. Preparación

1. Cada unidad con su moral al máximo y sus bloques en el tablero. Paget y Moore en #1. La Senda del Sacrificio de Moore en 1. Soult disponible.
2. Elviña y Palavea, británicas.
3. Cada jugador baraja su mazo de Acción. El británico roba 5 y el francés 6; cada uno se queda 3 (mano oculta) y devuelve el resto al mazo, que se baraja [D-34].
4. Se baraja el mazo de Táctica y se ponen 3 cartas boca arriba (Mercado).
5. Reserva común de 25 cubos de Inercia; cada jugador toma 2.
6. Empieza el francés.

## 4. Conceptos

### 4.1 Unidades, órdenes y modificadores

- Cada tarjeta trae sus **órdenes** (alternativas, separadas por «~») y sus **modificadores** de dados. Al activarla, el jugador elige **una** orden posible [D-11]:
  - **Condiciones:** «Si Elviña es francesa», «Si X está derrotado», «Si está en Paget#2»…
  - **Objetivo válido:** una unidad enemiga en juego, o una plaza que controla el enemigo [D-12].
  - «Derrotado», «destruido» y «muerta» significan **eliminada** (destruida o desbandada); «Artillería» y «Artillería activa», que sigue en juego [D-10].
- Si ninguna orden es posible, se aplica §5.4.
- Dados del combate = dados de la tarjeta + modificador de la orden + modificadores de la tarjeta que se cumplan + apoyo de Moore + Soult + tácticas. Mínimo 1 [D-21].
- **Bayoneta** (Hill, Bentinck, Manningham/Leith): ver [D-1].
- **Reserva:** no combate, no tiene moral, no se desbanda y no cuenta como eliminada aunque se quede sin bloques. Solo refuerza.

### 4.2 Elviña y Palavea

- Se controlan con un cubo del color del bando. Empiezan británicas.
- **Defensores:** de Elviña, Bentinck y/o Manningham/Leith (británica) o Merle y/o Mermet (francesa); de Palavea, Hill o Delaborde.
- Un ataque a una plaza que causa **al menos una baja** al defensor le cambia el control. La primera baja de ese combate no retira ficha; las siguientes sí, de los defensores [D-13].
- Las pérdidas de moral y de bloques del defensor de Elviña las reparte su dueño entre los defensores que sigan en juego.
- Si Hill o Delaborde se eliminan, Palavea pasa al enemigo; lo mismo con Elviña si caen todos sus defensores [D-14].
- El control da dados (modificadores de las tarjetas) y abre órdenes («Si Elviña es francesa, atacar a Bentinck»).

### 4.3 Inercia de Combate

- **Se gana:**
  - Con las cartas de Acción (iconos) o los 5 cubos de Soult.
  - Con la racha (§9).
  - Con cada 3 en los dados del atacante.
  - Con los umbrales de bajas (§4.4).
  - Con los cubos que haya sobre una táctica comprada.
  - Con 2 extra si la unidad activada no tiene objetivos (§5.4).
  - Con 3 al descartar 3 tácticas [D-30].
- **Se gasta:**
  - Relanzar dados: 3, o 4 contra *Los hombres están agotados*.
  - Comprar tácticas (su coste).
  - Elegir la carta de Acción que se roba: 5.
  - Evitar el descarte del Mercado: 1 (solo el jugador activo).
- Sale y vuelve a la reserva común, que es limitada [D-24].

### 4.4 Bajas y contador de bajas

- Cada bloque o disco **retirado por cualquier motivo** se entrega al rival, que lo pone en su contador de bajas [D-18]. Cuenta cualquier retirada: combate, pago de activación, pago de relanzamiento o desbandada. Los bloques que se mueven al reforzar no cuentan.
- Umbrales, que se cobran una sola vez cada uno:
  - **Francés:** +1 cubo al llegar a 5 bajas británicas y +2 al llegar a 10.
  - **Británico:** +1 al llegar a 4 bajas francesas, +2 a las 8 y +3 a las 12.
- Una unidad sin bloques queda **destruida**, salvo la Reserva. Una unidad eliminada no vuelve ni recibe refuerzos.

## 5. Turno

### 5.1 Planificación

1. Jugar una carta de Acción de la mano. Un francés con Soult disponible puede usar su doble activación en su lugar (§8.2).
2. Recibir los cubos de la carta (y la racha, §9).
3. Solo el británico, y es opcional: mover a Moore (§8.1).
4. Pagar el coste de activación de la unidad: −1 moral o retirar 1 bloque, a elección. La Reserva no paga [D-17]. No se paga si la unidad no tiene ninguna orden posible (§5.4).

### 5.2 Combate

1. **Comprobar la desbandada.** Si el pago de activación ha llevado la moral a 5 o menos, se hace el test (§7). Si falla, la unidad se desbanda y el turno pasa a la Reorganización.
2. **Orden.** Se ejecuta la orden elegida: combate (§6), refuerzo (§10) o movimiento de Paget.

### 5.3 Reorganización y repliegue

1. **Mercado** (§11): comprar una táctica, o descartar la de la derecha salvo que alguien lo evite.
2. **Robar** una carta de Acción hasta tener 3, si quedan en el mazo. Pagando 5 cubos se puede elegir la carta en vez de robarla, y después se baraja el mazo [D-25].

Las tácticas se juegan en sus momentos (§11.1), también en el turno del rival. En cada momento, los jugadores se turnan carta a carta, empezando por el activo, hasta que los dos pasan seguidos [D-50].

### 5.4 Sin objetivos disponibles

Si la unidad activada no puede cumplir ninguna orden (o ya está eliminada):
- Recibe los cubos de la carta.
- No paga el coste de activación.
- Recibe +2 cubos.
- La carta cuenta como jugada.

## 6. Combate

1. Se fija el número de dados (§4.1). Antes de la primera tirada se juegan las tácticas «antes del combate» y se decide el apoyo de Moore (+1 dado o relanzamiento gratuito, [D-4]).
2. El atacante tira. **Tras cada tirada** puede relanzar los dados que quiera (algunos o todos) tantas veces como quiera [D-20], pagando cada relanzamiento con una de estas opciones:
   - 3 cubos de Inercia.
   - −1 moral de la unidad activa. El test se hace al momento y, si se desbanda, el combate termina con la última tirada.
   - Retirar 1 bloque de la unidad activa. Si se queda sin bloques, el combate termina igual.
3. Se aplica la **última** tirada. Por cada pareja [D-22]:

| Pareja | Efecto |
|---|---|
| 1-1 | baja del atacante |
| 2-2 | −1 moral del atacante |
| cada 3 (sin pareja) | +1 cubo al atacante |
| 4-4 | −1 moral del defensor |
| 5-5 | −1 moral del defensor |
| 6-6 | baja del defensor |

   - Tres iguales cuentan como una pareja, cuatro como dos y seis como tres.
   - **Artillería atacante** [D-9]: las parejas de 1 cuentan como de 6 y los 2 no tienen efecto.
4. Se aplican todos los resultados; después se hace el test de moral de cada unidad que haya perdido moral, primero el del defensor y luego el del atacante (§7).
5. Si en el mismo combate se cumplen a la vez las condiciones de victoria de los dos bandos, gana el atacante.

## 7. Moral y desbandada

- Cada vez que una unidad pierde moral y queda en **5 o menos**, tira 1 dado. Si sale **más** que su moral, se desbanda: se retiran sus bloques y queda eliminada. Hay **un test por golpe**, con la moral que queda tras él, aunque el golpe quite varios puntos [D-15]. Cuenta como un golpe:
  - El pago de la activación.
  - El pago de un relanzamiento.
  - Todos los resultados de una tirada sobre esa unidad.
  - El efecto de una carta o de la muerte de Moore sobre esa unidad.
- Con moral 0 queda eliminada sin test ni salvación.
- Subir la moral no provoca test. La moral no supera su máximo inicial [D-37].
- **Salvar de la desbandada** tras un test fallido [D-16]:
  - La arenga de Moore (§8.1).
  - Soult (§8.2).
  - La táctica *Reagrupación*.
  - La táctica *Arenga* se juega antes del test: +2 al límite.

## 8. Comandantes

### 8.1 Sir John Moore

- **Posiciones e influencia:**
  - #1: Paget y Bentinck [D-5].
  - #2: Manningham/Leith.
  - #3: Hill.
- **Apoyo:** en un combate de una unidad bajo su influencia, una de estas dos ventajas [D-4]:
  - +1 dado.
  - Un relanzamiento gratuito.
- **Movimiento:** solo en la planificación británica, una vez por turno [D-45]. Coste en la Senda del Sacrificio:
  - Entre #1 y #3: 2 pasos.
  - Entre posiciones contiguas: 1 paso.
  - Una carta con el **caballo** paga gratis el primer paso.
- **Tirada de riesgo:** si tras avanzar la Senda el marcador queda por encima de 2, se tiran 2 dados. Si la suma es **menor** que la posición del marcador, Moore cae abatido [D-6].
- **Arenga:** evita la desbandada de una unidad bajo su influencia [D-2][D-3]:
  1. Avanza 1 paso la Senda y hace la tirada de riesgo, si procede.
  2. Si sobrevive, la unidad no se desbanda.
  3. Si cae antes de arengar, la unidad se desbanda.
  
  La tarjeta pide más (avanzar 2 pasos y, si sobrevive, salvar solo con 1–5 en 1d6); queda como opción `mooreRally: card`.
- **Muerte de Moore** [D-7]:
  - **Por acción británica** (movimiento o arenga): su ficha se retira al final del turno británico (el siguiente, si cayó arengando en el turno francés) [D-46]. Hasta entonces su apoyo sigue funcionando, salvo si cayó arengando, pero no puede moverse ni arengar [D-49].
  - **Por la Artillería**: se retira al momento.
  - En los dos casos, el británico reparte −3 de moral entre sus unidades con pista de moral, con sus tests.
  - Moore no cuenta como unidad eliminada.
- **La Artillería contra Moore** [D-8]: si la Artillería combate con Moore en #1 o #2, la Senda avanza 2 y se hace la tirada de riesgo.

### 8.2 Mariscal Soult

Un único uso, a elegir entre:

- **Doble activación** (en la planificación, en lugar de jugar una carta) [D-28]:
  1. El francés elige 2 cartas de Acción y recibe 5 cubos en vez de los de las cartas. Ese turno no hay racha.
  2. Cada carta se resuelve entera (activación y combate), una tras otra, sin sumar ataques.
  3. Reparte 2 dados extra entre los combates.
  4. Al final, una carta vuelve a la mano y la otra al descarte.
  5. La Reorganización se hace una sola vez.
- **Salvar de la desbandada** a una unidad francesa tras un test fallido, también en el turno británico [D-29].

## 9. Racha de Inercia

- Cada bando apila sus cartas de Acción jugadas; la racha sigue aunque las cartas se retiren o se barajen.
- Al jugar una carta que forma **3 seguidas con el mismo número de cubos**, se reciben sus cubos **+2**. En una racha más larga, cada carta nueva vuelve a cerrar un trío y vuelve a dar +2.
- Las cartas de unidades eliminadas también cuentan.
- Soult anula la bonificación ese turno [D-23].

## 10. Refuerzos

- «Reforzar X (1–2 piezas)»: se mueven 1 o 2 bloques de la unidad activada a la unidad objetivo, que debe estar en juego. La Reserva puede repartirlos entre varias.
- Una unidad que se queda sin bloques por reforzar queda destruida y cuenta como eliminada, salvo la Reserva [D-19].

## 11. Mercado y cartas de Táctica

- Mazo común de 36 cartas. Hay 3 boca arriba en el Mercado, con la de la derecha como la siguiente en salir.
- En la Reorganización, el jugador activo puede **comprar una**, pagando su coste y llevándose los cubos que tenga encima. Las cartas compradas quedan boca arriba en su zona; son de un solo uso salvo las PERMANENTES [D-31].
- **Si no compra**, la carta de la derecha se descarta, salvo que alguien lo evite [D-30]:
  1. Primero puede evitarlo el **inactivo**: pone 1 cubo de la reserva común sobre cada una de las otras cartas.
  2. Si no lo hace, puede evitarlo el **activo**, pagando 1 cubo de su reserva a la común.
- Si hay hueco, las cartas se corren a la derecha y se roba una nueva para la izquierda. Si el mazo se acaba, se baraja el descarte.
- En cualquier momento, descartar 3 tácticas propias da 3 cubos [D-30, D-47].

### 11.1 Momentos de juego (`window` en `tactics.json`)

| Ventana | Texto impreso | Dónde la ofrece el motor |
|---|---|---|
| `any` | Jugar en cualquier momento | en todas las ventanas de esta tabla, también antes de un test de moral y tras sufrir bajas, para los dos jugadores [D-32, D-50] |
| `own_any` | En tu turno, en cualquier momento | en todos los puntos del turno propio |
| `own_planning` | En la (tu) fase de planificación | tras jugar la carta de Acción, antes de pagar la activación |
| `own_before_combat` / `enemy_before_combat` | Antes del combate | tras elegir la orden, antes de la primera tirada |
| `own_after_roll` / `enemy_after_roll` / `after_roll` | Durante el combate | tras cada tirada, antes de decidir relanzar o aplicar [D-33] |
| `own_combat` | Durante el combate (*Veteranos de Iberia*) | antes del segundo relanzamiento |
| `own_after_combat` | Tras el combate | tras aplicar los resultados y sus tests |
| `own_instead_of_combat` | En lugar del combate (*A sangre y fuego*) | en el paso de la orden |
| `own_reorganization` | En la reorganización (*Recapacitando*) | en el paso del Mercado |
| `enemy_before_planning` | Antes de la planificación enemiga (*En el fragor de la batalla*) | al empezar el turno del rival |
| `french_turn_start` | Al inicio del turno francés (*El tiempo es esencial*) | al empezar cada turno francés, los dos jugadores |
| `before_morale_test` / `after_failed_morale_test` | Antes de un test / tras un test fallido | en cada test de moral de una unidad propia |
| `after_own_casualties` | En combate, tras sufrir bajas (*Cirujanos*) | tras aplicar bajas a una unidad propia |
| `on_purchase` | Tiene efecto inmediato tras comprarla | al comprarla |

### 11.2 Interpretación de cartas

- ***Avanzadillas:*** pese a «tras el combate», se juega tras una tirada enemiga: el rival relanza gratis el dado elegido [D-33].
- ***¡Calen bayonetas!* y *Acero frío*:** ±1 a un dado una vez por combate; el dado puede relanzarse luego. No sirven en combates de la Artillería, ni atacando ni defendiendo. *Acero frío* la puede jugar cualquiera de los dos jugadores en cualquier combate.
- ***Confianza:*** el defensor ha perdido 2 o más de moral en ese combate.
- ***Fuerzas de flaqueza:*** sobre la unidad atacante propia; cuentan sus bajas y pérdidas de moral de ese combate.
- ***El curso de la acción:*** cuenta las parejas de 6 de la tirada final.
- ***Maniobra sorpresa* y *Mensajeros*:**
  - La carta jugada sigue entrando en la racha (§9).
  - Con *Mensajeros* no se reciben sus cubos, así que tampoco hay bonificación.
  - Se activa otra unidad propia, que paga su coste.
- ***Calma tensa:*** la unidad sube 1 de moral (sin test), no paga la activación y no hace nada. Los cubos de la carta sí se reciben.
- ***Paralizados por el miedo:*** test con la moral actual; con 6 o más no puede fallar.
- ***A sangre y fuego:*** la unidad activada debe tener una orden contra esa plaza. Paga su coste y la plaza cambia de manos sin dados ni bajas.
- ***Baño de sangre:*** si una baja de tu combate cambió el control de una plaza, el rival pierde un bloque más de los defensores.
- ***Cirujanos:*** devuelve 1 bloque perdido por un resultado de combate en ese combate. No vale para bloques pagados para relanzar ni para la Artillería.
- ***Cobardes, Cambio de tornas y Prisioneros:*** afectan a las tácticas que el rival tiene en su zona, permanentes incluidas. *Cobardes* elige al azar; *Prisioneros* elige el que roba.
- ***El tiempo es esencial*** [D-39]: puede jugarla cualquiera de los dos y elige una opción:
  - Pasar las 2 cartas de arriba de cada mazo de Acción a su descarte (acorta la partida).
  - Barajar los descartes de Acción de cada bando, tomar 2 cartas al azar y barajarlas en su mazo (la alarga).
  - Después, los dos rellenan la mano a 3.
- ***En el fragor de la batalla:*** el rival activa la carta de arriba de su mazo en vez de una de su mano y no roba al final si ya tiene 3.
- ***Los hombres están agotados:*** permanente desde que se compra; al rival le cuesta 4 cubos relanzar.
- ***Terreno escarpado:*** no se puede jugar en el turno en que se compra.
- ***Improvisación:*** pasa hasta 2 puntos de moral de una unidad propia a otra (no la Reserva). La que pierde hace sus tests.
- ***Rumores de muerte:*** el rival reparte −3 de moral entre sus unidades, con sus tests.

## 12. Opciones de reglas (para depurar)

| Opción | Valores | Por defecto | Qué cambia |
|---|---|---|---|
| `bayonet` | `die` · `none` | `die` | qué hace la Bayoneta ([D-1]) |
| `mooreRally` | `rulebook` · `card` | `rulebook` | arenga de Moore: la del reglamento (avanza 1 y basta sobrevivir) o la de la tarjeta (avanza 2 + 1d6 de 1–5) ([D-2]) |
| `mooreUnderFire` | `always` · `influence` | `always` | si la Artillería amenaza a Moore en todo combate o solo si su objetivo está bajo su influencia ([D-8]) |
| `reserveActivation` | `free` · `block` | `free` | coste de activación de la Reserva ([D-17]) |
| `moraleTests` | `hit` · `point` | `hit` | un test de moral por golpe o uno por punto perdido ([D-15]) |
| `minDice` | `1` · `0` | `1` | dados mínimos de un combate ([D-21]) |
| `inertiaSupply` | `25` · `unlimited` | `25` | reserva común limitada o no ([D-24]) |
| `discardThreeTactics` | `3` · `2` | `3` | cubos por descartar 3 tácticas (v1.6c / v2.1) ([D-30]) |
| `v21Cards` | `off` · `on` | `off` | añade al mercado las cartas propuestas en la v2.1 (§15) |
| `locationMorale` | `off` · `on` | `off` | variante v2.1: +1 de moral a la unidad que toma Elviña o Palavea (§15) |

## 13. Solitario

Reglas de la v1.6c (§7), resumidas:

- **Preparación:** el humano elige bando y el automa usa la **cara solitaria** de sus tarjetas, con las órdenes numeradas por prioridad. Empiezan siempre los británicos.
- **El automa no juega con Inercia ni con tácticas:** no tiene cubos, no compra ni juega tácticas y no tiene mano de cartas.
- **Turno del automa:**
  1. Voltea la carta de arriba de su mazo.
  2. Paga la activación con moral.
  3. Ejecuta la primera orden posible de la unidad.
  4. Resuelve los dados con la **tabla del modo solitario**, sin parejas; solo relanza los 3, sin coste.
  5. Elimina la táctica de la derecha del Mercado.
- **Mercado y bajas:**
  - El humano no puede evitar descartes del Mercado.
  - Las bajas que sufre el humano dan al automa moral en lugar de cubos, para la unidad con menos moral.
- **Pérdidas en Elviña cuando defiende el automa:** primero Manningham/Leith (después Bentinck), o primero Merle (después Mermet).
- **Soult solitario:** salva la primera desbandada y se descarta.
- **Moore solitario:**
  - Va siempre a la posición de la unidad activada: 1 paso por cambio, con la tirada de riesgo.
  - Da +1 dado a esa unidad.
  - Intenta salvar de la desbandada a la unidad que apoya (+1 paso; si sobrevive, la salva).
  - Su muerte no quita moral.

**Falta material:** no están ni las caras solitarias de las tarjetas (los reversos de los renders son lisos) ni la tabla de dados del automa [D-43]. Hasta tenerlas, el rival automático será un bot propio (docs/02).

## 14. Decisiones para la versión digital

Las marcadas **✔** se revisaron y confirmaron con el usuario (2026-10-23 y, de D-46 a D-52, 2026-10-24); el resto son propuestas pendientes de revisar. Si una partida de prueba aconseja cambiar alguna, se anota aquí con la fecha.

| Id | Hueco o conflicto | Decisión |
|---|---|---|
| D-1 | «Bayoneta» aparece en tres tarjetas, pero el reglamento solo dice que «permite modificar el resultado de los dados» | ✔ ±1 a un dado una vez por combate, como *¡Calen bayonetas!* (la carta que da la Bayoneta a los franceses, según las notas de diseño); el dado se puede relanzar después. Opción `bayonet` |
| D-2 | Arenga: la tarjeta de Moore pide avanzar 2, tirada de riesgo y luego 1d6 (1–5 = éxito); el reglamento solo dice «avanzar el marcador» | ✔ Manda el **reglamento**: avanza 1 paso y, si sobrevive a la tirada de riesgo, salva. Opción `mooreRally: card` para la versión de la tarjeta |
| D-3 | ¿La arenga necesita que la unidad esté bajo la influencia de Moore? ¿Vale en el turno francés? | Sí a las dos. Moore no puede moverse para arengar fuera de la planificación británica |
| D-4 | ¿Cuántas ventajas da el apoyo, y cuándo se elige? | ✔ Una por combate. El +1 dado se elige antes de la primera tirada; si no se ha elegido, queda el relanzamiento gratuito |
| D-5 | Paget en #2: ¿sigue bajo la influencia de #1? | Sí: #1 influye en Paget esté donde esté |
| D-6 | ¿Hasta dónde llega la Senda? | Tope en 12. La tirada de riesgo se hace tras cada pago (movimiento o arenga) que la deje por encima de 2 |
| D-7 | Muerte de Moore: reparto y tests | El británico reparte −3 entre sus unidades con moral (no la Reserva), con sus tests. Por acción británica, al final del turno británico; por la Artillería, al momento |
| D-8 | Artillería: «Si Moore está en #1 o #2, avanzar +2 el marcador de Honor y forzar la tirada inglesa». ¿Cuándo? | ✔ Cada vez que la Artillería combate, antes de su primera tirada. Opción `mooreUnderFire: influence` (solo si el objetivo está bajo la influencia de Moore) |
| D-9 | Dados de la Artillería | Las parejas de 1 son bajas del defensor y los 2 se ignoran. Los 3 dan cubos igual. Como defensora, la Artillería sufre los resultados normales (bajas = discos) |
| D-10 | «Derrotado», «destruido», «muerta», «Artillería activa» | Eliminada (destruida o desbandada) / sigue en juego |
| D-11 | ¿Puede el jugador elegir cualquier orden o va por prioridad? | ✔ En 2 jugadores, cualquiera cuya condición se cumpla. Hay que ejecutar una si existe (el reglamento lo da por obligatorio); reforzar también vale |
| D-12 | ¿Se puede «Atacar Elviña» si ya es propia? | No: solo si la controla el enemigo |
| D-13 | Bajas al atacar una plaza | ✔ La primera baja del combate cambia el control y no retira ficha; el resto retira bloques de los defensores que tenía la plaza al tirar. La moral se aplica normal, repartida por el dueño |
| D-14 | Plaza sin defensores | Si todos los defensores del bando que la controla quedan eliminados (desbandada o destrucción), pasa al otro. La v1.6c solo lo dice de Palavea y de la desbandada |
| D-15 | Tests de moral: cuántos y cuándo | ✔ **Un test por golpe** (§7), con la moral que queda tras él. El de la activación, en el paso Combate 1. Los del combate, tras aplicar la tirada final (defensor y luego atacante). Los de pagar un relanzamiento y los de cartas, al momento. Opción `moraleTests: point` (un test por punto perdido, lectura literal) |
| D-16 | Salvar de la desbandada | Tras fallar el test; la unidad conserva la moral que tenga (más de 0) |
| D-17 | La Reserva no tiene moral: ¿cómo paga la activación? | ✔ No paga. Opción `reserveActivation: block` (retira 1 bloque, lectura literal) |
| D-18 | ¿Las fichas pagadas como coste van al contador de bajas del rival? | Sí: «retirado por cualquier motivo». Las movidas al reforzar, no |
| D-19 | Refuerzos | Sin límite de bloques por unidad. Si una unidad se queda sin bloques al reforzar, queda destruida y cuenta (salvo la Reserva) |
| D-20 | Relanzamientos | Solo el atacante, sin límite, cualquier subconjunto de dados; se aplica la última tirada |
| D-21 | Modificadores que dejan 0 dados o menos | Mínimo 1 dado. Opción `minDice: 0` (sin dados, no hay resultados) |
| D-22 | Más de dos iguales | 3 iguales = 1 pareja, 4 = 2, 5 = 2, 6 = 3. Cada 3 da 1 cubo |
| D-23 | Racha con Soult | Ninguna de las dos cartas da cubos ni bonificación. La descartada entra en la secuencia; la devuelta a la mano, no |
| D-24 | Reserva común de 25 cubos | Limitada: si se agota, no se recibe. Opción `inertiaSupply: unlimited` |
| D-25 | Elegir la carta robada (5 cubos) | En la Reorganización, en lugar del robo normal. Después se baraja el mazo |
| D-26 | Un jugador se queda sin cartas antes que el otro | Pasa sus turnos. La partida acaba cuando ninguno tiene cartas en la mano |
| D-27 | ¿Qué cuenta como División eliminada? | ✔ Británicas: Hill, Bentinck, Paget, Manningham/Leith. Francesas: Mermet, Delaborde, Merle, La Houssaye y **Artillería**. No cuentan la Reserva ni Moore. Se comprueba al momento |
| D-28 | Doble activación de Soult | Ver §8.2. La segunda unidad puede ser la misma si las dos cartas son suyas |
| D-29 | ¿Cuándo salva Soult? | Tras cualquier test fallido de una unidad francesa, en cualquier turno. No con moral 0 |
| D-30 | Mercado: evitar el descarte y descartar 3 tácticas | ✔ Literal v1.6c: el inactivo lo evita gratis poniendo cubos de la reserva común sobre las demás cartas; el activo, pagando 1. Descartar 3 da 3 cubos (la v2.1 decía 2: opción `discardThreeTactics`) |
| D-31 | ¿Cuándo se puede usar una táctica recién comprada? | En cuanto llegue su momento, también ese mismo turno, salvo *Terreno escarpado*. Varias tácticas en el mismo momento, sí |
| D-32 | «En cualquier momento» | El motor ofrece las tácticas en puntos fijos (§11.1); no hay interrupciones a mitad de un paso. En cada punto se juega por turnos hasta que los dos pasan (D-50) |
| D-33 | *Avanzadillas*: «turno enemigo, tras el combate» | Tras una tirada enemiga, antes de aplicarla (después del combate no tendría efecto) |
| D-34 | Mano inicial | El británico roba 5 y el francés 6; cada uno se queda 3 |
| D-35 | El reglamento cuenta 15 bloques británicos; el mapa tiene 14 casillas de salida (Hill 3, Bentinck 3, Paget 2, Manningham/Leith 3, Reserva 3) | ✔ Manda el mapa: 14 |
| D-36 | *Reorganización*: el PDF de febrero de 2026 dice coste 2 y el render de Tabletopia (10 días posterior) dice 3 | ✔ 3, el más reciente |
| D-37 | ¿La moral puede superar el máximo? | No |
| D-38 | Paget | Empieza en #1, donde no combate; su orden 1 lo pasa a #2 sin combate |
| D-39 | *El tiempo es esencial* | Ver §11.2 |
| D-43 | Solitario | Faltan la cara solitaria de las tarjetas y la tabla de dados (§13). Fuera de M1 |
| D-45 | Movimiento de Moore | Una vez por turno, de una posición a otra (1 o 2 pasos), en la planificación británica |
| D-46 | Moore cae por acción británica fuera del turno británico (arengando durante el turno francés): ¿cuándo se retira? | ✔ Al final del **siguiente** turno británico (lectura literal); hasta entonces solo apoya (D-49), y si cayó arengando ni eso |
| D-47 | «Descartar 3 tácticas en cualquier momento» | ✔ En cualquier momento: se ofrece en todas las ventanas de tácticas a quien tenga 3 o más |
| D-48 | Carta de una unidad ya eliminada | ✔ Da sus cubos y entra en la racha, pero no la bonificación de +2 de «sin objetivos» (§5.4 habla de unidades activadas sin objetivos, no de unidades fuera del juego) |
| D-49 | Moore abatido que aún no se ha retirado | ✔ Mantiene su apoyo (+1 dado / relanzamiento) pero no puede moverse ni arengar |
| D-50 | Orden en una ventana de tácticas | ✔ Por turnos, carta a carta, empezando por el jugador activo, hasta que los dos pasan seguidos (así se puede responder a lo que juega el otro). Las cartas de «en cualquier momento» se ofrecen en todas las ventanas, también antes de un test de moral y tras sufrir bajas; el test usa la moral que tenga la unidad al tirar |
| D-51 | *Reorganización*, *Improvisación*: «cualquier unidad» | ✔ Unidades propias. *Improvisación* deja al menos 1 punto a la que cede |
| D-52 | *Recapacitando* | ✔ Cuenta como la compra del turno: después no se puede comprar del Mercado ni se descarta la carta de la derecha |

## 15. Ideas de la v2.1 (no forman parte de las reglas)

El borrador de Iñaki (2023) recoge ideas que no llegaron a la v1.6c. Quedan como **módulos opcionales**, desactivados por defecto, para que la simulación mida su efecto:

- **Cartas de iniciativa nuevas** (`tactics.json` → `ideas_v21`, opción `v21Cards`):
  - Batallón de La Coruña [4]: +2 moral británica.
  - Flota inglesa [3]: +1 a los dados o relanzar 1 dado.
  - Tropas no incluidas (francesas o británicas) [3]: +1 moral.
  - Bayoneta [4–5]: permanente, solo francesa.
  - La v2.1 no fija su momento de juego; habrá que definirlo antes de activarlas.
- **Tomar una plaza da moral** (opción `locationMorale`): +1 a la unidad que conquista Elviña o Palavea.
- **Moral simplificada** o dos niveles de juego: sin concretar en la v2.1.
- **Duración:** 15 cartas son unos 25 minutos de batalla cada una; se planteó pasar a 21 para cubrir de 12:00 a 18:00.
- **Marcador de turno / evacuación** entre los componentes.
- **Nombres:** «Iniciativa» por «Inercia», «Cartas de Combate» por «de Acción», «Unidad» por «Formación/División». No se adoptan: el juego impreso usa los de la v1.6c.
