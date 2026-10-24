// Entry point: setup screen, saved game and the game view.

import { Session, decodeRecord, replayRecord } from '../engine/index.js';
import { renderSetup } from './setup.js';
import { GameView } from './view.js';
import { preloadAll } from './preload.js';

const BUILD = '2026-10-24';
const SAVE_KEY = 'e18-save';
const PREFS_KEY = 'e18-prefs';
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

/** Saved after every decision; cleared when the game ends. */
function save(session, players) {
    if (session.over) store.set(SAVE_KEY, null);
    else store.set(SAVE_KEY, { setup: session.setup, answers: session.answers, round: session.state.roundNo, players });
}

/** ui: { speed, replay, auto, handoff } (view.js), kept in the preferences. */
function play(session, players, ui, notice) {
    view?.dispose();
    view = new GameView(root, session, {
        build: BUILD, players, ui, notice, onExit: showSetup,
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
    renderSetup(root, {
        prefs,
        saved: saved && { round: saved.round, answers: saved.answers.length },
        onStart(setup, players, speed) {
            const ui = { ...prefs.ui, speed };
            store.set(PREFS_KEY, { ...prefs, setup, players, speed, ui });
            const s = new Session(setup);
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

// everything loads first (images, combat scenes, sounds, 3D dice), then the menu
preloadAll(root).then(showSetup);
