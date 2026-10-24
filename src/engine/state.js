// Queries and primitive changes of the game state (no decisions here, so no
// generators): conditions of the orders, dice, Inertia cubes, casualties,
// elimination and victory [docs/01 §4].

import { log, GameEnd } from './ask.js';
import { UNITS, COMMANDERS, LOCATIONS, enemyOf, countsForVictory } from './data.js';

export const SIDE_NAME = { french: 'francés', british: 'británico' };
export const unitName = (id) => UNITS[id]?.name ?? LOCATIONS[id]?.name ?? id;

export const inPlay = (g, id) => g.units[id].status === 'in';
export const sideOf = (id) => UNITS[id].side;

// ------------------------------------------------------------------ conditions

/** One condition of units.json ('a|b' = either). */
export function holds(g, cond) {
    return cond.split('|').some((c) => {
        const [k, v] = c.split(':');
        if (k === 'paget_at') return inPlay(g, 'paget') && g.units.paget.pos === Number(v);
        if (k === 'alive') return inPlay(g, v);
        if (k === 'eliminated') return !inPlay(g, v);
        const m = k.match(/^(elvina|palavea)_(british|french)$/);
        if (m) return g.locations[m[1]] === m[2];
        throw new Error(`unknown condition ${c}`);
    });
}

export const allHold = (g, conds = []) => conds.every((c) => holds(g, c));

/** In-play defenders of a location (those of the side that controls it) [docs/01 §4.2]. */
export function locationDefenders(g, loc) {
    const owner = g.locations[loc];
    return LOCATIONS[loc].defenders[owner].filter((u) => inPlay(g, u));
}

/**
 * Orders the unit can carry out now, one entry per order and target [D-11, D-12].
 * @returns {{ i: number, order: any, target: string }[]}
 */
export function availableOrders(g, unitId) {
    const u = UNITS[unitId];
    const st = g.units[unitId];
    if (st.status !== 'in') return [];
    const out = [];
    u.orders.forEach((order, i) => {
        if (!allHold(g, order.if)) return;
        if (order.act === 'move') {
            out.push({ i, order, target: `paget_${order.to}` });
            return;
        }
        if (order.split) {
            // one order; each block picks its unit (turn.js reinforce)
            if (st.blocks > 0 && order.targets.some((t) => freeSlots(g, t) > 0)) out.push({ i, order, target: null });
            return;
        }
        for (const t of order.targets) {
            if (order.act === 'attack') {
                if (LOCATIONS[t] ? g.locations[t] === u.side : !inPlay(g, t)) continue;
            } else if (order.act === 'reinforce') {
                if (freeSlots(g, t) < 1 || st.blocks < 1) continue;
            }
            out.push({ i, order, target: t });
        }
    });
    // a target reached by several orders is attacked with the best of them (most dice; the first
    // if equal): Hill on the Artillery without the −3 once Delaborde is defeated [D-54]
    const best = {};
    for (const o of out) {
        if (o.order.act !== 'attack') continue;
        const dice = baseDice(g, unitId, o.order);
        if (!best[o.target] || dice > best[o.target].dice) best[o.target] = { o, dice };
    }
    return out.filter((o) => o.order.act !== 'attack' || best[o.target].o === o);
}

/**
 * Empty slots of a unit in play: a unit never holds more blocks than its printed slots (its starting
 * blocks), so a reinforcement only fills the gaps [§10, D-19].
 */
export const freeSlots = (g, unitId) => (inPlay(g, unitId) ? UNITS[unitId].blocks - g.units[unitId].blocks : 0);

/** Dice of an attack before the combat extras: card + order + modifiers of the card that hold [docs/01 §4.1]. */
export function baseDice(g, unitId, order) {
    const u = UNITS[unitId];
    let n = u.dice + (order.dice ?? 0);
    for (const m of u.modifiers) if (Number.isInteger(m.dice) && allHold(g, m.if)) n += m.dice;
    return n;
}

/** The dice modifiers of the unit's card that hold now (e.g. «+1 dado si Elviña»). */
export const activeModifiers = (g, unitId) => UNITS[unitId].modifiers.filter((m) => Number.isInteger(m.dice) && allHold(g, m.if));

/** Dice the unit would roll now, before the order's own modifier and the combat extras (Moore, tactics). */
export const currentDice = (g, unitId) => baseDice(g, unitId, {});

/** Each attack the unit could make now, with its dice (order modifier and minimum included). */
export const attackDice = (g, unitId) => availableOrders(g, unitId)
    .filter((o) => o.order.act === 'attack')
    .map((o) => ({ ...o, dice: Math.max(g.rules.minDice, baseDice(g, unitId, o.order)) }));

export const hasKeyword = (unitId, kw) => UNITS[unitId].modifiers.some((m) => m.keyword === kw);

// ------------------------------------------------------------------ Moore

/** Is Moore on the board (alive, or fallen but not yet removed)? */
export const moorePresent = (g) => g.moore.status === 'active' || g.moore.status === 'dying';

/** Moore's position that influences this unit (Paget: #1 wherever he is) [D-5]. */
export function moorePositionFor(unitId) {
    const entry = Object.entries(COMMANDERS.moore.positions).find(([, ids]) => ids.includes(unitId));
    return entry ? Number(entry[0]) : null;
}

/** Is the unit under Moore's influence for his support (+1 die / free reroll)? */
export const mooreSupports = (g, unitId) => moorePresent(g) && !g.moore.supportLost && moorePositionFor(unitId) === g.moore.pos;

// ------------------------------------------------------------------ Inertia cubes

/** Cubes left in the common supply (Infinity when unlimited) [D-24]. */
export const supplyLeft = (g) => (g.supply === null ? Infinity : g.supply);

/** Takes up to `n` cubes from the common supply for `side`. @returns {number} cubes received */
export function gainCubes(g, side, n, why = '') {
    const got = Math.max(0, Math.min(n, supplyLeft(g)));
    if (g.supply !== null) g.supply -= got;
    g.players[side].cubes += got;
    if (got) log(g, `El ${SIDE_NAME[side]} recibe ${got} cubo${got > 1 ? 's' : ''} de Inercia${why ? ` (${why})` : ''}${got < n ? ' (la reserva común se ha agotado)' : ''}.`, side);
    return got;
}

/** Returns `n` cubes of `side` to the common supply. */
export function payCubes(g, side, n) {
    if (g.players[side].cubes < n) throw new Error(`${side} cannot pay ${n} cubes`);
    g.players[side].cubes -= n;
    if (g.supply !== null) g.supply += n;
}

/** Cubes placed on a market card come from the common supply. @returns {number} placed */
export function cubesFromSupply(g, n) {
    const got = Math.max(0, Math.min(n, supplyLeft(g)));
    if (g.supply !== null) g.supply -= got;
    return got;
}

export const cubesToSupply = (g, n) => {
    if (g.supply !== null) g.supply += n;
};

/** Cost of rerolling with cubes for `side`: 4 if the opponent has Los hombres están agotados. */
export const rerollCubeCost = (g, side) => (g.players[enemyOf(side)].tactics.includes('los_hombres_estan_agotados') ? 4 : 3);

// ------------------------------------------------------------------ casualties and elimination

const THRESHOLDS = { french: [[5, 1], [10, 2]], british: [[4, 1], [8, 2], [12, 3]] };

/**
 * Removes up to `n` blocks of a unit; each goes to the enemy's casualty track [D-18].
 * A unit left without blocks is destroyed (not the Reserve).
 * @returns {number} blocks removed
 */
export function removeBlocks(g, unitId, n, why = '') {
    const st = g.units[unitId];
    const k = Math.min(n, st.blocks);
    if (k <= 0) return 0;
    st.blocks -= k;
    log(g, `${unitName(unitId)} pierde ${k} ficha${k > 1 ? 's' : ''}${why ? ` (${why})` : ''}.`, 'bad');
    addCasualties(g, sideOf(unitId), k);
    if (st.blocks === 0 && UNITS[unitId].type !== 'reserve' && st.status === 'in') eliminate(g, unitId, 'destroyed');
    return k;
}

/** `victimSide` lost `k` markers: they go to the other player's track, who may reach a threshold [§4.4]. */
export function addCasualties(g, victimSide, k) {
    const taker = enemyOf(victimSide);
    const p = g.players[taker];
    const before = p.casualties;
    p.casualties += k;
    for (const [at, cubes] of THRESHOLDS[taker]) {
        if (before < at && p.casualties >= at) gainCubes(g, taker, cubes, `${at} bajas enemigas`);
    }
}

/** Takes a unit out of the game (destroyed or routed) [docs/01 §4.4, §7]. */
export function eliminate(g, unitId, how) {
    const st = g.units[unitId];
    if (st.status !== 'in') return;
    if (UNITS[unitId].type === 'reserve') return; // never eliminated
    st.status = how;
    log(g, `${unitName(unitId)} queda ${how === 'destroyed' ? 'destruida' : 'desbandada'}.`, 'bad');
    if (st.blocks > 0) {
        const k = st.blocks;
        st.blocks = 0;
        addCasualties(g, sideOf(unitId), k);
    }
    if (st.morale !== null) st.morale = Math.max(0, st.morale);
    // A location whose defenders have all gone changes hands [D-14]
    for (const loc of Object.keys(LOCATIONS)) {
        const owner = g.locations[loc];
        // only a place this unit defended: one already without defenders does not flip back and forth
        if (owner === sideOf(unitId) && LOCATIONS[loc].defenders[owner].includes(unitId) && locationDefenders(g, loc).length === 0) {
            g.locations[loc] = enemyOf(owner);
            log(g, `${LOCATIONS[loc].name} pasa a manos del ${SIDE_NAME[enemyOf(owner)]}: no le quedan defensores.`, enemyOf(owner));
        }
    }
    checkVictory(g);
}

/** Divisions of `side` eliminated (the ones that count for victory) [D-27]. */
export const eliminatedOf = (g, side) => Object.keys(g.units).filter((id) => sideOf(id) === side && !inPlay(g, id) && countsForVictory(id));

/** Ends the game when a side has lost 2 Divisions; if both at once, the active side (attacker) wins [§6]. */
export function checkVictory(g) {
    const lostB = eliminatedOf(g, 'british').length >= 2;
    const lostF = eliminatedOf(g, 'french').length >= 2;
    if (!lostB && !lostF) return;
    const winner = lostB && lostF ? g.active : lostB ? 'french' : 'british';
    throw new GameEnd(winner, `el ${SIDE_NAME[enemyOf(winner)]} ha perdido dos Divisiones`);
}

// ------------------------------------------------------------------ morale (no tests here: see morale.js)

/** Raises morale up to the starting maximum [D-37]. @returns {number} points gained */
export function raiseMorale(g, unitId, n) {
    const st = g.units[unitId];
    if (st.morale === null || st.status !== 'in') return 0;
    const max = UNITS[unitId].morale.max;
    const k = Math.max(0, Math.min(n, max - st.morale));
    st.morale += k;
    if (k) log(g, `${unitName(unitId)} recupera ${k} de moral (${st.morale}).`, 'good');
    return k;
}

/** Units of `side` in play with a morale track. */
export const moraleUnits = (g, side) => Object.keys(g.units).filter((id) => sideOf(id) === side && inPlay(g, id) && g.units[id].morale !== null);
