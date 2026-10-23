import assert from 'node:assert/strict';
import { Session, UNITS, TACTICS, deckOf, enemyOf, unitsOf } from '../src/engine/index.js';

const startBlocks = (side) => unitsOf(side).reduce((n, id) => n + UNITS[id].blocks, 0);
const sorted = (a) => [...a].sort();

/** Every card is in exactly one place; cubes, blocks and casualties add up; counters stay in range. */
export function checkInvariants(g) {
    for (const side of ['french', 'british']) {
        const p = g.players[side];
        assert.deepEqual(sorted([...p.hand, ...p.deck, ...p.discard, ...p.limbo]), sorted(deckOf(side)), `${side} Action cards`);
        assert.ok(p.hand.length <= 3, `${side} hand ${p.hand.length}`);
        assert.ok(p.cubes >= 0, `${side} cubes ${p.cubes}`);
        const blocks = unitsOf(side).reduce((n, id) => n + g.units[id].blocks, 0);
        assert.equal(startBlocks(side) - blocks, g.players[enemyOf(side)].casualties, `${side} blocks vs casualty track`);
    }
    const m = g.market;
    const tactics = [...m.deck, ...m.row.map((s) => s.id), ...m.discard, ...g.players.french.tactics, ...g.players.british.tactics];
    assert.deepEqual(sorted(tactics), sorted(Object.keys(TACTICS)), 'Tactic cards');
    if (g.supply !== null) {
        assert.ok(g.supply >= 0, `supply ${g.supply}`);
        const total = g.supply + g.players.french.cubes + g.players.british.cubes + m.row.reduce((n, s) => n + s.cubes, 0);
        assert.equal(total, Number(g.rules.inertiaSupply), 'Inertia cubes are not conserved');
    }
    for (const [id, st] of Object.entries(g.units)) {
        assert.ok(st.blocks >= 0 && st.blocks <= UNITS[id].blocks, `${id} has ${st.blocks} blocks, ${UNITS[id].blocks} slots [D-19]`);
        assert.ok(['in', 'destroyed', 'routed'].includes(st.status), `${id} status`);
        if (UNITS[id].type === 'reserve') {
            assert.equal(st.morale, null);
            assert.equal(st.status, 'in');
        } else {
            assert.ok(st.morale >= 0 && st.morale <= UNITS[id].morale.max, `${id} morale ${st.morale}`);
            if (st.status === 'in') assert.ok(st.blocks > 0 && st.morale > 0, `${id} in play with ${st.blocks} blocks, morale ${st.morale}`);
            else assert.equal(st.blocks, 0, `${id} eliminated with blocks`);
        }
    }
    assert.ok(g.moore.track >= 1 && g.moore.track <= 12, `Moore track ${g.moore.track}`);
    assert.ok([1, 2, 3].includes(g.moore.pos));
}

/** One bot per side: bots.french / bots.british answer the requests of their side. */
export const bySide = (bots) => (req) => bots[req.side](req);

/** Plays `session` with `bot` until the end (or `maxSteps`), checking invariants after each answer. */
export function playOut(session, bot, { maxSteps = 20000, check = true } = {}) {
    let steps = 0;
    while (!session.over && steps < maxSteps) {
        session.act(bot(session.pending));
        if (check) checkInvariants(session.state);
        steps++;
    }
    return steps;
}

/** Answers the pending decision by option label (substring) or id. */
export function answer(session, match) {
    const p = session.pending;
    assert.ok(p, 'no pending decision');
    if (p.type === 'pick' && !Array.isArray(match)) match = [match];
    if (Array.isArray(match)) {
        session.act(match.map((m) => findOption(p, m).id));
        return;
    }
    session.act(findOption(p, match).id);
}

export function findOption(p, match) {
    const o = p.options.find((x) => x.id === match) ?? p.options.find((x) => x.label.includes(match));
    assert.ok(o, `no option "${match}" in "${p.prompt}": ${p.options.map((x) => x.label).join(' | ')}`);
    return o;
}

/** Answers until the pending decision's prompt contains `text` (with `fallback` for the others). */
export function until(session, text, fallback) {
    let n = 0;
    while (!session.over && !session.pending.prompt.includes(text)) {
        session.act(fallback(session.pending));
        assert.ok(++n < 500, `never reached "${text}"`);
    }
    assert.ok(!session.over, `game over before "${text}"`);
}

/** The cautious default answer: pass, keep, do not buy, apply the roll. */
export function passive(p) {
    for (const id of ['pass', 'apply', 'none', 'stay', 'no', 'top']) if (p.options.some((o) => o.id === id)) return id;
    if (p.type === 'pick') return p.options.slice(0, p.min).map((o) => o.id);
    return p.options[0].id;
}

export const newSession = (setup) => new Session(setup);
