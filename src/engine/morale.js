// Morale: losses, tests, rout and the ways to avoid it [docs/01 §7].

import { choose, log, beat } from './ask.js';
import { rollDie } from './rng.js';
import { UNITS } from './data.js';
import { eliminate, unitName, sideOf, moraleUnits, SIDE_NAME } from './state.js';
import { mooreRally, mooreCanRally } from './commanders.js';
import { tacticWindow, discardTactic } from './tactics.js';

/**
 * Takes `n` morale points from a unit, without tests. At 0 the unit is
 * eliminated (no test, no rescue).
 * @returns {number} points lost
 */
export function loseMorale(g, unitId, n, why = '') {
    const st = g.units[unitId];
    if (st.status !== 'in' || st.morale === null || n <= 0) return 0;
    const k = Math.min(n, st.morale);
    st.morale -= k;
    log(g, `${unitName(unitId)} pierde ${k} de moral${why ? ` (${why})` : ''}: queda en ${st.morale}.`, 'bad');
    if (st.morale === 0) eliminate(g, unitId, 'routed');
    return k;
}

/**
 * Morale tests owed after a unit went from `before` to its current morale:
 * one per hit, or one per point with the option moraleTests: point [D-15].
 */
export function* testAfterLoss(g, unitId, before) {
    const st = g.units[unitId];
    if (st.status !== 'in' || st.morale === null || st.morale >= before) return;
    if (g.rules.moraleTests === 'point') {
        for (let v = before - 1; v >= st.morale && st.status === 'in'; v--) {
            if (v <= 5) yield* moraleTest(g, unitId, v);
        }
    } else if (st.morale <= 5) {
        yield* moraleTest(g, unitId, st.morale);
    }
}

/** One hit: lose `n` points, then the tests it causes. */
export function* hitMorale(g, unitId, n, why = '') {
    const before = g.units[unitId].morale;
    if (loseMorale(g, unitId, n, why)) yield* testAfterLoss(g, unitId, before);
}

/**
 * Morale test: 1d6 above the morale (+2 with Arenga) routs the unit unless
 * someone saves it [§7, D-16]. @returns {Generator<any, boolean>} true if the unit stays
 */
export function* moraleTest(g, unitId, value = g.units[unitId].morale) {
    const side = sideOf(unitId);
    const test = { unit: unitId, bonus: 0 };
    const st = g.units[unitId];
    const before = st.morale;
    yield* tacticWindow(g, 'morale_test', { owner: side, test });
    if (st.status !== 'in') return false;
    value += st.morale - before; // morale raised (or lost) just before the roll counts
    const roll = rollDie(g);
    const limit = value + test.bonus;
    const ok = roll <= limit;
    log(g, `Test de moral de ${unitName(unitId)}: sale ${roll} contra ${limit}${test.bonus ? ` (${value} + ${test.bonus})` : ''}: ${ok ? 'aguanta' : 'falla'}.`, ok ? 'good' : 'bad');
    yield* beat(g, 'morale', { unit: unitId, roll, limit, ok });
    if (ok) return true;
    if (yield* trySave(g, unitId)) return true;
    // the view shows its men running off (combatScene.js) before the unit leaves the board
    yield* beat(g, 'rout', { unit: unitId, side, blocks: st.blocks });
    eliminate(g, unitId, 'routed');
    return false;
}

/** After a failed test: Reagrupación, Soult or Moore's rally, as long as one is left [§7]. */
function* trySave(g, unitId) {
    const side = sideOf(unitId);
    const tried = new Set();
    for (;;) {
        if (g.units[unitId].status !== 'in') return false;
        const opts = [];
        if (g.players[side].tactics.includes('reagrupacion') && !locked(g, side, 'reagrupacion')) opts.push({ id: 'reagrupacion', label: 'Jugar Reagrupación' });
        if (side === 'french' && !g.soult.used) opts.push({ id: 'soult', label: 'Usar a Soult (único uso)' });
        if (side === 'british' && !tried.has('moore') && mooreCanRally(g, unitId)) opts.push({ id: 'moore', label: 'Arenga de Moore' });
        if (!opts.length) return false;
        opts.push({ id: 'none', label: 'Dejar que se desbande' });
        const a = yield* choose(g, side, `${unitName(unitId)} va a desbandarse. ¿Evitarlo?`, opts, { kind: 'save', ref: unitId });
        if (a === 'none') return false;
        tried.add(a);
        if (a === 'reagrupacion') {
            discardTactic(g, side, 'reagrupacion');
            log(g, `El ${SIDE_NAME[side]} juega Reagrupación: ${unitName(unitId)} no se desbanda.`, 'good');
            return true;
        }
        if (a === 'soult') {
            g.soult.used = true;
            log(g, `Soult evita la desbandada de ${unitName(unitId)} y queda agotado.`, 'good');
            return true;
        }
        if (yield* mooreRally(g, unitId)) return true;
    }
}

const locked = (g, side, id) => g.players[side].locked[id] === g.turnNo;

/**
 * `chooser` spreads `n` morale points of loss among the units of `victimSide`
 * (Moore's death, Rumores de muerte), one at a time; then each unit hit tests [D-7].
 */
export function* distributeMoraleLoss(g, victimSide, n, chooser, why) {
    const before = {};
    for (let i = 0; i < n; i++) {
        const units = moraleUnits(g, victimSide);
        if (!units.length) break;
        const u = yield* choose(g, chooser, `${why}: ¿qué unidad pierde 1 de moral? (${n - i} por repartir)`,
            units.map((id) => ({ id, label: `${unitName(id)} (moral ${g.units[id].morale})`, ref: id })), { kind: 'assign_morale' });
        before[u] ??= g.units[u].morale;
        loseMorale(g, u, 1, why);
    }
    for (const [u, b] of Object.entries(before)) yield* testAfterLoss(g, u, b);
}

/** Units of `side` whose morale can still go up. */
export const canRaise = (g, side) => moraleUnits(g, side).filter((id) => g.units[id].morale < UNITS[id].morale.max);
