// Setup, rules options and the round loop [docs/01 §3, §12].

import { pick, log, GameEnd } from './ask.js';
import { seedFrom, shuffle } from './rng.js';
import { UNITS, TACTICS, deckOf } from './data.js';
import { gainCubes, SIDE_NAME } from './state.js';
import { playTurn, cardLabel } from './turn.js';
import { refillMarket } from './tactics.js';

/** Rules options (docs/01 §12); the defaults are the confirmed decisions. */
export const DEFAULT_RULES = {
    bayonet: 'die', // die | none [D-1]
    mooreRally: 'rulebook', // rulebook | card [D-2]
    mooreUnderFire: 'always', // always | influence [D-8]
    reserveActivation: 'free', // free | block [D-17]
    moraleTests: 'hit', // hit | point [D-15]
    minDice: 1, // 1 | 0 [D-21]
    inertiaSupply: 25, // 25 | 'unlimited' [D-24]
    discardThreeTactics: 3, // 3 | 2 [D-30]
    maxTurns: 120, // safety net: a game never gets near it
};

export const DEFAULT_SETUP = {
    seed: '1',
    rules: DEFAULT_RULES,
    // Debug scenario, applied after shuffling:
    //   hands: { french: [card ids], british: [...] }   opening hands (skips the choice of 3)
    //   deckTop: { french: [card ids], british: [...] } cards on top of the Action decks, in order
    //   discard: { french: [card ids], british: [...] } cards already played (in the discard pile)
    //   streak: { french: [cubes, …], british: [...] }  cubes of the last cards played (Inertia streak)
    //   units: { unitId: { morale, blocks, pos, status } }
    //   locations: { elvina: 'french' | 'british', palavea: … }
    //   moore: { pos, track, status }, soultUsed: bool
    //   cubes: { french: n, british: n }
    //   tactics: { french: [tactic ids], british: [...] }   in the players' zones
    //   market: [tactic ids]                               the row, left to right
    //   marketDiscard: [tactic ids]                        the market's discard pile
    //   dice: [1..6, …]                                    results of the next dice rolled, in order
    scenario: {},
};

export function normalizeSetup(setup = {}) {
    return { ...DEFAULT_SETUP, ...setup, rules: { ...DEFAULT_RULES, ...setup.rules }, scenario: { ...setup.scenario } };
}

// limbo: Action cards between zones while a decision is pending (opening hand, Soult)
const newPlayer = () => ({ cubes: 0, hand: [], deck: [], discard: [], limbo: [], streak: [], tactics: [], locked: {}, casualties: 0 });

/** Plain, serializable initial state (before any shuffling). */
export function createState(setup) {
    const units = {};
    for (const u of Object.values(UNITS)) {
        units[u.id] = { blocks: u.blocks, morale: u.morale ? u.morale.max : null, status: 'in', ...(u.id === 'paget' ? { pos: 1 } : {}) };
    }
    return {
        v: 1,
        setup,
        rules: setup.rules,
        rng: seedFrom(setup.seed),
        roundNo: 0,
        turnNo: 0,
        active: 'french',
        units,
        locations: { elvina: 'british', palavea: 'british' },
        moore: { pos: 1, track: 1, status: 'active', supportLost: false },
        soult: { used: false },
        supply: setup.rules.inertiaSupply === 'unlimited' ? null : Number(setup.rules.inertiaSupply),
        players: { french: newPlayer(), british: newPlayer() },
        market: { deck: [], row: [], discard: [] },
        turn: { side: 'french', no: 0, bought: false, riflemen: false, soultDice: 0, forcedTop: false },
        combat: null,
        lastCombat: null,
        forcedDice: [],
        log: [],
        pending: null,
        result: null,
    };
}

/** The whole game as a generator of decisions. */
export function* run(g) {
    yield* setupGame(g);
    for (;;) {
        for (const side of ['french', 'british']) {
            if (!g.players.french.hand.length && !g.players.british.hand.length) {
                throw new GameEnd('british', 'se acabaron las cartas de Acción: las tropas británicas embarcan');
            }
            if (g.turnNo >= g.rules.maxTurns) throw new Error(`the game went over ${g.rules.maxTurns} turns`);
            yield* playTurn(g, side);
        }
    }
}

function* setupGame(g) {
    const sc = g.setup.scenario;
    log(g, 'Elviña, 16 de enero de 1809.', 'phase');
    for (const side of ['french', 'british']) g.players[side].deck = shuffle(g, deckOf(side));
    g.market.deck = shuffle(g, Object.keys(TACTICS));
    applyScenario(g, sc);
    refillMarket(g);
    for (const side of ['french', 'british']) {
        if (sc.cubes?.[side] === undefined) gainCubes(g, side, 2, 'preparación');
    }
    // Opening hands: the British player draws 5, the French 6; each keeps 3 [§3, D-34]
    for (const side of ['french', 'british']) {
        const p = g.players[side];
        if (sc.hands?.[side]) continue;
        const drawn = (p.limbo = p.deck.splice(0, side === 'french' ? 6 : 5));
        const keep = yield* pick(g, side, `Mano inicial del ${SIDE_NAME[side]}: elige 3 cartas`, drawn.map((id, i) => ({ id: String(i), label: cardLabel(id), ref: id })), 3, 3, { kind: 'opening' });
        p.hand = keep.map((i) => drawn[Number(i)]);
        p.deck.push(...drawn.filter((_, i) => !keep.includes(String(i))));
        p.limbo = [];
        shuffle(g, p.deck);
    }
}

function takeFrom(list, id, what) {
    const i = list.indexOf(id);
    if (i < 0) throw new Error(`scenario: ${id} is not available in ${what}`);
    return list.splice(i, 1)[0];
}

function applyScenario(g, sc) {
    for (const side of ['french', 'british']) {
        const p = g.players[side];
        for (const id of sc.hands?.[side] ?? []) p.hand.push(takeFrom(p.deck, id, `${side} deck`));
        const top = (sc.deckTop?.[side] ?? []).map((id) => takeFrom(p.deck, id, `${side} deck`));
        p.deck.unshift(...top);
        for (const id of sc.discard?.[side] ?? []) p.discard.push(takeFrom(p.deck, id, `${side} deck`));
        if (sc.streak?.[side]) p.streak = [...sc.streak[side]];
        for (const id of sc.tactics?.[side] ?? []) p.tactics.push(takeFrom(g.market.deck, id, 'tactic deck'));
        if (sc.cubes?.[side] !== undefined) {
            p.cubes = sc.cubes[side];
            if (g.supply !== null) g.supply -= p.cubes;
        }
    }
    if (sc.market) g.market.row = sc.market.map((id) => ({ id: takeFrom(g.market.deck, id, 'tactic deck'), cubes: 0 }));
    for (const id of sc.marketDiscard ?? []) g.market.discard.push(takeFrom(g.market.deck, id, 'tactic deck'));
    for (const [id, v] of Object.entries(sc.units ?? {})) Object.assign(g.units[id], v);
    Object.assign(g.locations, sc.locations ?? {});
    Object.assign(g.moore, sc.moore ?? {});
    if (sc.soultUsed) g.soult.used = true;
    g.forcedDice = [...(sc.dice ?? [])];
}
