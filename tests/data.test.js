import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNITS, COMMANDERS, ACTIONS, ACTION_BACKS, TACTICS, BOARD, LOCATIONS, unitsOf, deckOf, enemyOf } from '../src/engine/data.js';
import tacticsJson from '../src/data/tactics.json' with { type: 'json' };
import tacticsRaw from '../extracted/tactics_raw.json' with { type: 'json' };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WINDOWS = ['any', 'own_any', 'own_planning', 'own_before_combat', 'enemy_before_combat', 'own_after_roll',
    'enemy_after_roll', 'after_roll', 'own_combat', 'own_after_combat', 'own_instead_of_combat', 'own_reorganization',
    'enemy_before_planning', 'french_turn_start', 'before_morale_test', 'after_failed_morale_test',
    'after_own_casualties', 'on_purchase'];
const CONDITION = /^(elvina|palavea)_(british|french)$|^paget_at:[12]$|^(alive|eliminated):([a-z_]+)$/;

test('5 units and a commander per side', () => {
    assert.deepEqual(unitsOf('british'), ['hill', 'bentinck', 'paget', 'manningham_leith', 'reserva']);
    assert.deepEqual(unitsOf('french'), ['mermet', 'delaborde', 'merle', 'la_houssaye', 'artilleria']);
    assert.deepEqual(Object.keys(COMMANDERS), ['moore', 'soult']);
});

test('start blocks: 14 British (map, [D-35]) and 16 French blocks + 3 artillery discs', () => {
    const blocks = (side) => unitsOf(side).reduce((n, id) => n + UNITS[id].blocks, 0);
    assert.equal(blocks('british'), 14);
    assert.equal(blocks('french') - UNITS.artilleria.blocks, 16);
    assert.equal(UNITS.artilleria.blocks, 3);
});

test('each Action deck has 15 cards that match the activations and cube icons of the unit cards', () => {
    for (const side of ['british', 'french']) {
        assert.equal(deckOf(side).length, 15, side);
        for (const id of unitsOf(side)) {
            const cards = deckOf(side).map((c) => ACTIONS[c]).filter((c) => c.unit === id);
            assert.equal(cards.length, UNITS[id].activations, id);
            const icons = {};
            for (const c of cards) icons[c.cubes] = (icons[c.cubes] ?? 0) + 1;
            assert.deepEqual(icons, UNITS[id].action_cards, id);
        }
    }
    assert.ok(Object.values(ACTIONS).every((c) => !c.horse || c.side === 'british'), 'only British cards have the horse');
});

test('orders and modifiers use known conditions and valid targets', () => {
    for (const u of Object.values(UNITS)) {
        for (const o of u.orders) {
            for (const cond of o.if ?? []) {
                for (const alt of cond.split('|')) {
                    const m = alt.match(CONDITION);
                    assert.ok(m, `${u.id}: condition ${alt}`);
                    if (m[5]) assert.ok(UNITS[m[5]], `${u.id}: unknown unit in ${alt}`);
                }
            }
            if (o.act === 'attack') {
                for (const t of o.targets) {
                    if (LOCATIONS[t]) continue;
                    assert.equal(UNITS[t]?.side, enemyOf(u.side), `${u.id} attacks ${t}`);
                    assert.notEqual(UNITS[t].type, 'reserve');
                }
            } else if (o.act === 'reinforce') {
                for (const t of o.targets) assert.equal(UNITS[t]?.side, u.side, `${u.id} reinforces ${t}`);
                assert.deepEqual(o.pieces, [1, 2]);
            } else {
                assert.equal(o.act, 'move');
                assert.equal(u.id, 'paget');
            }
        }
        for (const m of u.modifiers) {
            assert.ok(m.keyword || Number.isInteger(m.dice), `${u.id}: ${m.text}`);
            for (const cond of m.if ?? []) assert.match(cond, CONDITION);
        }
    }
});

test('Moore influences every British fighting unit from exactly one position', () => {
    const positions = Object.entries(COMMANDERS.moore.positions);
    for (const id of unitsOf('british')) {
        const at = positions.filter(([, ids]) => ids.includes(id)).map(([p]) => Number(p));
        assert.deepEqual(at, UNITS[id].moore_position ? [UNITS[id].moore_position] : [], id);
    }
});

test('36 Tactic cards, one copy each, with a known play window', () => {
    const cards = Object.values(TACTICS);
    assert.equal(cards.length, 36);
    for (const c of cards) {
        assert.ok(WINDOWS.includes(c.window), `${c.id}: ${c.window}`);
        assert.ok(c.cost >= 1 && c.cost <= 6, c.id);
    }
    assert.deepEqual(cards.filter((c) => c.permanent).map((c) => c.id), ['los_hombres_estan_agotados']);
});

test('Tactic texts match the PDF text layer (only the cost of Reorganización differs, [D-36])', () => {
    assert.equal(tacticsRaw.length, tacticsJson.cards.length);
    for (const raw of tacticsRaw) {
        const c = TACTICS[raw.id];
        assert.ok(c, raw.id);
        assert.equal(c.name, raw.name);
        assert.equal(c.text, raw.text, raw.id);
        assert.equal(c.timing, raw.timing, raw.id);
        assert.equal(Boolean(c.permanent), raw.permanent, raw.id);
        if (raw.id === 'reorganizacion') assert.deepEqual([raw.cost, c.cost], [2, 3]);
        else assert.equal(c.cost, raw.cost, raw.id);
    }
});

test('board: a start slot per block, Moore positions and locations inside the map', () => {
    const [W, H] = BOARD.size;
    const inside = ([x0, y0, x1, y1]) => x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H && x0 < x1 && y0 < y1;
    for (const u of Object.values(UNITS)) {
        const slots = BOARD.slots[u.id];
        if (u.id === 'paget') {
            assert.equal(slots['1'].length, u.blocks);
            assert.equal(slots['2'].length, u.blocks);
            assert.ok([...slots['1'], ...slots['2']].every(inside));
        } else {
            assert.equal(slots.length, u.blocks, u.id);
            assert.ok(slots.every(inside), u.id);
        }
    }
    // casualty tracks: groups that end at the thresholds of the rulebook (§4.4)
    assert.equal(BOARD.casualties.british.length, 15);
    assert.equal(BOARD.casualties.french.length, 12);
    assert.ok([...BOARD.casualties.british, ...BOARD.casualties.french].every(inside));
    assert.deepEqual(Object.keys(BOARD.moore), ['1', '2', '3']);
    assert.ok(Object.values(BOARD.moore).every(inside));
    for (const [id, loc] of Object.entries(LOCATIONS)) {
        assert.ok(loc.center[0] < W && loc.center[1] < H, id);
        for (const side of ['british', 'french']) {
            for (const d of loc.defenders[side]) assert.equal(UNITS[d].side, side, `${id} defender ${d}`);
        }
    }
});

test('every image path exists', () => {
    const paths = [
        BOARD.image,
        ...Object.values(UNITS).map((u) => u.card),
        ...Object.values(COMMANDERS).map((c) => c.card),
        ...Object.values(ACTIONS).map((c) => c.image),
        ...Object.values(TACTICS).map((c) => c.image),
        tacticsJson.back,
        ...Object.values(ACTION_BACKS),
        'assets/icons/horse.webp',
    ];
    for (const p of paths) assert.ok(existsSync(ROOT + p), p);
});
