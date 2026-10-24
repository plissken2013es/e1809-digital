// Correspondence games between bots THROUGH THE INTERFACE: run in the browser, on
// the game page opened with ?debug (the view is window.e18), from the console:
//
//     const t = await import('./tests/browser/mail-ui.js'); t.start({ games: 2 }); // then: t.progress()
//
// Two players share the page: before opening each other's link, the saved
// correspondence games (localStorage e18-mail) are swapped, as if they were two
// browsers. A greedy bot answers for whoever holds the game; each link is opened
// the real way (the #E18. code in the address, which app.js follows). On every
// link it checks: the side kept, the answers and state received intact, undo
// locked, the replay ending (nothing stuck) and one combat scene per combat in it.
// The page has to be on screen: hidden, the 3D dice and the scenes do not move.

import { encodeRecord, makeRecord, fingerprint, enemyOf } from '../../src/engine/index.js';
import { createGreedyBot } from '../../src/ai/greedyBot.js';

const MAIL_KEY = 'e18-mail';
const state = { running: false, log: [], games: [], errors: [], link: null };
const say = (text) => state.log.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(test, ms, what) {
    const t0 = performance.now();
    while (!test()) {
        if (performance.now() - t0 > ms) throw new Error(`stuck: ${what} (${Math.round(ms / 1000)} s)`);
        await sleep(100);
    }
}

/** The view has nothing to show or answer by itself: no replay, no scene, no automatic answer on its way. */
async function idle(ms = 120000) {
    await until(() => window.e18 && !e18.playback && !e18.stage, ms, 'a replay or a scene does not end');
    await sleep(60); // a pending automatic answer (setTimeout 0) goes first
    await until(() => !e18.playback && !e18.stage, ms, 'a replay does not end');
}

/** Plays `me`'s decisions until the rival has to decide (or the game ends). */
async function playTurn(me, bot) {
    for (let n = 0; n < 500; n++) {
        await idle();
        const s = e18.session;
        if (s.over) return;
        const p = s.state.pending;
        if (p.side !== me) {
            if (e18.autoAnswer(p)) continue; // the rival's empty window: the view passes it
            if (!document.querySelector('.decision .mail')) throw new Error('the rival has to decide but there is no panel to send the game');
            return;
        }
        if (e18.autoAnswer(p)) continue; // our own routine question: the view answers it
        e18.act(bot(p));
    }
    throw new Error('too many decisions in one turn');
}

/** Sends the game to the other player and opens it as him; returns what to check. */
async function send(me, stores) {
    await e18.shareLink('copy');
    document.querySelector('dialog[open]')?.close();
    if (e18.canUndo()) throw new Error('what was sent can still be undone');
    const sent = { answers: [...e18.session.answers], fp: fingerprint(e18.session.state), over: e18.session.over };
    const code = await encodeRecord(makeRecord(e18.session, 'ui-test'));
    const other = enemyOf(me);
    stores[me] = localStorage.getItem(MAIL_KEY);
    localStorage.setItem(MAIL_KEY, stores[other] ?? '{}');
    const before = window.e18;
    let scenes = 0;
    const seen = new WeakSet();
    const watch = new MutationObserver(() => {
        for (const el of document.querySelectorAll('.combat-scene')) {
            if (!seen.has(el)) {
                seen.add(el);
                scenes++;
            }
        }
    });
    watch.observe(document.body, { subtree: true, childList: true });
    location.hash = code;
    await until(() => window.e18 !== before, 20000, 'the link does not open the game');
    const expected = (e18.playback?.frames ?? []).reduce((n, f) => n + e18.scenesOf(f.beat).length, 0);
    await idle();
    watch.disconnect();
    // the other player's view of what arrived
    const s = e18.session;
    if (e18.mail !== me) throw new Error(`the receiver plays the wrong side (rival ${e18.mail}, expected ${me})`);
    if (s.answers.length !== sent.answers.length || fingerprint(s.state) !== sent.fp) throw new Error('the game received differs from the one sent');
    if (e18.canUndo()) throw new Error('what was received can be undone');
    if (scenes !== expected) throw new Error(`${expected} combat scenes in the replay, ${scenes} shown`);
    if (sent.over && !document.querySelector('.decision .result')) throw new Error('the end is not shown');
    return { scenes, over: sent.over };
}

async function game(i) {
    const t0 = performance.now();
    say(`game ${i}: new correspondence game (French create it)`);
    localStorage.setItem(MAIL_KEY, '{}');
    // the setup screen, as a player would use it
    window.e18?.opts?.onExit?.();
    await until(() => document.querySelector('select[name=french]'), 20000, 'the menu');
    document.querySelector('select[name=french]').value = 'human';
    document.querySelector('select[name=british]').value = 'mail';
    document.querySelector('input[name=seed]').value = `ui-${i}-${Date.now() % 100000}`;
    const scenario = [...document.querySelectorAll('textarea')].find((t) => /hands/.test(t.placeholder));
    if (scenario) scenario.value = '';
    const before = window.e18;
    [...document.querySelectorAll('button')].find((b) => /Empezar/.test(b.textContent)).click();
    await until(() => window.e18 && window.e18 !== before, 20000, 'the game does not start');
    const stores = {};
    const bots = {};
    let me = 'french';
    let links = 0;
    let scenes = 0;
    for (;;) {
        bots[me] ??= createGreedyBot(`ui-${i}-${me}`, () => e18.session.state);
        await playTurn(me, bots[me]);
        const r = await send(me, stores);
        links++;
        scenes += r.scenes;
        state.link = { game: i, links, scenes, round: e18.session.state.roundNo };
        if (r.over) break;
        me = enemyOf(me);
    }
    const res = { game: i, links, scenes, winner: e18.session.state.result.winner, rounds: e18.session.state.roundNo, minutes: +((performance.now() - t0) / 60000).toFixed(1) };
    say(`game ${i}: ${JSON.stringify(res)}`);
    state.games.push(res);
}

/** Starts the run in the background (the console stays free); progress() tells how it goes. */
export function start({ games = 2, ui = { replay: 'fast', dice: 'on', scenes: 'on', sound: 'off' } } = {}) {
    if (state.running) return 'already running';
    if (!window.e18 && !document.querySelector('select[name=french]')) return 'open the game page with ?debug first';
    const prefs = JSON.parse(localStorage.getItem('e18-prefs') ?? '{}');
    localStorage.setItem('e18-prefs', JSON.stringify({ ...prefs, ui: { ...prefs.ui, ...ui } }));
    const errors = (e) => state.errors.push(String(e.reason ?? e.message ?? e));
    addEventListener('error', errors);
    addEventListener('unhandledrejection', errors);
    state.running = true;
    (async () => {
        for (let i = 0; i < games; i++) {
            try {
                await game(i);
            } catch (err) {
                say(`game ${i} FAILED: ${err.message}`);
                state.errors.push(`game ${i}: ${err.message}`);
            }
        }
        say('done');
        state.running = false;
    })();
    return 'started';
}

export const progress = () => ({ running: state.running, link: state.link, games: state.games, errors: state.errors, log: state.log.slice(-8) });
