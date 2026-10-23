// A game in progress: setup + the answers given so far. The engine is a
// deterministic generator, so replaying the answers rebuilds the state exactly
// (undo, saved games, bug reports). Same as Witch Hunter's WH1. records.

import { validate, GameEnd, IllegalAction } from './ask.js';
import { normalizeSetup, createState, run } from './game.js';

export class Session {
    /** @param {object} setup @param {any[]} [answers] */
    constructor(setup, answers = []) {
        this.setup = normalizeSetup(setup);
        this.#start();
        for (const a of answers) this.act(a);
    }

    #start() {
        this.frames = [];
        this.capture = false;
        this.answers = [];
        /** Readable history: { side, prompt, answer, round } per answer (debug panel). */
        this.trail = [];
        /** Undo cannot go below this answer: it showed hidden cards or rolled dice (see act). */
        this.undoFloor = 0;
        this.state = createState(this.setup);
        this.iter = run(this.state);
        this.#resume(undefined);
    }

    #resume(answer) {
        const g = this.state;
        g.pending = null;
        try {
            let step = this.iter.next(answer);
            // beats are not decisions: snapshot them (if asked) and go on
            while (!step.done && step.value.type === 'beat') {
                if (this.capture) this.frames.push({ beat: step.value, logLen: g.log.length, state: structuredClone({ ...g, log: [], pending: null }) });
                step = this.iter.next();
            }
            if (step.done) throw new Error('the game generator ended without a result');
            g.pending = step.value;
        } catch (err) {
            if (err instanceof GameEnd) {
                g.result = { winner: err.winner, reason: err.reason, round: g.roundNo, turn: g.turnNo };
                g.combat = null;
                g.log.push({ round: g.roundNo, turn: g.turnNo, text: `Fin de la partida: gana el ${err.winner === 'french' ? 'francés' : 'británico'} (${err.reason}).`, kind: err.winner });
            } else {
                g.error = { message: err.message, stack: err.stack };
                throw err;
            }
        }
    }

    get pending() {
        return this.state.pending;
    }

    get over() {
        return Boolean(this.state.result || this.state.error);
    }

    /**
     * Answers the pending decision. Throws IllegalAction if it does not fit.
     * capture: keep a snapshot at each beat until the next decision (this.frames).
     */
    act(answer, { capture = false } = {}) {
        this.frames = [];
        this.capture = capture;
        if (this.over) throw new IllegalAction('the game is over');
        const p = this.state.pending;
        validate(p, answer);
        const label = (id) => p.options.find((o) => o.id === id)?.label ?? id;
        this.trail.push({ side: p.side, prompt: p.prompt, answer: Array.isArray(answer) ? answer.map(label).join(', ') || '(ninguna)' : label(answer), round: this.state.roundNo });
        this.answers.push(answer);
        const before = this.state.rng;
        this.#resume(answer);
        // every draw, shuffle and die roll moves the PRNG
        if (this.state.rng !== before) this.undoFloor = this.answers.length;
    }

    /** Undo is for slips, not for peeking: it stops at the last answer that rolled dice, drew or shuffled. */
    get canUndo() {
        return this.answers.length > this.undoFloor;
    }

    /** Rebuilds the game without the last `n` answers. */
    undo(n = 1) {
        const keep = this.answers.slice(0, Math.max(0, this.answers.length - n));
        this.#start();
        for (const a of keep) this.act(a);
    }

    /** Rebuilds the game up to answer number `n` (time travel). */
    rewindTo(n) {
        this.undo(this.answers.length - n);
    }
}

// ------------------------------------------------------------------ records

const PREFIX = 'E18.';

/** Short summary of a state: if it differs after a replay, the engine changed since the recording. */
export function fingerprint(g) {
    const units = Object.values(g.units).map((u) => `${u.blocks}/${u.morale ?? '-'}/${u.status[0]}`).join(',');
    return [g.turnNo, g.rng, g.supply, g.players.french.cubes, g.players.british.cubes, g.locations.elvina[0], g.locations.palavea[0], g.moore.track, units].join('|');
}

export function makeRecord(session, build) {
    return { v: 1, ...(build ? { build } : {}), setup: session.setup, answers: [...session.answers], check: fingerprint(session.state) };
}

async function pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

const toB64url = (bytes) => {
    let bin = '';
    for (const x of bytes) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function encodeRecord(record) {
    const json = new TextEncoder().encode(JSON.stringify(record));
    return PREFIX + toB64url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Accepts the code with spaces or line breaks in between. */
export async function decodeRecord(code) {
    const t = code.replace(/\s+/g, '');
    const i = t.indexOf(PREFIX);
    if (i < 0) throw new Error(`not a game record (it must start with ${PREFIX})`);
    let record;
    try {
        const bytes = await pipe(fromB64url(t.slice(i + PREFIX.length)), new DecompressionStream('deflate-raw'));
        record = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error('the text is incomplete or damaged (was it copied whole?)');
    }
    if (record.v !== 1 || !record.setup || !Array.isArray(record.answers)) throw new Error('unknown record format');
    return record;
}

/**
 * Replays a record. Stops at the first answer that no longer fits (the engine
 * changed) and reports it.
 */
export function replayRecord(record, upTo = record.answers.length) {
    const session = new Session(record.setup);
    for (let i = 0; i < upTo; i++) {
        try {
            session.act(record.answers[i]);
        } catch (err) {
            return { session, failedAt: i, error: err.message, matches: false };
        }
    }
    const matches = upTo < record.answers.length || !record.check || fingerprint(session.state) === record.check;
    return { session, failedAt: null, matches };
}
