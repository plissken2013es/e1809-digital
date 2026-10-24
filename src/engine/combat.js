// Combat: dice, rerolls, pairs, locations and casualties [docs/01 §6].

import { choose, pick, log, beat } from './ask.js';
import { rollDie } from './rng.js';
import { UNITS, LOCATIONS, enemyOf } from './data.js';
import {
    inPlay, baseDice, locationDefenders, mooreSupports, hasKeyword, gainCubes, payCubes, rerollCubeCost,
    removeBlocks, unitName, SIDE_NAME,
} from './state.js';
import { loseMorale, testAfterLoss } from './morale.js';
import { artilleryFire } from './commanders.js';
import { tacticWindow } from './tactics.js';

/** Is the Artillery on either side of the combat? (Calen bayonetas, Acero frío) */
export const artilleryCombat = (c) => c.attacker === 'artilleria' || c.target === 'artilleria';

export const diceText = (c) => c.dice.map((d) => (d.fixed ? `[${d.v}*]` : `[${d.v}]`)).join(' ') || '(sin dados)';

/**
 * Results of a set of dice [§6, D-9, D-22]: pairs per face (3 alike = 1 pair,
 * 4 = 2…) and the 3s. The attacking Artillery counts 1-pairs as 6-pairs and ignores 2s.
 */
export function results(dice, artillery = false) {
    const count = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) count[d.v]++;
    const pairs = count.map((n) => Math.floor(n / 2));
    if (artillery) {
        pairs[6] += pairs[1];
        pairs[1] = 0;
        pairs[2] = 0;
    }
    return {
        attackerCasualties: pairs[1], attackerMorale: pairs[2], cubes: count[3],
        defenderMorale: pairs[4] + pairs[5], defenderCasualties: pairs[6], sixPairs: pairs[6],
    };
}

export function describe(r) {
    const parts = [];
    if (r.defenderCasualties) parts.push(`${r.defenderCasualties} baja${r.defenderCasualties > 1 ? 's' : ''} al defensor`);
    if (r.defenderMorale) parts.push(`−${r.defenderMorale} moral al defensor`);
    if (r.attackerCasualties) parts.push(`${r.attackerCasualties} baja${r.attackerCasualties > 1 ? 's' : ''} propia${r.attackerCasualties > 1 ? 's' : ''}`);
    if (r.attackerMorale) parts.push(`−${r.attackerMorale} moral propia`);
    if (r.cubes) parts.push(`+${r.cubes} cubo${r.cubes > 1 ? 's' : ''}`);
    return parts.join(', ') || 'sin efecto';
}

/** The current combat's results. */
export const currentResults = (c) => results(c.dice, c.attacker === 'artilleria');

/**
 * An attack by `unitId` on `target` (a unit or a location) [§6]. The combat
 * lives in g.combat while it lasts (the tactics read and change it).
 */
export function* attack(g, unitId, order, target) {
    const side = UNITS[unitId].side;
    const isLoc = Boolean(LOCATIONS[target]);
    const c = (g.combat = {
        attacker: unitId, side, target, location: isLoc ? target : null, defenderSide: enemyOf(side),
        defenders: isLoc ? locationDefenders(g, target) : [target],
        dice: [], rolls: 0, extraDice: 0, fixedSixes: 0, calen: 0, bayonetUsed: false, mooreReroll: false,
        veteranos: false, vacilacion: false, hits: {}, lostBlocks: {}, switched: false, sixPairs: 0,
        defenderMoraleLost: 0, rerolls: 0,
    });
    log(g, `${unitName(unitId)} ataca a ${unitName(target)}${order.dice ? ` (${order.dice > 0 ? '+' : ''}${order.dice} dado${Math.abs(order.dice) > 1 ? 's' : ''})` : ''}.`, side);
    if (unitId === 'artilleria') yield* artilleryFire(g, target);

    yield* tacticWindow(g, 'before_combat');
    if (!isLoc && !inPlay(g, target)) {
        log(g, `${unitName(target)} ya no está en el campo: no hay combate.`);
        return endCombat(g);
    }

    if (side === 'british' && mooreSupports(g, unitId)) {
        const a = yield* choose(g, 'british', `Apoyo de Moore a ${unitName(unitId)}`, [
            { id: 'die', label: '+1 dado' },
            { id: 'reroll', label: 'Un relanzamiento gratuito' },
        ], { kind: 'moore_support' });
        c.moore = true;
        if (a === 'die') c.extraDice++;
        else c.mooreReroll = true;
    }
    if (g.turn.soultDice > 0) {
        const max = g.turn.soultDice;
        const opts = Array.from({ length: max + 1 }, (_, k) => ({ id: String(k), label: k ? `Añadir ${k} dado${k > 1 ? 's' : ''} de Soult` : 'No añadir dados de Soult' }));
        const k = Number(yield* choose(g, 'french', `Soult: quedan ${max} dados extra`, opts, { kind: 'soult_dice' }));
        c.extraDice += k;
        g.turn.soultDice -= k;
    }

    const n = Math.max(g.rules.minDice, baseDice(g, unitId, order) + c.extraDice);
    const fixed = Math.min(c.fixedSixes, n);
    c.dice = [...Array.from({ length: fixed }, () => ({ v: 6, fixed: true })), ...Array.from({ length: n - fixed }, () => ({ v: 0, fixed: false }))];
    if (n > 0) {
        yield* roll(g, c.dice.map((d, i) => i).filter((i) => !c.dice[i].fixed));
        yield* rerollLoop(g);
    } else {
        log(g, 'Sin dados: el combate no tiene efecto.');
    }
    yield* applyResults(g);
    yield* tacticWindow(g, 'after_combat');
    return endCombat(g);
}

function endCombat(g) {
    g.lastCombat = g.combat;
    g.combat = null;
}

/** Rolls the dice at these indexes; with Vacilación the 3s leave the combat. */
function* roll(g, idxs) {
    const c = g.combat;
    for (const i of idxs) c.dice[i].v = rollDie(g);
    c.rolls++;
    // thrown: what the dice showed when they landed (Vacilación may take 3s away just after)
    const thrown = idxs.map((i) => c.dice[i].v);
    const rolled = c.vacilacion ? [] : idxs;
    if (c.vacilacion) c.dice = c.dice.filter((d) => d.fixed || d.v !== 3);
    log(g, `${c.rolls === 1 ? 'Tirada' : 'Relanzamiento'}: ${diceText(c)} → ${describe(currentResults(c))}.`, 'dice');
    yield* beat(g, 'roll', { dice: c.dice.map((d) => d.v), thrown, rolled, side: c.side });
}

/** After each roll: tactics, dice modifiers, rerolls (paid) or apply [§6, D-20]. */
function* rerollLoop(g) {
    const c = g.combat;
    const side = c.side;
    for (;;) {
        if (!inPlay(g, c.attacker) || !c.dice.length) return;
        yield* tacticWindow(g, 'after_roll');
        if (!inPlay(g, c.attacker)) return;
        const free = c.dice.map((d, i) => i).filter((i) => !c.dice[i].fixed);
        const opts = [{ id: 'apply', label: `Aplicar: ${describe(currentResults(c))}` }];
        if (free.length) opts.push({ id: 'reroll', label: 'Relanzar dados' });
        const bayonet = g.rules.bayonet === 'die' && hasKeyword(c.attacker, 'bayonet') && !c.bayonetUsed;
        if (free.length && bayonet) opts.push({ id: 'bayonet', label: 'Bayoneta: ±1 a un dado' });
        if (free.length && c.calen > 0) opts.push({ id: 'calen', label: '¡Calen bayonetas!: ±1 a un dado' });
        const a = yield* choose(g, side, `Tirada de ${unitName(c.attacker)}: ${diceText(c)}`, opts, { kind: 'roll' });
        if (a === 'apply') return;
        if (a === 'bayonet' || a === 'calen') {
            if (yield* modifyDie(g, side, [1, -1], a === 'bayonet' ? 'Bayoneta' : '¡Calen bayonetas!')) {
                if (a === 'bayonet') c.bayonetUsed = true;
                else c.calen--;
            }
            continue;
        }
        yield* reroll(g, free);
    }
}

/** Payment options of a reroll of these dice [D-20]. */
export function rerollPayments(g, idxs) {
    const c = g.combat;
    const st = g.units[c.attacker];
    const out = [];
    if (c.mooreReroll) out.push({ id: 'moore', label: 'Gratis (apoyo de Moore)' });
    if (c.veteranos && c.rolls === 2) out.push({ id: 'veteranos', label: 'Gratis (Veteranos de Iberia)' });
    if (g.turn.riflemen && idxs.every((i) => c.dice[i].v <= 2)) out.push({ id: 'riflemen', label: 'Gratis (Riflemen vs. Voltigeurs)' });
    const cost = rerollCubeCost(g, c.side);
    if (g.players[c.side].cubes >= cost) out.push({ id: 'cubes', label: `${cost} cubos de Inercia` });
    if (st.morale !== null && st.morale > 0) out.push({ id: 'morale', label: `−1 moral de ${unitName(c.attacker)} (${st.morale})` });
    if (st.blocks > 0) out.push({ id: 'block', label: `Retirar 1 ficha de ${unitName(c.attacker)} (${st.blocks})` });
    return out;
}

function* reroll(g, free) {
    const c = g.combat;
    const side = c.side;
    const ids = yield* pick(g, side, '¿Qué dados relanzas?', free.map((i) => ({ id: String(i), label: `Dado ${i + 1}: ${c.dice[i].v}` })), 1, free.length, { kind: 'reroll_dice' });
    const idxs = ids.map(Number);
    const pay = yield* choose(g, side, '¿Cómo pagas el relanzamiento?', rerollPayments(g, idxs), { kind: 'reroll_pay' });
    if (pay === 'moore') c.mooreReroll = false;
    else if (pay === 'cubes') payCubes(g, side, rerollCubeCost(g, side));
    else if (pay === 'morale') {
        const before = g.units[c.attacker].morale;
        loseMorale(g, c.attacker, 1, 'relanzamiento');
        yield* testAfterLoss(g, c.attacker, before);
    } else if (pay === 'block') {
        removeBlocks(g, c.attacker, 1, 'relanzamiento');
    }
    // A unit eliminated while paying stops the combat: the last roll stands [§6]
    if (!inPlay(g, c.attacker)) return;
    c.rerolls++;
    yield* roll(g, idxs);
}

/**
 * ±1 (or any face) to one die that is not fixed. Returns false if nothing was changed.
 * @param {number[] | 'any'} deltas
 */
export function* modifyDie(g, side, deltas, why) {
    const c = g.combat;
    const opts = [];
    c.dice.forEach((d, i) => {
        if (d.fixed) return;
        const faces = deltas === 'any' ? [1, 2, 3, 4, 5, 6].filter((f) => f !== d.v) : deltas.map((x) => d.v + x).filter((f) => f >= 1 && f <= 6);
        for (const f of faces) opts.push({ id: `${i}:${f}`, label: `Dado ${i + 1}: ${d.v} → ${f}` });
    });
    if (!opts.length) return false;
    const a = yield* choose(g, side, `${why}: ¿qué dado cambias?`, opts, { kind: 'die_mod' });
    const [i, f] = a.split(':').map(Number);
    log(g, `${why}: el dado ${i + 1} pasa de ${c.dice[i].v} a ${f}.`, side);
    c.dice[i].v = f;
    if (c.vacilacion && f === 3) c.dice.splice(i, 1);
    return true;
}

/** Rerolls one die for free (Voluntad, Avanzadillas). */
export function* rerollOne(g, side, why) {
    const c = g.combat;
    const free = c.dice.map((d, i) => i).filter((i) => !c.dice[i].fixed);
    if (!free.length) return;
    const a = yield* choose(g, side, `${why}: ¿qué dado se relanza?`, free.map((i) => ({ id: String(i), label: `Dado ${i + 1}: ${c.dice[i].v}` })), { kind: 'die_pick' });
    yield* roll(g, [Number(a)]);
}

/** Applies the last roll [§6.3–6.4, §4.2, D-13]; then the morale tests, defender first. */
function* applyResults(g) {
    const c = g.combat;
    const r = currentResults(c);
    c.sixPairs = r.sixPairs;
    c.defenderMoraleLost = r.defenderMorale;
    const attackerIn = inPlay(g, c.attacker);
    const locationsBefore = { ...g.locations };
    log(g, `Resultado: ${describe(r)}.`, 'phase');
    if (r.cubes && attackerIn) gainCubes(g, c.side, r.cubes, 'treses');

    const before = {};
    const hit = (u, casualties, morale) => {
        c.hits[u] ??= { casualties: 0, morale: 0 };
        c.hits[u].casualties += casualties;
        c.hits[u].morale += morale;
    };
    const casualties = (u, n) => {
        if (n <= 0 || !inPlay(g, u)) return;
        const k = removeBlocks(g, u, n, 'combate');
        c.lostBlocks[u] = (c.lostBlocks[u] ?? 0) + k;
        hit(u, k, 0);
    };
    const morale = (u, n) => {
        if (n <= 0 || !inPlay(g, u)) return;
        before[u] ??= g.units[u].morale;
        hit(u, 0, loseMorale(g, u, n, 'combate'));
    };

    // Defender
    let defCas = r.defenderCasualties;
    if (c.location) {
        c.defenders = locationDefenders(g, c.location);
        if (defCas > 0) {
            g.locations[c.location] = c.side;
            c.switched = true;
            defCas--;
            log(g, `¡${LOCATIONS[c.location].name} pasa a manos del ${SIDE_NAME[c.side]}!`, c.side);
        }
        yield* spread(g, c.defenders, defCas, r.defenderMorale, casualties, morale);
    } else {
        casualties(c.target, defCas);
        morale(c.target, r.defenderMorale);
    }
    // Attacker
    if (attackerIn) {
        casualties(c.attacker, r.attackerCasualties);
        morale(c.attacker, r.attackerMorale);
    }
    yield* beat(g, 'results', { results: r, scene: sceneOf(g, c, locationsBefore) });

    const lost = Object.keys(c.lostBlocks).filter((u) => c.lostBlocks[u] > 0 && inPlay(g, u));
    if (lost.length) yield* tacticWindow(g, 'casualties', { lost });

    for (const u of [...c.defenders, c.attacker]) {
        if (before[u] !== undefined) yield* testAfterLoss(g, u, before[u]);
    }
}

/**
 * What the combat scene of the view shows (ui/combatScene.js): who fought, the pieces each
 * had before this result, what each lost, Moore's support and the places that changed hands.
 */
function sceneOf(g, c, locationsBefore) {
    const unit = (id) => {
        const hit = c.hits[id] ?? { casualties: 0, morale: 0 };
        return { id, blocks: g.units[id].blocks + hit.casualties, lost: hit.casualties, morale: hit.morale };
    };
    return {
        side: c.side, attacker: unit(c.attacker), defenders: c.defenders.map(unit), location: c.location, moore: Boolean(c.moore),
        captured: Object.keys(g.locations).filter((l) => g.locations[l] !== locationsBefore[l]).map((l) => ({ location: l, by: g.locations[l] })),
    };
}

/** The owner spreads the losses of a location among its defenders [§4.2]. */
function* spread(g, defenders, cas, mor, casualties, morale) {
    const alive = () => defenders.filter((u) => inPlay(g, u));
    const owner = g.combat.defenderSide;
    const plan = { cas: {}, mor: {} };
    for (const [kind, n, what] of [['cas', cas, 'una baja'], ['mor', mor, '1 de moral']]) {
        for (let i = 0; i < n; i++) {
            const list = alive().filter((u) => kind === 'mor' ? g.units[u].morale - (plan.mor[u] ?? 0) > 0 : g.units[u].blocks - (plan.cas[u] ?? 0) > 0);
            if (!list.length) break;
            const u = yield* choose(g, owner, `¿Qué defensor de ${LOCATIONS[g.combat.location].name} sufre ${what}?`,
                list.map((id) => ({ id, label: `${unitName(id)} (moral ${g.units[id].morale}, ${g.units[id].blocks} fichas)`, ref: id })), { kind: 'assign_loss' });
            plan[kind][u] = (plan[kind][u] ?? 0) + 1;
        }
    }
    for (const [u, n] of Object.entries(plan.cas)) casualties(u, n);
    for (const [u, n] of Object.entries(plan.mor)) morale(u, n);
}
