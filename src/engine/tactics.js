// Tactic cards: when they can be played (windows), the rule of each of the 36
// cards, and the market [docs/01 §11].

import { choose, pick, log, confirm } from './ask.js';
import { randomInt, shuffle } from './rng.js';
import { TACTICS, UNITS, enemyOf } from './data.js';
import {
    inPlay, moraleUnits, raiseMorale, gainCubes, payCubes, cubesFromSupply, cubesToSupply, removeBlocks, unitName,
    sideOf, SIDE_NAME, availableOrders,
} from './state.js';
import { moraleTest, distributeMoraleLoss, loseMorale, testAfterLoss, canRaise } from './morale.js';
import { artilleryCombat, modifyDie, rerollOne } from './combat.js';

/** Points of the turn where «en cualquier momento» cards are offered [D-32]. */
const ANY_POINTS = new Set(['french_turn_start', 'before_planning', 'planning', 'before_combat', 'after_roll', 'after_combat', 'reorganization']);

/** Does a card with this window fit this point for `side`? (§11.1) */
function fits(window, point, side, g, ctx) {
    const own = side === g.active;
    switch (window) {
        case 'any': return ANY_POINTS.has(point);
        case 'own_any': return own && ANY_POINTS.has(point);
        case 'own_planning': return own && point === 'planning';
        case 'own_before_combat': return own && point === 'before_combat';
        case 'enemy_before_combat': return !own && point === 'before_combat';
        case 'own_after_roll': return own && point === 'after_roll';
        case 'enemy_after_roll': return !own && point === 'after_roll';
        case 'after_roll': return point === 'after_roll';
        case 'own_combat': return own && (point === 'before_combat' || point === 'after_roll');
        case 'own_after_combat': return own && point === 'after_combat';
        case 'own_reorganization': return own && point === 'reorganization';
        case 'enemy_before_planning': return !own && point === 'before_planning';
        case 'french_turn_start': return point === 'french_turn_start';
        case 'before_morale_test': return point === 'morale_test' && ctx.owner === side;
        case 'after_own_casualties': return point === 'casualties' && ctx.lost.some((u) => sideOf(u) === side);
        default: return false; // on_purchase, after_failed_morale_test, own_instead_of_combat: handled where they act
    }
}

const isLocked = (g, side, id) => g.players[side].locked[id] === g.turnNo;

/** Tactics `side` could play at this point. */
export function playable(g, side, point, ctx = {}) {
    return g.players[side].tactics.filter((id) => {
        const t = TACTICS[id];
        if (t.permanent || isLocked(g, side, id)) return false;
        if (!fits(t.window, point, side, g, ctx)) return false;
        return RULES[id].can ? RULES[id].can(g, side, ctx) : true;
    });
}

/**
 * A window to play tactics: first the active player, then the other; each may
 * play several before passing [§11.1].
 */
export function* tacticWindow(g, point, ctx = {}) {
    for (const side of [g.active, enemyOf(g.active)]) {
        for (;;) {
            const list = playable(g, side, point, ctx);
            if (!list.length) break;
            const opts = list.map((id) => ({ id, label: `Jugar ${TACTICS[id].name}`, ref: id, hint: TACTICS[id].text }));
            opts.push({ id: 'pass', label: 'No jugar ninguna' });
            const a = yield* choose(g, side, `Tácticas (${POINT_NAME[point]})`, opts, { kind: 'tactic', point });
            if (a === 'pass') break;
            discardTactic(g, side, a);
            log(g, `El ${SIDE_NAME[side]} juega ${TACTICS[a].name}.`, side);
            yield* RULES[a].play(g, side, ctx);
        }
    }
}

const POINT_NAME = {
    french_turn_start: 'inicio del turno francés', before_planning: 'antes de la planificación', planning: 'planificación',
    before_combat: 'antes del combate', after_roll: 'tras la tirada', after_combat: 'tras el combate',
    reorganization: 'reorganización', morale_test: 'test de moral', casualties: 'tras sufrir bajas',
};

/** Takes a tactic out of a player's zone to the market's discard pile. */
export function discardTactic(g, side, id) {
    const p = g.players[side];
    const i = p.tactics.indexOf(id);
    if (i < 0) throw new Error(`${side} has no ${id}`);
    p.tactics.splice(i, 1);
    delete p.locked[id];
    g.market.discard.push(id);
}

// ------------------------------------------------------------------ card rules (docs/01 §11.2)

const c = (g) => g.combat;
const ownAttack = (g, side) => Boolean(c(g)) && c(g).side === side;
const enemyAttack = (g, side) => Boolean(c(g)) && c(g).side !== side;
const freeDice = (g) => Boolean(c(g)) && c(g).dice.some((d) => !d.fixed);
const unitOpts = (g, ids, label = (id) => `${unitName(id)} (moral ${g.units[id].morale})`) => ids.map((id) => ({ id, label: label(id), ref: id }));
const otherUnits = (g, side, act) => Object.keys(UNITS).filter((id) => UNITS[id].side === side && id !== act.unit && inPlay(g, id));

function* chooseOpponentTactic(g, side, prompt) {
    const foe = enemyOf(side);
    return yield* choose(g, side, prompt, g.players[foe].tactics.map((id) => ({ id, label: TACTICS[id].name, ref: id })), { kind: 'enemy_tactic' });
}

/** @type {Record<string, { can?: (g: any, side: string, ctx: any) => boolean, play: (g: any, side: string, ctx: any) => Generator }>} */
export const RULES = {
    rumores_de_muerte: {
        can: (g, side) => moraleUnits(g, enemyOf(side)).length > 0,
        *play(g, side) { yield* distributeMoraleLoss(g, enemyOf(side), 3, enemyOf(side), 'Rumores de muerte'); },
    },
    calen_bayonetas: {
        can: (g, side) => ownAttack(g, side) && !artilleryCombat(c(g)),
        *play(g) { c(g).calen++; },
    },
    avanzadillas: {
        can: (g, side) => enemyAttack(g, side) && freeDice(g),
        *play(g, side) { yield* rerollOne(g, side, 'Avanzadillas'); },
    },
    arenga: {
        can: (g, side, ctx) => Boolean(ctx.test),
        *play(g, side, ctx) { ctx.test.bonus += 2; },
    },
    voluntad: {
        can: (g, side) => ownAttack(g, side) && freeDice(g),
        *play(g, side) { yield* rerollOne(g, side, 'Voluntad'); },
    },
    confianza: {
        can: (g, side) => ownAttack(g, side) && c(g).defenderMoraleLost >= 2 && canRaise(g, side).includes(c(g).attacker),
        *play(g) { raiseMorale(g, c(g).attacker, 1); },
    },
    acero_frio: {
        can: (g) => freeDice(g) && !artilleryCombat(c(g)),
        *play(g, side) { yield* modifyDie(g, side, [1, -1], 'Acero frío'); },
    },
    curtido_en_mil_batallas: {
        can: (g, side) => g.players[side].cubes > 0,
        *play(g, side) { gainCubes(g, side, g.players[side].cubes, 'Curtido en mil batallas'); },
    },
    veteranos_de_iberia: {
        can: (g, side) => ownAttack(g, side) && !c(g).veteranos && c(g).rolls <= 2,
        *play(g) { c(g).veteranos = true; },
    },
    riflemen_vs_voltigeurs: {
        can: (g, side) => ownAttack(g, side) && !g.turn.riflemen,
        *play(g) { g.turn.riflemen = true; },
    },
    reorganizacion: {
        can: (g, side) => canRaise(g, side).length > 0,
        *play(g, side) {
            const u = yield* choose(g, side, 'Reorganización: +1 de moral a', unitOpts(g, canRaise(g, side)), { kind: 'own_unit' });
            raiseMorale(g, u, 1);
        },
    },
    maniobra_sorpresa: {
        can: (g, side, ctx) => Boolean(ctx.activation) && otherUnits(g, side, ctx.activation).length > 0,
        *play(g, side, ctx) { yield* redirect(g, side, ctx.activation, 'Maniobra sorpresa'); },
    },
    fuerzas_de_flaqueza: {
        can: (g, side) => ownAttack(g, side) && inPlay(g, c(g).attacker) && hitsOn(g, c(g).attacker) >= 2,
        *play(g) { raiseMorale(g, c(g).attacker, 2); },
    },
    terreno_escarpado: {
        can: (g, side) => g.players[enemyOf(side)].cubes > 0,
        *play(g, side) {
            const foe = enemyOf(side);
            const n = g.players[foe].cubes;
            payCubes(g, foe, n);
            log(g, `El ${SIDE_NAME[foe]} pierde sus ${n} cubos de Inercia.`, 'bad');
        },
    },
    cobardes: {
        can: (g, side) => g.players[enemyOf(side)].tactics.length > 0,
        *play(g, side) {
            const foe = enemyOf(side);
            const list = g.players[foe].tactics;
            const id = list[randomInt(g, list.length)];
            discardTactic(g, foe, id);
            log(g, `El ${SIDE_NAME[foe]} pierde ${TACTICS[id].name}.`, 'bad');
        },
    },
    cambio_de_tornas: {
        can: (g, side) => g.players[enemyOf(side)].tactics.length > 0,
        *play(g, side) {
            const id = yield* chooseOpponentTactic(g, side, 'Cambio de tornas: ¿qué táctica del rival se descarta?');
            discardTactic(g, enemyOf(side), id);
            log(g, `${TACTICS[id].name} va a la pila de descartes.`, side);
        },
    },
    los_hombres_estan_agotados: { can: () => false, *play() {} }, // permanent: rerollCubeCost
    a_sangre_y_fuego: { can: () => false, *play() {} }, // an option of the order step (turn.js)
    calma_tensa: {
        can: (g, side, ctx) => Boolean(ctx.activation) && g.units[ctx.activation.unit].morale !== null && inPlay(g, ctx.activation.unit) && !ctx.activation.calm,
        *play(g, side, ctx) { ctx.activation.calm = true; },
    },
    reagrupacion: { can: () => false, *play() {} }, // morale.js trySave
    coraje_liquido: {
        can: (g, side, ctx) => Boolean(ctx.activation) && !ctx.activation.free,
        *play(g, side, ctx) { ctx.activation.free = true; },
    },
    paralizados_por_el_miedo: {
        can: (g, side) => moraleUnits(g, enemyOf(side)).some((id) => g.units[id].morale <= 5),
        *play(g, side) {
            const list = moraleUnits(g, enemyOf(side)).filter((id) => g.units[id].morale <= 5);
            const u = yield* choose(g, side, 'Paralizados por el miedo: ¿qué unidad enemiga hace un test de moral?', unitOpts(g, list), { kind: 'enemy_unit' });
            yield* moraleTest(g, u);
        },
    },
    el_curso_de_la_accion: {
        can: (g, side) => ownAttack(g, side) && c(g).sixPairs > 0 && canRaise(g, side).includes(c(g).attacker),
        *play(g) { raiseMorale(g, c(g).attacker, c(g).sixPairs); },
    },
    el_tiempo_es_esencial: {
        can: (g) => ['french', 'british'].some((s) => g.players[s].deck.length || g.players[s].discard.length),
        *play(g, side) {
            const a = yield* choose(g, side, 'El tiempo es esencial', [
                { id: 'shorten', label: 'Acortar: las 2 primeras cartas de cada mazo de Acción al descarte' },
                { id: 'lengthen', label: 'Alargar: 2 cartas de cada descarte vuelven a su mazo' },
            ], { kind: 'time' });
            for (const s of ['french', 'british']) {
                const p = g.players[s];
                if (a === 'shorten') {
                    p.discard.push(...p.deck.splice(0, 2));
                } else {
                    shuffle(g, p.discard);
                    p.deck.push(...p.discard.splice(0, 2));
                    shuffle(g, p.deck);
                }
                while (p.hand.length < 3 && p.deck.length) p.hand.push(p.deck.shift());
            }
            log(g, a === 'shorten' ? 'La batalla se acorta dos rondas.' : 'La batalla se alarga dos rondas.', side);
        },
    },
    cirujanos: {
        can: (g, side, ctx) => surgeonTargets(g, side, ctx).length > 0,
        *play(g, side, ctx) {
            const list = surgeonTargets(g, side, ctx);
            const u = yield* choose(g, side, 'Cirujanos: ¿qué unidad recupera una ficha?', unitOpts(g, list, (id) => `${unitName(id)} (${g.units[id].blocks} fichas)`), { kind: 'own_unit' });
            g.units[u].blocks++;
            g.combat.lostBlocks[u]--;
            g.players[enemyOf(side)].casualties--;
            log(g, `${unitName(u)} recupera una ficha.`, 'good');
        },
    },
    prisioneros: {
        can: (g, side) => g.players[enemyOf(side)].tactics.length > 0,
        *play(g, side) {
            const foe = enemyOf(side);
            const id = yield* chooseOpponentTactic(g, side, 'Prisioneros: ¿qué táctica del rival te quedas?');
            const p = g.players[foe];
            p.tactics.splice(p.tactics.indexOf(id), 1);
            delete p.locked[id];
            g.players[side].tactics.push(id);
            g.players[side].locked[id] = g.turnNo; // not usable this turn
            log(g, `El ${SIDE_NAME[side]} se queda ${TACTICS[id].name}.`, side);
        },
    },
    recapacitando: {
        can: (g, side) => !g.turn.bought && g.market.discard.some((id) => id !== 'recapacitando' && TACTICS[id].cost <= g.players[side].cubes),
        *play(g, side) {
            const list = g.market.discard.filter((id) => id !== 'recapacitando' && TACTICS[id].cost <= g.players[side].cubes);
            const id = yield* choose(g, side, 'Recapacitando: ¿qué táctica descartada compras?', list.map((t) => ({ id: t, label: `${TACTICS[t].name} (${TACTICS[t].cost})`, ref: t })), { kind: 'buy' });
            g.market.discard.splice(g.market.discard.indexOf(id), 1);
            buy(g, side, id, 0);
        },
    },
    concentracion: {
        can: (g, side) => ownAttack(g, side),
        *play(g) { c(g).extraDice++; },
    },
    impetu_inusitado: {
        can: (g, side) => ownAttack(g, side) && freeDice(g),
        *play(g, side) { yield* modifyDie(g, side, 'any', 'Ímpetu inusitado'); },
    },
    a_cubierto: {
        can: (g, side) => enemyAttack(g, side),
        *play(g) { c(g).extraDice--; },
    },
    vacilacion: {
        can: (g, side) => enemyAttack(g, side) && !c(g).vacilacion,
        *play(g) { c(g).vacilacion = true; },
    },
    en_el_fragor_de_la_batalla: {
        can: (g, side) => !g.turn.forcedTop && g.players[enemyOf(side)].deck.length > 0,
        *play(g) { g.turn.forcedTop = true; },
    },
    bano_de_sangre: {
        can: (g, side) => ownAttack(g, side) && c(g).switched && c(g).defenders.some((u) => inPlay(g, u)),
        *play(g, side) {
            const list = c(g).defenders.filter((u) => inPlay(g, u));
            const u = yield* choose(g, enemyOf(side), 'Baño de sangre: ¿qué defensor pierde una ficha?', unitOpts(g, list, (id) => `${unitName(id)} (${g.units[id].blocks} fichas)`), { kind: 'assign_loss' });
            removeBlocks(g, u, 1, 'Baño de sangre');
        },
    },
    brigadas_de_elite: {
        can: (g, side) => ownAttack(g, side),
        *play(g) { c(g).fixedSixes++; },
    },
    improvisacion: {
        can: (g, side) => improvisationPairs(g, side).length > 0,
        *play(g, side) {
            const givers = [...new Set(improvisationPairs(g, side).map(([a]) => a))];
            const from = yield* choose(g, side, 'Improvisación: ¿qué unidad cede moral?', unitOpts(g, givers), { kind: 'own_unit' });
            const takers = improvisationPairs(g, side).filter(([a]) => a === from).map(([, b]) => b);
            const to = yield* choose(g, side, 'Improvisación: ¿qué unidad la recibe?', unitOpts(g, takers), { kind: 'own_unit' });
            const max = Math.min(2, g.units[from].morale - 1, UNITS[to].morale.max - g.units[to].morale);
            const n = max > 1 ? Number(yield* choose(g, side, 'Improvisación: ¿cuántos puntos?', [{ id: '1', label: '1 punto' }, { id: '2', label: '2 puntos' }], { kind: 'amount' })) : 1;
            const before = g.units[from].morale;
            loseMorale(g, from, n, 'Improvisación');
            raiseMorale(g, to, n);
            yield* testAfterLoss(g, from, before);
        },
    },
    mensajeros: {
        can: (g, side, ctx) => Boolean(ctx.activation) && otherUnits(g, side, ctx.activation).length > 0,
        *play(g, side, ctx) {
            ctx.activation.noCubes = true;
            yield* redirect(g, side, ctx.activation, 'Mensajeros');
        },
    },
};

/** Maniobra sorpresa / Mensajeros: another unit is activated instead (and pays its cost). */
function* redirect(g, side, act, why) {
    const list = otherUnits(g, side, act);
    const u = yield* choose(g, side, `${why}: ¿qué unidad se activa en su lugar?`,
        list.map((id) => ({ id, label: `${unitName(id)}${availableOrders(g, id).length ? '' : ' (sin órdenes posibles)'}`, ref: id })), { kind: 'own_unit' });
    log(g, `${why}: se activa ${unitName(u)} en lugar de ${unitName(act.unit)}.`, side);
    act.unit = u;
}

const hitsOn = (g, u) => (c(g).hits[u] ? c(g).hits[u].casualties + c(g).hits[u].morale : 0);

function surgeonTargets(g, side, ctx) {
    return (ctx.lost ?? []).filter((u) => sideOf(u) === side && u !== 'artilleria' && inPlay(g, u) && g.combat.lostBlocks[u] > 0);
}

/** [giver, taker] pairs for Improvisación: the giver keeps at least 1 point. */
function improvisationPairs(g, side) {
    const units = moraleUnits(g, side);
    const out = [];
    for (const a of units) {
        if (g.units[a].morale < 2) continue;
        for (const b of units) if (a !== b && g.units[b].morale < UNITS[b].morale.max) out.push([a, b]);
    }
    return out;
}

// ------------------------------------------------------------------ market (§11, D-30)

/** Buys a tactic: pays its cost, takes the cubes on it [§11]. */
function buy(g, side, id, cubesOnCard) {
    payCubes(g, side, TACTICS[id].cost);
    g.players[side].cubes += cubesOnCard;
    g.players[side].tactics.push(id);
    g.turn.bought = true;
    if (id === 'terreno_escarpado') g.players[side].locked[id] = g.turnNo;
    log(g, `El ${SIDE_NAME[side]} compra ${TACTICS[id].name} por ${TACTICS[id].cost}${cubesOnCard ? ` y se lleva los ${cubesOnCard} cubos que tenía encima` : ''}.`, side);
}

/** Market step of the Reorganization [§5.3, §11]. */
export function* market(g, side) {
    const m = g.market;
    const p = g.players[side];
    const foe = enemyOf(side);
    for (;;) {
        const opts = [];
        if (!g.turn.bought) {
            m.row.forEach((slot, i) => {
                const t = TACTICS[slot.id];
                if (t.cost <= p.cubes) opts.push({ id: `buy:${i}`, label: `Comprar ${t.name} (${t.cost}${slot.cubes ? `, con ${slot.cubes} cubos encima` : ''})`, ref: slot.id });
            });
        }
        if (p.tactics.length >= 3) opts.push({ id: 'discard3', label: `Descartar 3 tácticas por ${g.rules.discardThreeTactics} cubos` });
        if (!opts.length) break;
        opts.push({ id: 'none', label: g.turn.bought ? 'Seguir' : 'No comprar' });
        const a = yield* choose(g, side, 'Mercado de Táctica', opts, { kind: 'market' });
        if (a === 'none') break;
        if (a === 'discard3') {
            const ids = yield* pick(g, side, '¿Qué 3 tácticas descartas?', p.tactics.map((id, i) => ({ id: `${i}`, label: TACTICS[id].name, ref: id })), 3, 3, { kind: 'discard3' });
            for (const id of ids.map((i) => p.tactics[Number(i)])) discardTactic(g, side, id);
            gainCubes(g, side, g.rules.discardThreeTactics, 'descarte de 3 tácticas');
            continue;
        }
        const i = Number(a.split(':')[1]);
        const [slot] = m.row.splice(i, 1);
        buy(g, side, slot.id, slot.cubes);
    }

    if (!g.turn.bought && m.row.length === 3) {
        const right = m.row[2];
        let saved = false;
        if (yield* confirm(g, foe, `¿Evitar que se descarte ${TACTICS[right.id].name}? (pones 1 cubo de la reserva común sobre cada una de las otras cartas)`, 'Evitarlo', 'No', { kind: 'prevent' })) {
            for (const slot of m.row.slice(0, 2)) slot.cubes += cubesFromSupply(g, 1);
            log(g, `El ${SIDE_NAME[foe]} evita el descarte de ${TACTICS[right.id].name}.`, foe);
            saved = true;
        } else if (p.cubes >= 1 && (yield* confirm(g, side, `¿Pagar 1 cubo para evitar que se descarte ${TACTICS[right.id].name}?`, 'Pagar 1 cubo', 'No', { kind: 'prevent' }))) {
            payCubes(g, side, 1);
            log(g, `El ${SIDE_NAME[side]} paga 1 cubo para evitar el descarte de ${TACTICS[right.id].name}.`, side);
            saved = true;
        }
        if (!saved) {
            m.row.pop();
            cubesToSupply(g, right.cubes);
            m.discard.push(right.id);
            log(g, `${TACTICS[right.id].name} sale del Mercado.`);
        }
    }
    refillMarket(g);
}

/** Shifts the row right and fills it from the left; reshuffles the discard when the deck runs out. */
export function refillMarket(g) {
    const m = g.market;
    while (m.row.length < 3) {
        if (!m.deck.length) {
            if (!m.discard.length) break;
            m.deck = shuffle(g, m.discard.splice(0));
        }
        m.row.unshift({ id: m.deck.shift(), cubes: 0 });
    }
}
