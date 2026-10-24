// Live games between bots over a fake channel (src/ui/live.js LiveSync): two
// copies, each answering only its own decisions and sending them numbered, with
// messages arriving late and connections dropping (messages lost) and coming
// back (both say how far they are). Both copies must end as the same game.
// LIVE_GAMES=200 npm test for a longer run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, fingerprint } from '../src/engine/index.js';
import { createGreedyBot } from '../src/ai/greedyBot.js';
import { createRandomBot } from '../src/ai/randomBot.js';
import { LiveSync } from '../src/ui/live.js';
import { isPrefix } from '../src/ui/mail.js';
import { seedFrom, nextRandom } from '../src/engine/rng.js';

const GAMES = Number(process.env.LIVE_GAMES ?? 20);

function peer(side, setup, makeBot, inviter, outbox) {
    const p = { side, session: new Session(setup), out: outbox };
    p.bot = makeBot(p);
    p.sync = new LiveSync({
        inviter,
        answers: () => p.session.answers,
        adopt(list) {
            if (!isPrefix(p.session.answers, list)) p.session = new Session(setup, []);
            for (const a of list.slice(p.session.answers.length)) p.session.act(a);
        },
        send: (msg) => p.online && p.out.push(structuredClone(msg)),
    });
    return p;
}

/** One game: random steps (someone plays, a message arrives, the line drops or comes back). */
function live(i, kind) {
    const setup = { seed: `live-${kind}-${i}`, match: `v${i}` };
    const gen = { rng: seedFrom(`live-steps-${i}`) };
    const random = () => nextRandom(gen);
    const pick = (n) => Math.floor(random() * n);
    const make = (side) => (p) => (kind === 'greedy' ? createGreedyBot(`${i}-${side}`, () => p.session.state) : createRandomBot(`${i}-${side}`));
    const toBritish = [];
    const toFrench = [];
    const fr = peer('french', setup, make('french'), true, toBritish);
    const gb = peer('british', setup, make('british'), false, toFrench);
    const peers = [fr, gb];
    const inbox = (p) => (p === fr ? toFrench : toBritish);
    const connect = () => {
        for (const p of peers) p.online = true;
        for (const p of peers) p.sync.hello();
    };
    connect();
    let drops = 0;
    for (let step = 0; step < 200000; step++) {
        const s = fr.session;
        if (s.over && gb.session.over && !toFrench.length && !toBritish.length) {
            assert.equal(fingerprint(gb.session.state), fingerprint(s.state), 'the two copies end differently');
            assert.deepEqual(gb.session.answers, s.answers);
            return { answers: s.answers.length, drops, winner: s.state.result.winner };
        }
        const r = random();
        if (r < 0.004 && fr.online) {
            // the line drops: what is on its way is lost
            for (const p of peers) p.online = false;
            toFrench.length = 0;
            toBritish.length = 0;
            drops++;
        } else if (r < 0.05 && !fr.online) {
            connect();
        } else if (r < 0.55) {
            const p = peers[pick(2)];
            const msg = inbox(p).shift(); // in order, like the data channel
            if (msg && p.online) p.sync.message(msg);
        } else {
            const p = peers[pick(2)];
            const q = p.session.state.pending;
            if (!q || p.session.over || q.side !== p.side) continue;
            const a = p.bot(q);
            const n = p.session.answers.length;
            p.session.act(a);
            p.sync.local(n, a);
        }
    }
    throw new Error(`game ${i} did not end`);
}

for (const kind of ['greedy', 'random']) {
    test(`live games between ${kind} bots over a channel that drops: both copies end the same`, () => {
        let drops = 0;
        let answers = 0;
        for (let i = 0; i < GAMES; i++) {
            const r = live(i, kind);
            drops += r.drops;
            answers += r.answers;
        }
        console.log(`live ${kind}: ${GAMES} games · ${(answers / GAMES).toFixed(0)} answers · ${(drops / GAMES).toFixed(1)} drops per game`);
    });
}

test('LiveSync: the one behind catches up, a clash goes to the inviter', () => {
    const sent = [];
    let ours = ['a', 'b'];
    const sync = new LiveSync({ inviter: false, answers: () => ours, adopt: (list) => (ours = list), send: (m) => sent.push(m) });
    sync.message({ t: 'answer', n: 2, a: 'c' });
    assert.deepEqual(ours, ['a', 'b', 'c']);
    sync.message({ t: 'answer', n: 5, a: 'f' });
    assert.equal(sent.at(-1).t, 'hello', 'a gap: say how far we are');
    sync.message({ t: 'hello', answers: ['a'] });
    assert.deepEqual(sent.at(-1), { t: 'hello', answers: ['a', 'b', 'c'] }, 'they are behind: they get ours');
    sync.message({ t: 'hello', answers: ['a', 'x', 'y', 'z'] });
    assert.deepEqual(ours, ['a', 'x', 'y', 'z'], 'not the inviter: a clash takes theirs');
    const host = new LiveSync({ inviter: true, answers: () => ['a', 'b'], adopt: () => assert.fail('the inviter keeps its copy'), send: (m) => sent.push(m) });
    host.message({ t: 'hello', answers: ['a', 'x'] });
    assert.deepEqual(sent.at(-1), { t: 'hello', answers: ['a', 'b'] });
});
