// A simple greedy player for either side: attacks whenever it can, rerolls bad
// dice while it can pay with cubes, buys the dearest tactic it can afford and
// plays tactics as soon as it may. Not a good player; it exists so simulations
// look like real games (M4 will need better ones). Ties are broken with its own RNG.

import { seedFrom, randomInt } from '../engine/rng.js';
import { ACTIONS, TACTICS, UNITS } from '../engine/data.js';
import { availableOrders, moorePositionFor } from '../engine/state.js';
import { results } from '../engine/combat.js';

const score = (r) => 3 * r.defenderCasualties + 2 * r.defenderMorale - 3 * r.attackerCasualties - 2 * r.attackerMorale + 0.5 * r.cubes;

export function createGreedyBot(seed = 'greedy', state = () => null, { soultChance = 0.2 } = {}) {
    const r = { rng: seedFrom(seed) };
    const any = (list) => list[randomInt(r, list.length)];
    const best = (opts, f) => {
        let top = -Infinity;
        let out = [];
        for (const o of opts) {
            const v = f(o);
            if (v > top) {
                top = v;
                out = [o];
            } else if (v === top) out.push(o);
        }
        return any(out).id;
    };

    return function answer(req) {
        const g = state();
        const opts = req.options;
        const ids = opts.map((o) => o.id);
        const c = g?.combat;
        const unit = (id) => g.units[id];
        const strength = (id) => (unit(id)?.morale ?? 0) + 2 * (unit(id)?.blocks ?? 0);

        if (req.type === 'pick') {
            if (req.kind === 'opening') {
                return [...opts].sort((a, b) => ACTIONS[b.ref].cubes - ACTIONS[a.ref].cubes).slice(0, req.min).map((o) => o.id);
            }
            if (req.kind === 'reroll_dice') {
                const dice = c.dice;
                const count = [0, 0, 0, 0, 0, 0, 0];
                for (const d of dice) count[d.v]++;
                const bad = opts.filter((o) => {
                    const v = dice[Number(o.id)].v;
                    return v <= 2 || count[v] < 2;
                });
                return (bad.length ? bad : opts.slice(0, 1)).map((o) => o.id);
            }
            return ids.slice(0, req.min);
        }

        switch (req.kind) {
            case 'play': {
                if (ids.includes('soult') && randomInt(r, 1000) < soultChance * 1000) return 'soult';
                const cards = opts.filter((o) => o.id !== 'soult');
                return best(cards, (o) => {
                    const u = ACTIONS[o.id].unit;
                    const attacks = availableOrders(g, u).filter((x) => x.order.act === 'attack').length;
                    return (attacks ? 10 : 0) + ACTIONS[o.id].cubes;
                });
            }
            case 'tactic':
                return ids.find((id) => id !== 'pass') ?? 'pass';
            case 'moore_move': {
                const want = req.ref && moorePositionFor(req.ref);
                if (want && g.moore.track <= 5 && ids.includes(String(want))) return String(want);
                return 'stay';
            }
            case 'cost': {
                const st = unit(req.ref);
                if (ids.includes('morale') && st.morale > 6) return 'morale';
                if (ids.includes('block') && st.blocks > 1) return 'block';
                return ids[0];
            }
            case 'order':
                return best(opts, (o) => {
                    if (o.id.startsWith('blood:')) return 100;
                    const target = o.ref;
                    if (target === 'elvina' || target === 'palavea') return 50;
                    if (UNITS[target]) return 40 - strength(target);
                    return 0; // reinforce, move
                });
            case 'moore_support':
                return 'die';
            case 'soult_dice':
                return ids[ids.length - 1];
            case 'roll': {
                const now = results(c.dice, c.attacker === 'artilleria');
                for (const k of ['bayonet', 'calen']) if (ids.includes(k) && improves(c, now)) return k;
                const bad = now.attackerCasualties || now.attackerMorale || score(now) <= 0;
                const p = g.players[c.side];
                const cheap = c.mooreReroll || (c.veteranos && c.rolls === 2) || g.turn.riflemen || p.cubes >= 3;
                return ids.includes('reroll') && bad && cheap && c.rerolls < 3 ? 'reroll' : 'apply';
            }
            case 'reroll_pay': {
                for (const id of ['moore', 'veteranos', 'riflemen', 'cubes']) if (ids.includes(id)) return id;
                const st = unit(c.attacker);
                if (ids.includes('morale') && st.morale > 6) return 'morale';
                if (ids.includes('block') && st.blocks > 2) return 'block';
                return ids.includes('morale') ? 'morale' : ids[0];
            }
            case 'die_mod': {
                const mine = req.side === c.side;
                return best(opts, (o) => {
                    const [i, f] = o.id.split(':').map(Number);
                    const dice = c.dice.map((d, k) => ({ v: k === i ? f : d.v }));
                    const v = score(results(dice, c.attacker === 'artilleria'));
                    return mine ? v : -v;
                });
            }
            case 'die_pick': {
                // own reroll: the loneliest die; the enemy's: a die in its best pair
                const mine = req.side === c.side;
                const count = [0, 0, 0, 0, 0, 0, 0];
                for (const d of c.dice) count[d.v]++;
                return best(opts, (o) => {
                    const v = c.dice[Number(o.id)].v;
                    const paired = count[v] >= 2 && v >= 4;
                    return mine ? (v <= 2 ? 2 : paired ? -1 : 1) : (paired ? v : 0);
                });
            }
            case 'assign_loss':
            case 'assign_morale':
                return best(opts, (o) => strength(o.id));
            case 'save':
                for (const id of ['reagrupacion', 'moore', 'soult']) if (ids.includes(id)) return id;
                return 'none';
            case 'market': {
                const buys = opts.filter((o) => o.id.startsWith('buy:'));
                if (buys.length) return best(buys, (o) => TACTICS[o.ref].cost);
                return ids.includes('none') ? 'none' : ids[0];
            }
            case 'buy':
                return best(opts, (o) => TACTICS[o.ref].cost);
            case 'prevent':
                return 'no';
            case 'draw':
                return 'top';
            case 'soult_back':
                return best(opts, (o) => ACTIONS[o.id].cubes);
            case 'own_unit':
                if (req.prompt.includes('cede')) return best(opts, (o) => unit(o.id).morale);
                if (req.prompt.includes('en su lugar')) return best(opts, (o) => (o.label.includes('sin órdenes') ? 0 : 1));
                return best(opts, (o) => -(unit(o.id).morale ?? 0) - (unit(o.id).blocks ?? 0));
            case 'enemy_unit':
                return best(opts, (o) => -unit(o.id).morale);
            case 'time':
                return req.side === 'british' ? 'shorten' : 'lengthen';
            case 'amount':
                return ids[ids.length - 1];
            case 'reinforce_to':
                return best(opts, (o) => -unit(o.id).blocks);
            default:
                if (ids.includes('yes')) return 'yes';
                return any(ids);
        }
    };
}

/** Would some ±1 on one die improve the roll? */
function improves(c, now) {
    const base = score(now);
    return c.dice.some((d, i) => !d.fixed && [-1, 1].some((x) => {
        const f = d.v + x;
        if (f < 1 || f > 6) return false;
        const dice = c.dice.map((e, k) => ({ v: k === i ? f : e.v }));
        return score(results(dice, c.attacker === 'artilleria')) > base;
    }));
}
