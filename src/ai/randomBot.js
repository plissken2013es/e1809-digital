// Random legal answers, with its own RNG (it never touches the game's). Used by
// the simulation tests. A few biases keep games sensible: it applies most rolls
// instead of rerolling forever, and prefers free reroll payments.

import { seedFrom, randomInt } from '../engine/rng.js';

export function createRandomBot(seed = 'bot', { applyBias = 0.6, tacticBias = 0.5 } = {}) {
    const r = { rng: seedFrom(seed) };
    const chance = (p) => randomInt(r, 1000) < p * 1000;
    const any = (list) => list[randomInt(r, list.length)];
    return function answer(request) {
        const opts = request.options;
        const ids = opts.map((o) => o.id);
        if (request.type === 'pick') {
            const n = request.min + randomInt(r, request.max - request.min + 1);
            const pool = [...ids];
            const out = [];
            while (out.length < n) out.push(pool.splice(randomInt(r, pool.length), 1)[0]);
            return out;
        }
        if (request.kind === 'roll' && chance(applyBias)) return 'apply';
        if (request.kind === 'tactic') return chance(tacticBias) ? any(ids.filter((id) => id !== 'pass')) : 'pass';
        if (request.kind === 'reroll_pay') {
            const free = ids.filter((id) => id === 'moore' || id === 'veteranos' || id === 'riflemen');
            if (free.length) return free[0];
        }
        return any(ids);
    };
}
