// One test per Tactic card (docs/01 §11.2): forced hands, tactics and dice
// put each card in its moment and check that it does what it says.
// Los hombres están agotados is in rules.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, TACTICS } from '../src/engine/index.js';
import { answer, passive } from './helpers.js';

const HANDS = { french: ['mermet-1', 'merle-1', 'delaborde-1'], british: ['hill-1', 'hill-2', 'hill-3'] };
const game = (sc = {}, rules = {}) => new Session({ seed: 'tactics', rules, scenario: { ...sc, hands: { ...HANDS, ...sc.hands } } });

/** Answers passively until the prompt contains `text` and `side` decides. */
function reach(s, text, side) {
    let n = 0;
    while (!s.over && !(s.pending.prompt.includes(text) && (!side || s.pending.side === side))) {
        s.act(passive(s.pending));
        assert.ok(++n < 500, `never reached "${text}"`);
    }
    assert.ok(!s.over, `game over before "${text}"`);
}

/** `side` plays the tactic `id` in the window whose prompt mentions `point`. */
function play(s, side, point, id) {
    reach(s, `Tácticas (${point})`, side);
    answer(s, `Jugar ${TACTICS[id].name}`);
}

/** The French play Mermet (3 cubes) against Elviña, paying with morale. */
function mermet(s) {
    reach(s, 'Planificación', 'french');
    answer(s, 'Mermet');
}

/** Answers passively until the turn passes to `side`'s planning. */
const nextPlanning = (s, side) => reach(s, 'Planificación', side);

const u = (s, id) => s.state.units[id];
const cubes = (s, side) => s.state.players[side].cubes;
const last = (s) => s.state.lastCombat;

// ------------------------------------------------------------------ before the turn and at any time

test('Rumores de muerte: the enemy spreads −3 morale', () => {
    const s = game({ tactics: { french: ['rumores_de_muerte'] } });
    play(s, 'french', 'inicio del turno francés', 'rumores_de_muerte');
    for (let i = 0; i < 3; i++) {
        reach(s, 'Rumores de muerte', 'british');
        answer(s, 'Hill');
    }
    assert.equal(u(s, 'hill').morale, 7);
});

test('Curtido en mil batallas doubles the reserve of cubes', () => {
    const s = game({ tactics: { french: ['curtido_en_mil_batallas'] }, cubes: { french: 3 } });
    play(s, 'french', 'inicio del turno francés', 'curtido_en_mil_batallas');
    assert.equal(cubes(s, 'french'), 6);
});

test('Reorganización: +1 morale to a unit of yours', () => {
    const s = game({ tactics: { british: ['reorganizacion'] }, units: { hill: { morale: 6 } } });
    play(s, 'british', 'inicio del turno francés', 'reorganizacion');
    assert.equal(u(s, 'hill').morale, 7);
});

test('Terreno escarpado: the opponent loses all his cubes', () => {
    const s = game({ tactics: { french: ['terreno_escarpado'] } });
    const supply = s.state.supply;
    play(s, 'french', 'inicio del turno francés', 'terreno_escarpado');
    assert.equal(cubes(s, 'british'), 0);
    assert.equal(s.state.supply, supply + 2);
});

test('Cobardes: the opponent loses a tactic at random', () => {
    const s = game({ tactics: { french: ['cobardes'], british: ['concentracion'] } });
    play(s, 'french', 'inicio del turno francés', 'cobardes');
    assert.deepEqual(s.state.players.british.tactics, []);
    assert.ok(s.state.market.discard.includes('concentracion'));
});

test('Cambio de tornas: a tactic of the opponent goes to the discard pile', () => {
    const s = game({ tactics: { french: ['cambio_de_tornas'], british: ['concentracion', 'voluntad'] } });
    play(s, 'french', 'inicio del turno francés', 'cambio_de_tornas');
    answer(s, 'VOLUNTAD');
    assert.deepEqual(s.state.players.british.tactics, ['concentracion']);
});

test('Prisioneros: you take a tactic of the opponent, not usable this turn', () => {
    const s = game({ tactics: { french: ['prisioneros'], british: ['curtido_en_mil_batallas'] } });
    play(s, 'french', 'inicio del turno francés', 'prisioneros');
    const p = s.state.players.french;
    assert.deepEqual(p.tactics, ['curtido_en_mil_batallas']);
    assert.equal(p.locked.curtido_en_mil_batallas, s.state.turnNo);
    assert.notEqual(s.pending.prompt.includes('Tácticas') && s.pending.side === 'french', true, 'not offered this turn');
});

test('Paralizados por el miedo: an enemy unit must take a morale test', () => {
    const s = game({ tactics: { french: ['paralizados_por_el_miedo'] }, units: { hill: { morale: 5 } }, dice: [6] });
    play(s, 'french', 'inicio del turno francés', 'paralizados_por_el_miedo');
    assert.equal(u(s, 'hill').status, 'routed');
    assert.equal(s.state.locations.palavea, 'french');
});

test('Improvisación: up to 2 morale points move between two of your units', () => {
    const s = game({ tactics: { french: ['improvisacion'] }, units: { merle: { morale: 8 } } });
    play(s, 'french', 'inicio del turno francés', 'improvisacion');
    answer(s, 'Mermet'); // Merle is the only one below its maximum: it receives without asking
    answer(s, '2 puntos');
    assert.deepEqual([u(s, 'mermet').morale, u(s, 'merle').morale], [9, 10]);
});

test('El tiempo es esencial (acortar): the top 2 cards of each Action deck are discarded', () => {
    const s = game({ tactics: { french: ['el_tiempo_es_esencial'] } });
    play(s, 'french', 'inicio del turno francés', 'el_tiempo_es_esencial');
    answer(s, 'Acortar');
    for (const side of ['french', 'british']) {
        assert.equal(s.state.players[side].deck.length, 10, side);
        assert.equal(s.state.players[side].discard.length, 2, side);
    }
});

test('El tiempo es esencial (alargar): 2 discarded cards of each side go back into its deck', () => {
    const s = game({ tactics: { british: ['el_tiempo_es_esencial'] }, discard: { french: ['merle-4', 'mermet-4'], british: ['bentinck-4', 'reserva-1'] } });
    play(s, 'british', 'inicio del turno francés', 'el_tiempo_es_esencial');
    answer(s, 'Alargar');
    for (const side of ['french', 'british']) {
        assert.equal(s.state.players[side].deck.length, 12, side);
        assert.equal(s.state.players[side].discard.length, 0, side);
    }
});

test('En el fragor de la batalla: the enemy activates the top card of his deck instead of one of his hand', () => {
    const s = game({ tactics: { british: ['en_el_fragor_de_la_batalla'] }, hands: { french: ['mermet-1', 'delaborde-1', 'artilleria-1'] }, deckTop: { french: ['merle-1'] } });
    play(s, 'british', 'antes de la planificación', 'en_el_fragor_de_la_batalla');
    reach(s, 'Coste de activación', 'french');
    assert.equal(s.pending.prompt, 'Coste de activación de Merle');
    nextPlanning(s, 'british');
    assert.deepEqual(s.state.players.french.hand, ['mermet-1', 'delaborde-1', 'artilleria-1'], 'no card played or drawn from the hand');
});

// ------------------------------------------------------------------ planning

test('Maniobra sorpresa: the cubes of the card, another unit activated', () => {
    const s = game({ tactics: { french: ['maniobra_sorpresa'] } });
    reach(s, 'Planificación', 'french');
    answer(s, 'Merle');
    play(s, 'french', 'planificación', 'maniobra_sorpresa');
    answer(s, 'Mermet');
    reach(s, 'Coste de activación', 'french');
    assert.equal(s.pending.prompt, 'Coste de activación de Mermet');
    assert.equal(cubes(s, 'french'), 2 + 3);
});

test('Mensajeros: no cubes from the card, another unit activated', () => {
    const s = game({ tactics: { french: ['mensajeros'] } });
    reach(s, 'Planificación', 'french');
    answer(s, 'Merle');
    play(s, 'french', 'planificación', 'mensajeros');
    answer(s, 'Mermet');
    reach(s, 'Coste de activación', 'french');
    assert.equal(s.pending.prompt, 'Coste de activación de Mermet');
    assert.equal(cubes(s, 'french'), 2);
});

test('Calma tensa: +1 morale instead of the activation cost, and nothing else', () => {
    const s = game({ tactics: { french: ['calma_tensa'] }, units: { mermet: { morale: 8 } } });
    mermet(s);
    play(s, 'french', 'planificación', 'calma_tensa');
    reach(s, 'Mercado', 'french');
    assert.equal(u(s, 'mermet').morale, 9);
    assert.equal(cubes(s, 'french'), 2 + 3);
    assert.equal(s.state.lastCombat, null, 'no combat');
});

test('Coraje líquido: the unit does not pay the activation cost', () => {
    const s = game({ tactics: { french: ['coraje_liquido'] }, dice: [3, 4, 5, 6, 1] });
    mermet(s);
    play(s, 'french', 'planificación', 'coraje_liquido');
    reach(s, 'Tirada de Mermet', 'french');
    assert.equal(u(s, 'mermet').morale, 11);
    assert.equal(u(s, 'mermet').blocks, 5);
});

// ------------------------------------------------------------------ before the combat

test('Concentración: +1 die for the attacker', () => {
    const s = game({ tactics: { french: ['concentracion'] }, dice: [1, 2, 3, 4, 5, 6] });
    mermet(s);
    play(s, 'french', 'antes del combate', 'concentracion');
    nextPlanning(s, 'british');
    assert.equal(last(s).dice.length, 6);
});

test('¡A cubierto!: −1 die for the attacker', () => {
    const s = game({ tactics: { british: ['a_cubierto'] }, dice: [1, 2, 3, 4] });
    mermet(s);
    play(s, 'british', 'antes del combate', 'a_cubierto');
    nextPlanning(s, 'british');
    assert.equal(last(s).dice.length, 4);
});

test('Brigadas de élite: one die is a fixed 6', () => {
    const s = game({ tactics: { french: ['brigadas_de_elite'] }, dice: [6, 1, 2, 3] });
    mermet(s);
    play(s, 'french', 'antes del combate', 'brigadas_de_elite');
    nextPlanning(s, 'british');
    assert.deepEqual(last(s).dice[0], { v: 6, fixed: true });
    assert.equal(last(s).dice.length, 5);
    assert.equal(s.state.locations.elvina, 'french');
});

test('Vacilación: the 3s leave the combat (and give no cubes)', () => {
    const s = game({ tactics: { british: ['vacilacion'] }, dice: [3, 3, 6, 6, 1] });
    mermet(s);
    play(s, 'british', 'antes del combate', 'vacilacion');
    nextPlanning(s, 'british');
    assert.deepEqual(last(s).dice.map((d) => d.v), [6, 6, 1]);
    assert.equal(cubes(s, 'french'), 2 + 3);
    assert.equal(s.state.locations.elvina, 'french');
});

test('¡Calen bayonetas!: ±1 to one die, once per combat', () => {
    const s = game({ tactics: { french: ['calen_bayonetas'] }, dice: [4, 5, 1, 2, 3] });
    mermet(s);
    play(s, 'french', 'antes del combate', 'calen_bayonetas');
    reach(s, 'Tirada de Mermet', 'french');
    answer(s, 'calen');
    answer(s, 'Dado 1: 4 → 5');
    assert.ok(!s.pending.options.some((o) => o.id === 'calen'), 'only once');
    answer(s, 'apply');
    nextPlanning(s, 'british');
    assert.equal(u(s, 'bentinck').morale + u(s, 'manningham_leith').morale, 19, '5-5: −1 morale to a defender');
});

test('Riflemen vs. Voltigeurs: rerolling 1s and 2s is free', () => {
    const s = game({ tactics: { french: ['riflemen_vs_voltigeurs'] }, dice: [1, 2, 3, 4, 5] });
    mermet(s);
    play(s, 'french', 'antes del combate', 'riflemen_vs_voltigeurs');
    reach(s, 'Tirada de Mermet', 'french');
    answer(s, 'reroll');
    answer(s, ['Dado 1: 1', 'Dado 2: 2']);
    assert.ok(s.pending.options.some((o) => o.id === 'riflemen'));
});

test('Riflemen vs. Voltigeurs: not when other faces are rerolled', () => {
    const s = game({ tactics: { french: ['riflemen_vs_voltigeurs'] }, dice: [1, 2, 3, 4, 5] });
    mermet(s);
    play(s, 'french', 'antes del combate', 'riflemen_vs_voltigeurs');
    reach(s, 'Tirada de Mermet', 'french');
    answer(s, 'reroll');
    answer(s, ['Dado 1: 1', 'Dado 3: 3']);
    assert.ok(!s.pending.options.some((o) => o.id === 'riflemen'));
});

test('Veteranos de Iberia: the third roll (second reroll) is free', () => {
    const s = game({ tactics: { french: ['veteranos_de_iberia'] }, dice: [1, 2, 3, 4, 5, 1] });
    mermet(s);
    play(s, 'french', 'antes del combate', 'veteranos_de_iberia');
    reach(s, 'Tirada de Mermet', 'french');
    answer(s, 'reroll');
    answer(s, ['Dado 1: 1']);
    assert.ok(!s.pending.options.some((o) => o.id === 'veteranos'), 'the second roll is not free');
    answer(s, 'cubes');
    reach(s, 'Tirada de Mermet', 'french');
    answer(s, 'reroll');
    answer(s, ['Dado 1: 1']);
    assert.ok(s.pending.options.some((o) => o.id === 'veteranos'));
});

// ------------------------------------------------------------------ after a roll

test('Voluntad: one die rerolled for free', () => {
    const s = game({ tactics: { french: ['voluntad'] }, dice: [6, 1, 2, 3, 4, 6] });
    mermet(s);
    play(s, 'french', 'tras la tirada', 'voluntad');
    answer(s, 'Dado 2: 1');
    nextPlanning(s, 'british');
    assert.equal(s.state.locations.elvina, 'french');
    assert.equal(cubes(s, 'french'), 2 + 3 + 1, 'no cubes paid (the 3 gives one)');
});

test('Ímpetu inusitado: one die turned to any face', () => {
    const s = game({ tactics: { french: ['impetu_inusitado'] }, dice: [6, 1, 2, 3, 4] });
    mermet(s);
    play(s, 'french', 'tras la tirada', 'impetu_inusitado');
    answer(s, 'Dado 2: 1 → 6');
    nextPlanning(s, 'british');
    assert.equal(s.state.locations.elvina, 'french');
});

test('Avanzadillas: the enemy rerolls the die you choose', () => {
    const s = game({ tactics: { british: ['avanzadillas'] }, dice: [6, 6, 1, 2, 3, 4] });
    mermet(s);
    play(s, 'british', 'tras la tirada', 'avanzadillas');
    answer(s, 'Dado 1: 6');
    nextPlanning(s, 'british');
    assert.equal(s.state.locations.elvina, 'british');
});

test('Acero frío: either player changes a die by 1', () => {
    const s = game({ tactics: { british: ['acero_frio'] }, dice: [6, 6, 1, 2, 3] });
    mermet(s);
    play(s, 'british', 'tras la tirada', 'acero_frio');
    answer(s, 'Dado 1: 6 → 5');
    nextPlanning(s, 'british');
    assert.equal(s.state.locations.elvina, 'british');
});

test('Acero frío does not apply when the Artillery fights', () => {
    const s = game({ tactics: { british: ['acero_frio'] }, hands: { french: ['artilleria-1', 'merle-1', 'mermet-1'] }, moore: { pos: 3 }, dice: [6, 6, 1, 2, 3] });
    reach(s, 'Planificación', 'french');
    answer(s, 'Artillería');
    reach(s, 'Tirada de Artillería', 'french');
    answer(s, 'apply');
    nextPlanning(s, 'british');
    assert.ok(s.state.players.british.tactics.includes('acero_frio'), 'never offered');
});

// ------------------------------------------------------------------ after the combat

test('Confianza: +1 morale when the attack took 2 or more morale points', () => {
    const s = game({ tactics: { french: ['confianza'] }, locations: { palavea: 'french' }, dice: [4, 4, 5, 5, 1, 2] });
    reach(s, 'Planificación', 'french');
    answer(s, 'Delaborde');
    play(s, 'french', 'tras el combate', 'confianza');
    assert.equal(u(s, 'delaborde').morale, 10);
    assert.equal(u(s, 'hill').morale, 8);
});

test('Fuerzas de flaqueza: +2 morale to a unit hit twice', () => {
    const s = game({ tactics: { french: ['fuerzas_de_flaqueza'] }, dice: [1, 1, 2, 2, 3] });
    mermet(s);
    play(s, 'french', 'tras el combate', 'fuerzas_de_flaqueza');
    assert.equal(u(s, 'mermet').morale, 11);
    assert.equal(u(s, 'mermet').blocks, 4);
});

test('El curso de la acción: +1 morale per pair of 6s', () => {
    const s = game({ tactics: { french: ['el_curso_de_la_accion'] }, dice: [6, 6, 1, 2, 3] });
    mermet(s);
    play(s, 'french', 'tras el combate', 'el_curso_de_la_accion');
    assert.equal(u(s, 'mermet').morale, 11);
});

test('Baño de sangre: a casualty that took a location costs the defender one more block', () => {
    const s = game({ tactics: { french: ['bano_de_sangre'] }, dice: [6, 6, 1, 2, 3] });
    mermet(s);
    play(s, 'french', 'tras el combate', 'bano_de_sangre');
    answer(s, 'Bentinck');
    assert.equal(s.state.locations.elvina, 'french');
    assert.equal(u(s, 'bentinck').blocks, 2);
    assert.equal(s.state.players.french.casualties, 1);
});

test('Cirujanos: a block lost in combat comes back', () => {
    const s = game({ tactics: { british: ['cirujanos'] }, locations: { palavea: 'french' }, dice: [6, 6, 1, 2, 3, 4] });
    reach(s, 'Planificación', 'french');
    answer(s, 'Delaborde');
    play(s, 'british', 'tras sufrir bajas', 'cirujanos');
    assert.equal(u(s, 'hill').blocks, 3);
    assert.equal(s.state.players.french.casualties, 0);
});

// ------------------------------------------------------------------ orders, morale tests, reorganization

test('A sangre y fuego: takes the location without dice', () => {
    const s = game({ tactics: { french: ['a_sangre_y_fuego'] } });
    mermet(s);
    reach(s, 'Órdenes de Mermet', 'french');
    answer(s, 'A sangre y fuego');
    assert.equal(s.state.locations.elvina, 'french');
    assert.equal(u(s, 'bentinck').blocks + u(s, 'manningham_leith').blocks, 6);
    assert.equal(s.state.lastCombat, null);
});

test('Arenga: +2 to the limit of a morale test', () => {
    const s = game({ tactics: { british: ['arenga'] }, locations: { palavea: 'french' }, units: { hill: { morale: 6 } }, dice: [4, 4, 5, 5, 1, 2, 6] });
    reach(s, 'Planificación', 'french');
    answer(s, 'Delaborde');
    play(s, 'british', 'test de moral', 'arenga');
    nextPlanning(s, 'british');
    assert.equal(u(s, 'hill').status, 'in');
    assert.match(s.state.log.find((l) => l.text.startsWith('Test de moral de Hill')).text, /sale 6 contra 6 \(4 \+ 2\)/);
});

test('Reagrupación: saves a unit after a failed test', () => {
    const s = game({ tactics: { british: ['reagrupacion'] }, locations: { palavea: 'french' }, units: { hill: { morale: 6 } }, dice: [4, 4, 5, 5, 1, 2, 6] });
    reach(s, 'Planificación', 'french');
    answer(s, 'Delaborde');
    reach(s, 'va a desbandarse', 'british');
    answer(s, 'Jugar Reagrupación');
    nextPlanning(s, 'british');
    assert.equal(u(s, 'hill').status, 'in');
    assert.equal(u(s, 'hill').morale, 4);
});

test('Recapacitando: buys a discarded tactic; the market row stays as it is', () => {
    const s = game({ tactics: { french: ['recapacitando'] }, marketDiscard: ['concentracion'], cubes: { french: 5 }, market: ['voluntad', 'arenga', 'cobardes'] });
    play(s, 'french', 'reorganización', 'recapacitando');
    nextPlanning(s, 'british');
    assert.deepEqual(s.state.players.french.tactics, ['concentracion']);
    assert.deepEqual(s.state.market.row.map((r) => r.id), ['voluntad', 'arenga', 'cobardes']);
});
