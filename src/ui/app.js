// Entry point: setup screen, saved game and the game view.

import { Session, decodeRecord, replayRecord, enemyOf } from '../engine/index.js';
import { renderSetup } from './setup.js';
import { GameView } from './view.js';
import { preloadAll } from './preload.js';

const BUILD = '2026-10-24';
const SAVE_KEY = 'e18-save';
const PREFS_KEY = 'e18-prefs';
/** Correspondence games of this browser: { [match id]: { side, setup, answers, round, updated } }. */
const MAIL_KEY = 'e18-mail';
const root = document.getElementById('app');
let view = null;

const store = {
    get(key) {
        try {
            return JSON.parse(localStorage.getItem(key) ?? 'null');
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            if (value == null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch {
            /* storage unavailable: games just are not saved */
        }
    },
};

/**
 * Saved after every decision; cleared when the game ends. A correspondence game is kept apart,
 * by its id, so it never replaces the saved game (there may be several at once).
 */
function save(session, players) {
    const id = session.setup.match;
    if (!id) {
        if (session.over) store.set(SAVE_KEY, null);
        else store.set(SAVE_KEY, { setup: session.setup, answers: session.answers, round: session.state.roundNo, players });
        return;
    }
    const all = store.get(MAIL_KEY) ?? {};
    if (session.over) delete all[id];
    else all[id] = { ...all[id], setup: session.setup, answers: session.answers, round: session.state.roundNo, updated: Date.now() };
    store.set(MAIL_KEY, all);
}

/** Who plays what in a correspondence game: this browser one side, the rival the other. */
const mailPlayers = (side) => ({ [side]: 'human', [enemyOf(side)]: 'mail' });

function rememberSide(id, side) {
    const all = store.get(MAIL_KEY) ?? {};
    all[id] = { ...all[id], side };
    store.set(MAIL_KEY, all);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPrefix = (short, long) => short.length <= long.length && short.every((x, i) => same(x, long[i]));

/**
 * A link with a game (…#E18.…) was opened: a correspondence game goes on in the side this
 * browser plays (the one that has to decide, the first time); any other code is loaded to look at.
 */
async function openLink(code) {
    history.replaceState(null, '', location.pathname + location.search); // the code leaves the address bar
    const record = await decodeRecord(code);
    const prefs = store.get(PREFS_KEY) ?? {};
    const { session: received, failedAt, error } = replayRecord(record);
    const id = record.setup.match;
    if (!id) {
        play(received, { french: 'human', british: 'human' }, prefs.ui, `Cargada: ${record.answers.length} decisiones.`);
        return;
    }
    const mine = (store.get(MAIL_KEY) ?? {})[id];
    const ours = mine?.answers ?? [];
    const fresh = record.answers.length - ours.length;
    let session = received;
    let replay = null;
    let notice = `Partida recibida: ${fresh} decisi${fresh === 1 ? 'ón nueva' : 'ones nuevas'} del rival.`;
    if (failedAt != null) notice = `El juego ha cambiado desde que se envió: la partida se para en la decisión ${failedAt + 1} (${error}).`;
    else if (mine && ours.length >= record.answers.length && isPrefix(record.answers, ours)) {
        session = new Session(mine.setup, ours);
        notice = 'Este enlace no trae nada nuevo: sigues donde lo dejaste.';
    } else {
        if (mine && !isPrefix(ours, record.answers)) notice = 'Atención: este enlace no continúa tu copia de la partida (se separan); se sigue con el enlace.';
        // what the rival did since our copy (all of it, the first time) is replayed step by step
        const from = mine && isPrefix(ours, record.answers) ? ours.length : 0;
        session = new Session(record.setup, record.answers.slice(0, from));
        replay = { frames: [], logStart: session.state.log.length };
        for (const a of record.answers.slice(from)) {
            session.act(a, { capture: true });
            replay.frames.push(...session.frames);
        }
    }
    const side = mine?.side ?? session.state.pending?.side ?? 'british';
    rememberSide(id, side);
    save(session, mailPlayers(side));
    play(session, mailPlayers(side), prefs.ui, notice, replay);
}

function continueMail(id) {
    const m = (store.get(MAIL_KEY) ?? {})[id];
    const prefs = store.get(PREFS_KEY) ?? {};
    const { session, failedAt } = replayRecord({ setup: m.setup, answers: m.answers });
    play(session, mailPlayers(m.side), prefs.ui, failedAt != null ? `El juego ha cambiado: la partida se para en la decisión ${failedAt + 1}.` : null);
}

function forgetMail(id) {
    const all = store.get(MAIL_KEY) ?? {};
    delete all[id];
    store.set(MAIL_KEY, all);
    showSetup();
}

/** ui: { speed, replay, auto, handoff } (view.js), kept in the preferences. replay: steps to show first. */
function play(session, players, ui, notice, replay = null) {
    view?.dispose();
    view = new GameView(root, session, {
        build: BUILD, players, ui, notice, replay, onExit: showSetup,
        save: (s, who) => save(s, who),
        saveUi: (u) => store.set(PREFS_KEY, { ...store.get(PREFS_KEY), ui: u, speed: u.speed }),
    });
    if (new URLSearchParams(location.search).has('debug')) window.e18 = view;
}

function showSetup() {
    view?.dispose();
    view = null;
    const saved = store.get(SAVE_KEY);
    const prefs = store.get(PREFS_KEY) ?? {};
    const mail = Object.entries(store.get(MAIL_KEY) ?? {})
        .filter(([, m]) => m.setup && m.side)
        .sort(([, a], [, b]) => b.updated - a.updated)
        .map(([id, m]) => ({ id, side: m.side, round: m.round, answers: m.answers.length }));
    renderSetup(root, {
        prefs,
        saved: saved && { round: saved.round, answers: saved.answers.length },
        mail,
        onMail: continueMail,
        onForgetMail: forgetMail,
        onStart(setup, players, speed) {
            const ui = { ...prefs.ui, speed };
            store.set(PREFS_KEY, { ...prefs, setup, players, speed, ui });
            const remote = Object.keys(players).find((s) => players[s] === 'mail');
            // a correspondence game: an id for its links, this browser plays the other side
            const s = new Session(remote ? { ...setup, match: crypto.randomUUID().slice(0, 8) } : setup);
            if (remote) rememberSide(s.setup.match, enemyOf(remote));
            save(s, players);
            play(s, players, ui);
        },
        onContinue() {
            const players = saved.players ?? prefs.players;
            try {
                play(new Session(saved.setup, saved.answers), players, prefs.ui);
            } catch (err) {
                // the engine changed since the game was saved: keep what still replays
                const { session, failedAt } = replayRecord({ setup: saved.setup, answers: saved.answers });
                play(session, players, prefs.ui, `La partida guardada ya no se repite entera (se para en la decisión ${failedAt + 1}): ${err.message}`);
            }
        },
        async onLoadCode(code, _players, speed) {
            const record = await decodeRecord(code);
            const { session, failedAt, error, matches } = replayRecord(record);
            let notice = `Cargada: ${record.answers.length} decisiones.`;
            if (failedAt != null) notice = `El motor ha cambiado: la repetición se para en la decisión ${failedAt + 1} (${error}).`;
            else if (!matches) notice = 'Repetida, pero el estado final no coincide con la grabación: el motor ha cambiado.';
            // a loaded game is for looking at: both sides human, so no bot plays on by itself
            play(session, { french: 'human', british: 'human' }, { ...prefs.ui, speed }, notice);
        },
    });
}

const linked = () => location.hash.startsWith('#E18.') && decodeURIComponent(location.hash.slice(1));
const follow = (code) => openLink(code).catch((err) => {
    showSetup();
    alert(`No se pudo abrir el enlace de la partida: ${err.message}`);
});
// a link opened while the game is already open
addEventListener('hashchange', () => linked() && follow(linked()));

// everything loads first (images, combat scenes, sounds, 3D dice), then the menu or the game of the link
preloadAll(root).then(() => (linked() ? follow(linked()) : showSetup()));
