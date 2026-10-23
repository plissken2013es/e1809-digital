// A player's turn: planning, combat (the order), reorganization [docs/01 §5],
// the Inertia streak [§9] and Soult's double activation [§8.2].

import { choose, log, beat } from './ask.js';
import { shuffle } from './rng.js';
import { ACTIONS, UNITS, LOCATIONS } from './data.js';
import {
    inPlay, availableOrders, freeSlots, gainCubes, payCubes, removeBlocks, eliminate, raiseMorale, unitName, SIDE_NAME,
} from './state.js';
import { loseMorale, testAfterLoss } from './morale.js';
import { mooreMove, mooreDies } from './commanders.js';
import { attack } from './combat.js';
import { tacticWindow, market, discardTactic } from './tactics.js';

export const cardLabel = (id) => {
    const a = ACTIONS[id];
    return `${unitName(a.unit)} · ${a.cubes} cubo${a.cubes > 1 ? 's' : ''}${a.horse ? ' · caballo' : ''}`;
};

/** One turn of `side` [§5]. */
export function* playTurn(g, side) {
    g.turnNo++;
    if (side === 'french') g.roundNo++;
    g.active = side;
    g.turn = { side, no: g.turnNo, bought: false, riflemen: false, soultDice: 0, forcedTop: false };
    log(g, `Ronda ${g.roundNo} · turno ${side === 'french' ? 'francés' : 'británico'}`, 'phase');
    yield* beat(g, 'turn', { side });

    if (side === 'french') yield* tacticWindow(g, 'french_turn_start');
    yield* tacticWindow(g, 'before_planning');

    const p = g.players[side];
    if (g.turn.forcedTop && p.deck.length) {
        const card = p.deck.shift();
        log(g, `En el fragor de la batalla: el ${SIDE_NAME[side]} activa la carta de arriba de su mazo.`, side);
        yield* activation(g, side, card);
    } else if (!p.hand.length) {
        log(g, `El ${SIDE_NAME[side]} no tiene cartas de Acción: pasa el turno.`, side);
    } else {
        const opts = p.hand.map((id) => ({ id, label: cardLabel(id), ref: id }));
        if (side === 'french' && !g.soult.used && p.hand.length >= 2) opts.push({ id: 'soult', label: 'Soult: activar dos unidades (único uso)' });
        const a = yield* choose(g, side, 'Planificación: juega una carta de Acción', opts, { kind: 'play' });
        if (a === 'soult') {
            yield* soultDouble(g);
        } else {
            p.hand.splice(p.hand.indexOf(a), 1);
            yield* activation(g, side, a);
        }
    }

    yield* reorganization(g, side);
    // Moore felled by a British action leaves at the end of the British turn: this one,
    // or the next one if he fell rallying during the French turn [D-7, D-46]
    if (g.moore.status === 'dying' && side === 'british') yield* mooreDies(g, 'herido en combate');
}

/** Adds a played card to the streak; 3 in a row with the same cubes give +2 [§9, D-23]. */
function streak(g, side, cubes, bonus) {
    const s = g.players[side].streak;
    s.push(cubes);
    if (s.length > 3) s.shift();
    if (bonus && s.length === 3 && s.every((x) => x === cubes)) gainCubes(g, side, 2, 'racha de Inercia');
}

/**
 * Plays an Action card: cubes, Moore's move, activation cost and order [§5.1–5.2].
 * With Soult the card gives no cubes and the caller decides where it goes.
 */
export function* activation(g, side, cardId, { soult = false } = {}) {
    const card = ACTIONS[cardId];
    const p = g.players[side];
    if (!soult) p.discard.push(cardId);
    log(g, `El ${SIDE_NAME[side]} juega ${cardLabel(cardId)}.`, side);
    yield* beat(g, 'card', { card: cardId });

    const act = { card: cardId, unit: card.unit, noCubes: soult, calm: false, free: false };
    yield* tacticWindow(g, 'planning', { activation: act });
    if (!act.noCubes) {
        gainCubes(g, side, card.cubes, 'carta de Acción');
        streak(g, side, card.cubes, true);
    } else if (!soult) {
        streak(g, side, card.cubes, false);
    }
    if (side === 'british') yield* mooreMove(g, card.horse, act.unit);

    const unitId = act.unit;
    if (!inPlay(g, unitId)) {
        log(g, `${unitName(unitId)} ya no está en el campo.`);
        return;
    }
    if (!availableOrders(g, unitId).length) {
        log(g, `${unitName(unitId)} no tiene objetivos disponibles.`);
        gainCubes(g, side, 2, 'sin objetivos'); // [§5.4]
        return;
    }
    if (act.calm) {
        log(g, `Calma tensa: ${unitName(unitId)} se recompone y no hace nada.`, side);
        raiseMorale(g, unitId, 1);
        return;
    }

    yield* payActivation(g, side, unitId, act.free);
    if (!inPlay(g, unitId)) return;
    const orders = availableOrders(g, unitId);
    if (!orders.length) return;

    const opts = orders.map((o, k) => ({ id: String(k), label: orderLabel(o), ref: o.target }));
    if (p.tactics.includes('a_sangre_y_fuego') && p.locked.a_sangre_y_fuego !== g.turnNo) {
        for (const o of orders) {
            if (o.order.act === 'attack' && LOCATIONS[o.target]) opts.push({ id: `blood:${o.target}`, label: `A sangre y fuego: tomar ${LOCATIONS[o.target].name} sin combate`, ref: o.target });
        }
    }
    const a = yield* choose(g, side, `Órdenes de ${unitName(unitId)}`, opts, { kind: 'order', ref: unitId });
    if (a.startsWith('blood:')) {
        const loc = a.split(':')[1];
        discardTactic(g, side, 'a_sangre_y_fuego');
        g.locations[loc] = side;
        log(g, `A sangre y fuego: ${LOCATIONS[loc].name} pasa a manos del ${SIDE_NAME[side]}.`, side);
        return;
    }
    const o = orders[Number(a)];
    if (o.order.act === 'move') {
        g.units.paget.pos = o.order.to;
        log(g, `Paget avanza a su posición #${o.order.to}.`, side);
    } else if (o.order.act === 'reinforce') {
        yield* reinforce(g, side, unitId, o);
    } else {
        yield* attack(g, unitId, o.order, o.target);
    }
}

export const orderLabel = (o) => (o.order.act === 'reinforce' && o.order.split ? o.order.text : o.order.targets?.length > 1 ? `${o.order.text} → ${unitName(o.target)}` : o.order.text);

/** −1 morale or 1 block; the test of Combat step 1 [§5.1–5.2, D-17]. */
function* payActivation(g, side, unitId, free) {
    const st = g.units[unitId];
    if (free) {
        log(g, `${unitName(unitId)} no paga el coste de activación.`, side);
        return;
    }
    if (st.morale === null && g.rules.reserveActivation === 'free') return;
    const opts = [];
    if (st.morale !== null) opts.push({ id: 'morale', label: `−1 de moral (${st.morale} → ${st.morale - 1})` });
    if (st.blocks > 0) opts.push({ id: 'block', label: `Retirar 1 ficha (${st.blocks} → ${st.blocks - 1})` });
    if (!opts.length) return;
    const a = yield* choose(g, side, `Coste de activación de ${unitName(unitId)}`, opts, { kind: 'cost', ref: unitId });
    if (a === 'block') {
        removeBlocks(g, unitId, 1, 'activación');
        return;
    }
    const before = st.morale;
    loseMorale(g, unitId, 1, 'activación');
    yield* testAfterLoss(g, unitId, before);
}

/** Moves 1–2 blocks into the empty slots of the target(s); a unit left empty is destroyed [§10, D-19]. */
function* reinforce(g, side, unitId, o) {
    const st = g.units[unitId];
    const room = o.order.split ? o.order.targets.reduce((n, t) => n + freeSlots(g, t), 0) : freeSlots(g, o.target);
    const max = Math.min(2, st.blocks, room);
    const n = max > 1 ? Number(yield* choose(g, side, `¿Cuántas fichas mueve ${unitName(unitId)}?`, [{ id: '1', label: '1 ficha' }, { id: '2', label: '2 fichas' }], { kind: 'amount' })) : 1;
    for (let i = 0; i < n; i++) {
        let to = o.target;
        if (o.order.split) {
            const list = o.order.targets.filter((t) => freeSlots(g, t) > 0);
            to = yield* choose(g, side, `¿A qué unidad va la ficha ${i + 1}?`, list.map((t) => ({ id: t, label: `${unitName(t)} (${g.units[t].blocks}/${UNITS[t].blocks} fichas)`, ref: t })), { kind: 'reinforce_to' });
        }
        st.blocks--;
        g.units[to].blocks++;
        log(g, `${unitName(unitId)} refuerza a ${unitName(to)} con una ficha.`, side);
    }
    if (st.blocks === 0 && UNITS[unitId].type !== 'reserve') eliminate(g, unitId, 'destroyed');
}

/** Soult's double activation [§8.2, D-23, D-28]. */
function* soultDouble(g) {
    const p = g.players.french;
    g.soult.used = true;
    log(g, 'Soult toma el mando: dos unidades se activan este turno.', 'french');
    gainCubes(g, 'french', 5, 'Soult');
    g.turn.soultDice = 2;
    const played = p.limbo; // the two cards wait here until one goes back to the hand
    for (const n of ['primera', 'segunda']) {
        if (!p.hand.length) break;
        const a = yield* choose(g, 'french', `Soult: ${n} carta de Acción`, p.hand.map((id) => ({ id, label: cardLabel(id), ref: id })), { kind: 'play' });
        p.hand.splice(p.hand.indexOf(a), 1);
        played.push(a);
        yield* activation(g, 'french', a, { soult: true });
    }
    g.turn.soultDice = 0;
    const back = yield* choose(g, 'french', 'Soult: ¿qué carta vuelve a la mano?', played.map((id) => ({ id, label: cardLabel(id), ref: id })), { kind: 'soult_back' });
    const rest = played.splice(0);
    p.hand.push(back);
    rest.splice(rest.indexOf(back), 1);
    for (const id of rest) {
        p.discard.push(id);
        streak(g, 'french', ACTIONS[id].cubes, false);
    }
}

/** Market and drawing back to 3 cards; 5 cubes let you choose the card [§5.3, D-25]. */
function* reorganization(g, side) {
    yield* tacticWindow(g, 'reorganization');
    yield* market(g, side);
    const p = g.players[side];
    while (p.hand.length < 3 && p.deck.length) {
        let card = p.deck[0];
        let chosen = false;
        if (p.cubes >= 5 && p.deck.length > 1) {
            const kinds = [...new Set(p.deck)].sort();
            const a = yield* choose(g, side, 'Robar carta de Acción', [
                { id: 'top', label: 'Robar la de arriba' },
                ...kinds.map((id) => ({ id, label: `Elegir ${cardLabel(id)} (5 cubos)`, ref: id })),
            ], { kind: 'draw' });
            if (a !== 'top') {
                payCubes(g, side, 5);
                card = a;
                chosen = true;
                log(g, `El ${SIDE_NAME[side]} paga 5 cubos para elegir la carta que roba.`, side);
            }
        }
        p.deck.splice(p.deck.indexOf(card), 1);
        p.hand.push(card);
        if (chosen) shuffle(g, p.deck);
    }
}
