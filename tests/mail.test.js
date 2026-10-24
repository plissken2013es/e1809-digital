// Correspondence games between bots: two players with a copy each, who only send
// each other the E18. code (what the link carries), as src/ui/mail.js says. Each
// plays its side; the rival's tactic windows with nothing to play pass by themselves;
// when the rival has to decide, the game travels. Both copies must end identical.
// MAIL_GAMES=200 npm test for a longer run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, encodeRecord, decodeRecord, makeRecord, fingerprint, enemyOf } from '../src/engine/index.js';
import { createGreedyBot } from '../src/ai/greedyBot.js';
import { createRandomBot } from '../src/ai/randomBot.js';
import { emptyWindow, receive } from '../src/ui/mail.js';

const GAMES = Number(process.env.MAIL_GAMES ?? 20);

/** One player's browser: its side, its copy of the game and its bot. */
function player(side, makeBot) {
    return { side, makeBot, answers: null };
}

/** Plays from this copy until the rival has to decide (or the game ends). @returns the session */
function playTurn(setup, me) {
    const s = new Session(setup, me.answers ?? []);
    const bot = me.makeBot(s);
    for (let n = 0; s.state.pending && !s.over && n < 10000; n++) {
        const p = s.state.pending;
        if (p.side === me.side) s.act(bot(p));
        else if (emptyWindow(p)) s.act('pass');
        else break;
    }
    me.answers = [...s.answers];
    return s;
}

async function correspondence(setup, makeBot) {
    // the French create the game (as the setup screen does) and the British receive its first link
    const players = { french: player('french', makeBot('french')), british: player('british', makeBot('british')) };
    let holder = players.french;
    let messages = 0;
    const kinds = {}; // what the rival had to decide, each time the game travelled
    for (;;) {
        const s = playTurn(setup, holder);
        const code = await encodeRecord(makeRecord(s, 'test'));
        const other = players[enemyOf(holder.side)];
        const record = await decodeRecord(code);
        const got = receive(other.answers, record.answers);
        assert.equal(got.stale, false, `message ${messages}: the link brings nothing new`);
        assert.equal(got.diverged, false, `message ${messages}: the copies parted`);
        other.answers = got.answers;
        messages++;
        if (s.over) {
            // the last link shows the end to the rival: both copies are the same game
            const theirs = new Session(setup, other.answers);
            assert.equal(fingerprint(theirs.state), fingerprint(s.state));
            assert.ok(theirs.state.result);
            return { messages, answers: s.answers.length, turns: s.state.turnNo, winner: s.state.result.winner, code: code.length, kinds };
        }
        kinds[s.state.pending.kind] = (kinds[s.state.pending.kind] ?? 0) + 1;
        assert.notEqual(s.state.pending.side, holder.side, 'a link was sent while it was still our turn');
        holder = other;
    }
}

test('receive: new, continued, old and parted links', () => {
    assert.deepEqual(receive(null, ['a', 'b']), { stale: false, answers: ['a', 'b'], from: 0, diverged: false });
    assert.deepEqual(receive(['a'], ['a', 'b', 'c']), { stale: false, answers: ['a', 'b', 'c'], from: 1, diverged: false });
    assert.equal(receive(['a', 'b', 'c'], ['a', 'b']).stale, true, 'an old link does not take the game back');
    assert.deepEqual(receive(['a', 'x'], ['a', 'b', 'c']), { stale: false, answers: ['a', 'b', 'c'], from: 0, diverged: true });
});

for (const [name, kind] of [['greedy', createGreedyBot], ['random', createRandomBot]]) {
    test(`correspondence games between ${name} bots: both copies end the same`, async () => {
        const stats = [];
        for (let i = 0; i < GAMES; i++) {
            const setup = { seed: `mail-${name}-${i}`, match: `m${i}` };
            const makeBot = (side) => (s) => (kind === createGreedyBot ? createGreedyBot(`${i}-${side}-${s.answers.length}`, () => s.state) : createRandomBot(`${i}-${side}-${s.answers.length}`));
            stats.push(await correspondence(setup, makeBot));
        }
        const avg = (k) => (stats.reduce((n, x) => n + x[k], 0) / stats.length).toFixed(1);
        const max = (k) => Math.max(...stats.map((x) => x[k]));
        const wins = stats.reduce((w, x) => ({ ...w, [x.winner]: (w[x.winner] ?? 0) + 1 }), {});
        const kinds = {};
        for (const x of stats) for (const [k, n] of Object.entries(x.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
        const why = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${(n / GAMES).toFixed(1)}`).join(', ');
        console.log(`correspondence ${name}: ${GAMES} games ${JSON.stringify(wins)} · ${avg('turns')} turns · ${avg('messages')} links per game (max ${max('messages')}) · ${(avg('messages') / avg('turns')).toFixed(1)} per turn · last link ${avg('code')} chars (max ${max('code')}) · links per game by what the rival decides: ${why}`);
    });
}
