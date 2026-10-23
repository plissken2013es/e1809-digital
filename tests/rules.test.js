// Concrete rules with forced scenarios (setup.scenario, docs/02 §3): forced
// hands and dice (scenario.dice) make each case deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, results, deckOf } from '../src/engine/index.js';
import { answer, until, passive } from './helpers.js';

const BRITISH_HAND = ['hill-1', 'hill-2', 'hill-3'];
const game = (scenario, rules = {}) => new Session({ seed: 'rules', rules, scenario });
const logCount = (s, text) => s.state.log.filter((l) => l.text.includes(text)).length;

test('pairs, threes and the Artillery dice [§6, D-9, D-22]', () => {
    const r = (vals, art) => results(vals.map((v) => ({ v })), art);
    assert.deepEqual(r([6, 6, 4, 4, 3, 1]), { attackerCasualties: 0, attackerMorale: 0, cubes: 1, defenderMorale: 1, defenderCasualties: 1, sixPairs: 1 });
    assert.equal(r([6, 6, 6]).defenderCasualties, 1, 'three alike are one pair');
    assert.equal(r([5, 5, 5, 5]).defenderMorale, 2, 'four alike are two pairs');
    assert.deepEqual(r([1, 1, 2, 2, 2]), { attackerCasualties: 1, attackerMorale: 1, cubes: 0, defenderMorale: 0, defenderCasualties: 0, sixPairs: 0 });
    const art = r([1, 1, 2, 2, 6, 6], true);
    assert.equal(art.defenderCasualties, 2, 'Artillery: 1-pairs count as 6-pairs');
    assert.equal(art.attackerMorale + art.attackerCasualties, 0, 'Artillery: 2s ignored');
});

test('Elviña: the first casualty switches control, the second removes a defender block [§4.2, D-13]', () => {
    const s = game({ hands: { french: ['mermet-1', 'merle-1', 'delaborde-1'], british: BRITISH_HAND }, dice: [6, 6, 6, 6, 2] });
    until(s, 'Planificación', passive);
    answer(s, 'Mermet');
    answer(s, '−1 de moral');
    until(s, 'Tirada de Mermet', passive);
    answer(s, 'apply');
    until(s, 'sufre una baja', passive);
    assert.equal(s.pending.side, 'british', 'the owner spreads the losses');
    answer(s, 'Bentinck');
    const g = s.state;
    assert.equal(g.locations.elvina, 'french');
    assert.equal(g.units.bentinck.blocks, 2);
    assert.equal(g.units.manningham_leith.blocks, 3);
    assert.equal(g.players.french.casualties, 1);
    assert.equal(g.units.mermet.morale, 10);
});

const hillScenario = (extra = {}) => ({
    hands: { french: ['delaborde-1', 'merle-1', 'mermet-1'], british: BRITISH_HAND },
    locations: { palavea: 'french' },
    units: { hill: { morale: 6 } },
    ...extra,
});

function delabordeHitsHill(s) {
    until(s, 'Planificación', passive);
    answer(s, 'Delaborde');
    answer(s, '−1 de moral');
    until(s, 'Tirada de Delaborde', passive);
    answer(s, 'apply');
}

test('one morale test per hit; a routed defender of Palavea hands it over [D-15, D-14]', () => {
    // Delaborde: 5 dice + 1 (Palavea francesa). 4-4 and 5-5: Hill 6 → 4, one test: 6 fails
    const s = game(hillScenario({ dice: [4, 4, 5, 5, 1, 2, 6] }));
    delabordeHitsHill(s);
    until(s, 'Planificación', passive); // the British turn
    assert.equal(logCount(s, 'Test de moral de Hill'), 1);
    assert.equal(s.state.units.hill.status, 'routed');
    assert.equal(s.state.locations.palavea, 'french');
});

test('moraleTests: point tests at every point lost below 6 [D-15]', () => {
    const s = game(hillScenario({ dice: [4, 4, 5, 5, 1, 2, 1, 6] }), { moraleTests: 'point' });
    delabordeHitsHill(s);
    until(s, 'Planificación', passive);
    assert.equal(logCount(s, 'Test de moral de Hill'), 2, 'at 5 (passes with 1) and at 4 (fails with 6)');
    assert.match(s.state.log.find((l) => l.text.startsWith('Test de moral de Hill')).text, /contra 5/);
    assert.equal(s.state.units.hill.status, 'routed');
});

const bentinckScenario = (dice) => ({
    hands: { french: ['mermet-1', 'merle-1', 'delaborde-1'], british: BRITISH_HAND },
    locations: { elvina: 'french' },
    units: { bentinck: { morale: 3 } },
    dice,
});

function mermetHitsBentinck(s) {
    until(s, 'Planificación', passive);
    answer(s, 'Mermet');
    answer(s, '−1 de moral');
    until(s, 'Tirada de Mermet', passive);
    answer(s, 'apply');
    until(s, 'va a desbandarse', passive);
    answer(s, 'Arenga de Moore');
}

test("Moore's rally (rulebook): one step on the Path and surviving saves the unit [§8.1, D-2]", () => {
    // Mermet: 5 + 1 (Elviña francesa) = 6 dice; 4-4: Bentinck 3 → 2, test 6 fails
    const s = game(bentinckScenario([4, 4, 1, 2, 3, 5, 6]));
    mermetHitsBentinck(s);
    until(s, 'Planificación', passive);
    assert.equal(s.state.units.bentinck.status, 'in');
    assert.equal(s.state.units.bentinck.morale, 2);
    assert.equal(s.state.moore.track, 2, 'no risk roll at 2');
});

test("Moore's rally (card): two steps, risk roll, then 1d6 of 1–5 [D-2]", () => {
    // risk roll 6+6 survives at 3; the rally die 6 fails
    const s = game(bentinckScenario([4, 4, 1, 2, 3, 5, 6, 6, 6, 6]), { mooreRally: 'card' });
    mermetHitsBentinck(s);
    until(s, 'Planificación', passive);
    assert.equal(s.state.moore.track, 3);
    assert.equal(s.state.moore.status, 'active');
    assert.equal(s.state.units.bentinck.status, 'routed');
});

test('Moore felled rallying in the French turn stays until the end of the next British turn [D-46, D-49]', () => {
    // track 5 → 6 with the rally; risk 1 + 1 < 6: he falls, Bentinck routs
    const s = game({ ...bentinckScenario([4, 4, 1, 2, 3, 5, 6, 1, 1]), moore: { track: 5 } });
    mermetHitsBentinck(s);
    until(s, 'Planificación', passive);
    assert.equal(s.pending.side, 'british');
    assert.equal(s.state.moore.status, 'dying');
    assert.equal(s.state.units.bentinck.status, 'routed');
    until(s, 'Muerte de Moore', passive);
    assert.equal(s.state.active, 'british', 'removed at the end of the British turn');
    assert.equal(s.state.turnNo, 2);
});

test('tactic windows go back and forth, one card at a time, until both pass [D-50]', () => {
    const s = game({ hands: { french: ['mermet-1', 'merle-1', 'delaborde-1'], british: BRITISH_HAND }, tactics: { french: ['curtido_en_mil_batallas', 'cambio_de_tornas'], british: ['rumores_de_muerte', 'reorganizacion'] } });
    answer(s, 'Jugar CURTIDO');
    assert.deepEqual([s.pending.side, s.pending.prompt], ['british', 'Tácticas (inicio del turno francés)']);
    answer(s, 'Jugar RUMORES');
    for (let i = 0; i < 3; i++) answer(s, 'Mermet');
    assert.deepEqual([s.pending.side, s.pending.prompt], ['french', 'Tácticas (inicio del turno francés)'], 'the French answer back');
});

test('3 tactics can be discarded for 3 cubes in any tactic window [D-47]', () => {
    const s = game({ hands: { french: ['mermet-1', 'merle-1', 'delaborde-1'], british: BRITISH_HAND }, tactics: { french: ['concentracion', 'vacilacion', 'a_cubierto'] } });
    assert.equal(s.pending.prompt, 'Tácticas (inicio del turno francés)');
    answer(s, 'discard3'); // with exactly 3 tactics the choice answers itself
    assert.equal(s.state.players.french.cubes, 2 + 3);
    assert.deepEqual(s.state.players.french.tactics, []);
});

test('«En cualquier momento» cards can be played before a morale test [D-50]', () => {
    // Hill 6 → 4; Reorganización takes it to 5 before rolling a 5
    const s = game({ ...hillScenario({ dice: [4, 4, 5, 5, 1, 2, 5] }), tactics: { british: ['reorganizacion'] } });
    until(s, 'Planificación', passive);
    answer(s, 'Delaborde');
    until(s, 'Tácticas (test de moral)', passive);
    answer(s, 'Jugar REORGANIZACIÓN');
    until(s, 'Planificación', passive);
    assert.equal(s.state.units.hill.status, 'in');
    assert.equal(s.state.units.hill.morale, 5);
});

test('the Artillery fires on Moore at #1: he dies at once and the British lose 3 morale [§8.1, D-7, D-8]', () => {
    const s = game({ hands: { french: ['artilleria-1', 'merle-1', 'mermet-1'], british: BRITISH_HAND }, dice: [1, 1, 2, 3, 4] });
    until(s, 'Planificación', passive);
    answer(s, 'Artillería');
    answer(s, '−1 de moral');
    answer(s, '→ Bentinck');
    for (let i = 0; i < 3; i++) {
        until(s, 'Muerte de Moore', passive);
        answer(s, 'Hill');
    }
    assert.equal(s.state.moore.status, 'dead');
    assert.equal(s.state.moore.track, 3);
    assert.equal(s.state.units.hill.morale, 7);
});

test('the Reserve activates for free and spreads its blocks [D-17, §10]', () => {
    const s = game({ hands: { french: [], british: ['reserva-1', 'hill-1', 'hill-2'] } });
    until(s, 'Planificación', passive);
    assert.equal(s.pending.side, 'british');
    answer(s, 'Reserva');
    answer(s, 'stay');
    answer(s, '2 fichas');
    answer(s, 'Hill');
    answer(s, 'Hill');
    assert.equal(s.state.units.reserva.blocks, 1);
    assert.equal(s.state.units.hill.blocks, 5);
    assert.equal(s.state.players.french.casualties, 0);
});

test('reserveActivation: block pays with a block that goes to the casualty track [D-17]', () => {
    const s = game({ hands: { french: [], british: ['reserva-1', 'hill-1', 'hill-2'] } }, { reserveActivation: 'block' });
    until(s, 'Planificación', passive);
    answer(s, 'Reserva');
    answer(s, 'stay');
    answer(s, '2 fichas');
    answer(s, 'Hill');
    answer(s, 'Hill');
    assert.equal(s.state.units.reserva.blocks, 0);
    assert.equal(s.state.units.reserva.status, 'in', 'the Reserve is never eliminated');
    assert.equal(s.state.players.french.casualties, 1);
});

test('a second Division lost ends the game [§1, D-27]', () => {
    const s = game({ ...hillScenario({ dice: [6, 6, 1, 2, 3, 4] }), units: { hill: { blocks: 1 }, paget: { status: 'routed', blocks: 0 } } });
    delabordeHitsHill(s);
    assert.deepEqual([s.over, s.state.result.winner], [true, 'french']);
});

test('the British win when both hands run out (evacuation) [§1]', () => {
    const s = game({ hands: { french: [], british: [] }, discard: { french: deckOf('french'), british: deckOf('british') } });
    assert.equal(s.state.result.winner, 'british');
    assert.match(s.state.result.reason, /embarcan/);
});

test('three cards in a row with the same cubes give +2 [§9]', () => {
    const s = game({ hands: { french: ['merle-2', 'mermet-1', 'delaborde-1'], british: BRITISH_HAND }, streak: { french: [2, 2] } });
    until(s, 'Planificación', passive);
    answer(s, 'Merle');
    until(s, 'Coste de activación', passive);
    assert.equal(s.state.players.french.cubes, 2 + 2 + 2);
});

test('a unit without targets: cubes + 2, no activation cost [§5.4]', () => {
    // La Houssaye: Bentinck gone and Paget at #1 → nothing to attack
    const s = game({ hands: { french: ['la_houssaye-1', 'merle-1', 'mermet-1'], british: BRITISH_HAND }, units: { bentinck: { status: 'routed', blocks: 0 } } });
    until(s, 'Planificación', passive);
    answer(s, 'La Houssaye');
    until(s, 'Mercado', passive);
    assert.equal(s.state.players.french.cubes, 2 + 1 + 2);
    assert.equal(s.state.units.la_houssaye.morale, 9);
});

test('Soult: two activations, 5 cubes instead of the cards, one card back to the hand [§8.2]', () => {
    const s = game({ hands: { french: ['merle-1', 'mermet-1', 'delaborde-1'], british: BRITISH_HAND } });
    until(s, 'Planificación', passive);
    answer(s, 'Soult');
    answer(s, 'Merle');
    until(s, 'Coste de activación de Merle', passive);
    assert.equal(s.state.players.french.cubes, 2 + 5);
    until(s, 'Soult: segunda', passive);
    answer(s, 'Mermet');
    until(s, 'vuelve a la mano', passive);
    answer(s, 'Merle');
    until(s, 'Planificación', passive);
    const p = s.state.players.french;
    assert.ok(p.hand.includes('merle-1'));
    assert.ok(p.discard.includes('mermet-1') && !p.discard.includes('merle-1'));
    assert.equal(p.hand.length, 3);
    assert.ok(s.state.soult.used);
});

test('Los hombres están agotados: the opponent pays 4 cubes to reroll [§11.2]', () => {
    const s = game({ hands: { french: ['mermet-1', 'merle-1', 'delaborde-1'], british: BRITISH_HAND }, tactics: { british: ['los_hombres_estan_agotados'] } });
    until(s, 'Planificación', passive);
    answer(s, 'Mermet');
    answer(s, '−1 de moral');
    until(s, 'Tirada de Mermet', passive);
    answer(s, 'reroll');
    answer(s, ['Dado 1']);
    assert.ok(s.pending.options.some((o) => o.label === '4 cubos de Inercia'));
});

test('the opening hands: 6 cards for the French, 5 for the British, 3 kept [D-34]', () => {
    const s = new Session({ seed: 'open' });
    assert.equal(s.pending.kind, 'opening');
    assert.equal(s.pending.side, 'french');
    assert.equal(s.pending.options.length, 6);
    s.act(['0', '1', '2']);
    assert.equal(s.pending.side, 'british');
    assert.equal(s.pending.options.length, 5);
    s.act(['0', '1', '2']);
    assert.equal(s.state.players.french.hand.length, 3);
    assert.equal(s.state.players.french.deck.length, 12);
});
