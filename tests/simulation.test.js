// Plays whole games with bots across the rules options, checking after each
// answer that no card or cube is created or lost (helpers.js checkInvariants).
// SIM_GAMES=2000 npm test for a longer run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/engine/index.js';
import { createRandomBot } from '../src/ai/randomBot.js';
import { createGreedyBot } from '../src/ai/greedyBot.js';
import { playOut, bySide } from './helpers.js';

const GAMES = Number(process.env.SIM_GAMES ?? 300);

const OPTIONS = [
    {},
    { bayonet: 'none', mooreRally: 'card' },
    { mooreUnderFire: 'influence', reserveActivation: 'block' },
    { moraleTests: 'point', minDice: 0 },
    { inertiaSupply: 'unlimited', discardThreeTactics: 2 },
];

function run(name, makeBots) {
    const wins = { french: 0, british: 0 };
    let turns = 0;
    let evacuations = 0;
    for (let i = 0; i < GAMES; i++) {
        const setup = { seed: `${name}-${i}`, rules: OPTIONS[i % OPTIONS.length] };
        const s = new Session(setup);
        try {
            playOut(s, makeBots(i, s));
        } catch (err) {
            err.message = `game ${i} (${JSON.stringify(setup)}) after ${s.answers.length} answers: ${err.message}`;
            throw err;
        }
        assert.ok(s.state.result, `game ${i} did not finish`);
        wins[s.state.result.winner]++;
        turns += s.state.turnNo;
        if (s.state.result.reason.includes('embarcan')) evacuations++;
    }
    console.log(`${name}: ${JSON.stringify(wins)}, ${evacuations} by evacuation, ${(turns / GAMES).toFixed(1)} turns on average`);
}

test(`${GAMES} random games end cleanly`, () => {
    run('random', (i) => createRandomBot(`bot-${i}`));
});

test(`${GAMES} greedy games end cleanly`, () => {
    run('greedy', (i, s) => createGreedyBot(`g-${i}`, () => s.state));
});

test(`${GAMES} greedy vs random games end cleanly`, () => {
    run('mixed', (i, s) => {
        const greedy = createGreedyBot(`m-${i}`, () => s.state);
        const random = createRandomBot(`mr-${i}`);
        return bySide(i % 2 ? { french: greedy, british: random } : { french: random, british: greedy });
    });
});

test('a game replays identically from its answers', () => {
    const s = new Session({ seed: 'replay' });
    playOut(s, createRandomBot('r'));
    const again = new Session(s.setup, s.answers);
    assert.deepEqual(again.state, s.state);
});

test('undo rebuilds the previous state', () => {
    const s = new Session({ seed: 'undo' });
    const bot = createRandomBot('u');
    for (let i = 0; i < 40 && !s.over; i++) s.act(bot(s.pending));
    const before = structuredClone(s.state);
    s.act(bot(s.pending));
    s.undo();
    assert.deepEqual(s.state, before);
});
