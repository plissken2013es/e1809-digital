// Sir John Moore: moves, the Path of Sacrifice, his rally and his death [docs/01 §8.1].
// Soult's double activation lives in turn.js; his rescue from rout in morale.js.

import { choose, log, beat } from './ask.js';
import { rollDie } from './rng.js';
import { COMMANDERS } from './data.js';
import { moorePositionFor, unitName, locationDefenders } from './state.js';
import { distributeMoraleLoss } from './morale.js';

const MAX = COMMANDERS.moore.track.max;
const RISK_ABOVE = COMMANDERS.moore.track.risk_above;

/**
 * Advances the Path of Sacrifice and rolls the risk if it ends above 2: 2d6 below
 * the position fells Moore [D-6]. Felled by a British action he stays until the
 * end of the turn [D-7, D-46]; by the Artillery he dies at once.
 * @param {'british' | 'artillery'} cause
 * @returns {Generator<any, boolean>} true if Moore is still standing
 */
export function* mooreRisk(g, steps, cause, { rally = false } = {}) {
    const m = g.moore;
    m.track = Math.min(MAX, m.track + steps);
    log(g, `La Senda del Sacrificio de Moore avanza ${steps} hasta ${m.track}.`, 'british');
    if (m.track <= RISK_ABOVE) return true;
    const a = rollDie(g);
    const b = rollDie(g);
    const fell = a + b < m.track;
    log(g, `Tirada de riesgo de Moore: ${a} + ${b} = ${a + b} contra ${m.track}: ${fell ? '¡Moore cae abatido!' : 'sale ileso'}.`, fell ? 'bad' : 'good');
    yield* beat(g, 'moore_risk', { dice: [a, b], track: m.track, fell });
    if (!fell) return true;
    if (cause === 'artillery') {
        yield* mooreDies(g, 'la Artillería francesa');
    } else {
        m.status = 'dying';
        m.supportLost = rally; // a failed rally ends his support at once
        log(g, 'Su ficha se retirará al final del turno; mientras tanto su apoyo sigue vigente' + (rally ? ', salvo el de esta arenga.' : '.'), 'british');
    }
    return false;
}

/** Moore is removed: −3 morale spread by the British player among his units [D-7]. */
export function* mooreDies(g, cause) {
    g.moore.status = 'dead';
    log(g, `Sir John Moore muere (${cause}).`, 'bad');
    yield* beat(g, 'moore_dead', {});
    yield* distributeMoraleLoss(g, 'british', 3, 'british', 'Muerte de Moore');
}

/** Optional move in the British planning phase; the horse pays the first step [§8.1, D-45]. */
export function* mooreMove(g, horse, unitId) {
    const m = g.moore;
    if (m.status !== 'active') return;
    const opts = [{ id: 'stay', label: `Moore se queda en #${m.pos}` }];
    for (const p of [1, 2, 3]) {
        if (p === m.pos) continue;
        const steps = Math.abs(p - m.pos);
        const paid = Math.max(0, steps - (horse ? 1 : 0));
        opts.push({ id: String(p), label: `Mover a Moore a #${p} (${paid ? `${paid} paso${paid > 1 ? 's' : ''} en la Senda` : 'gratis, caballo'})` });
    }
    const a = yield* choose(g, 'british', '¿Mover a Moore?', opts, { kind: 'moore_move', ref: unitId });
    if (a === 'stay') return;
    const to = Number(a);
    const paid = Math.max(0, Math.abs(to - m.pos) - (horse ? 1 : 0));
    m.pos = to;
    log(g, `Moore cabalga a la posición #${to}.`, 'british');
    if (paid) yield* mooreRisk(g, paid, 'british');
}

/** Can Moore rally this unit? Standing (not fallen) and in the position that influences it [D-3]. */
export const mooreCanRally = (g, unitId) => g.moore.status === 'active' && moorePositionFor(unitId) === g.moore.pos;

/**
 * Moore's rally [§8.1, D-2]. rulebook: 1 step and surviving is enough; card: 2 steps,
 * then 1d6 of 1–5. @returns {Generator<any, boolean>} true if the unit is saved
 */
export function* mooreRally(g, unitId) {
    const card = g.rules.mooreRally === 'card';
    log(g, `Moore arenga a ${unitName(unitId)}.`, 'british');
    const standing = yield* mooreRisk(g, card ? 2 : 1, 'british', { rally: true });
    if (!standing) {
        log(g, 'Moore cae antes de poder arengar.', 'bad');
        return false;
    }
    if (!card) return true;
    const r = rollDie(g);
    log(g, `Arenga: sale ${r} (${r <= 5 ? 'éxito' : 'fracaso'}).`, r <= 5 ? 'good' : 'bad');
    return r <= 5;
}

/**
 * Artillery card: «Si Moore está en #1 o #2, avanzar +2 el marcador de Honor y
 * forzar la tirada inglesa», each time the Artillery fights [D-8].
 */
export function* artilleryFire(g, target) {
    const m = g.moore;
    if (m.status !== 'active' || (m.pos !== 1 && m.pos !== 2)) return;
    if (g.rules.mooreUnderFire === 'influence') {
        const targets = target === 'elvina' || target === 'palavea' ? locationDefenders(g, target) : [target];
        if (!targets.some((u) => moorePositionFor(u) === m.pos)) return;
    }
    log(g, `La Artillería francesa tiene a tiro a Moore en #${m.pos}.`, 'french');
    yield* mooreRisk(g, 2, 'artillery');
}
