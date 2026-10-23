// Decisions. The engine is a generator: whenever a player must decide, it
// yields a request ({ type, side, prompt, options… }) and receives the answer
// back from the session. A game is therefore (setup, answers): replaying the
// answers rebuilds any state exactly, which gives undo, saved games and bug
// reports. Same design as 49_Witch_Hunter_Digital_Clone, plus `side`: both
// players decide, also during the other's turn.

/**
 * @typedef {'french' | 'british'} Side
 * @typedef {{ id: string, label: string, ref?: string, hint?: string }} Option
 * @typedef {{ type: 'choose', side: Side, prompt: string, options: Option[], kind?: string }} ChooseRequest
 * @typedef {{ type: 'pick', side: Side, prompt: string, options: Option[], min: number, max: number, kind?: string }} PickRequest
 * @typedef {ChooseRequest | PickRequest} Request
 */

export class IllegalAction extends Error {}

/** Thrown inside the game generator to end the game. */
export class GameEnd extends Error {
    /** @param {Side} winner @param {string} reason */
    constructor(winner, reason) {
        super(`${winner}: ${reason}`);
        this.winner = winner;
        this.reason = reason;
    }
}

/**
 * One option out of several, answered by `side`. With a single option it
 * answers itself (the decision is deterministic, so replays stay in step).
 * @returns {Generator<Request, string, any>}
 */
export function* choose(g, side, prompt, options, extra = {}) {
    if (!options.length) throw new Error(`no options for: ${prompt}`);
    if (options.length === 1 && !extra.confirm) return options[0].id;
    return yield { type: 'choose', side, prompt, options, ...extra };
}

/**
 * Between `min` and `max` distinct options. Answers itself when the choice is forced.
 * @returns {Generator<Request, string[], any>}
 */
export function* pick(g, side, prompt, options, min, max, extra = {}) {
    max = Math.min(max, options.length);
    min = Math.min(min, max);
    if (max <= 0) return [];
    if (min === options.length) return options.map((o) => o.id);
    return yield { type: 'pick', side, prompt, options, min, max, ...extra };
}

/** Yes/no question. @returns {Generator<Request, boolean, any>} */
export function* confirm(g, side, prompt, yes = 'Sí', no = 'No', extra = {}) {
    const a = yield* choose(g, side, prompt, [{ id: 'yes', label: yes }, { id: 'no', label: no }], extra);
    return a === 'yes';
}

/**
 * A pause that is not a decision (dice rolled, results applied, morale test…):
 * the session can snapshot the state here and goes on at once. It never changes
 * the game, so recordings stay valid.
 */
export function* beat(g, kind, data = {}) {
    yield { type: 'beat', kind, ...data };
}

/** Throws IllegalAction if `answer` does not fit `request`. */
export function validate(request, answer) {
    if (!request) throw new IllegalAction('no decision is pending');
    const ids = new Set(request.options.map((o) => o.id));
    if (request.type === 'choose') {
        if (typeof answer !== 'string' || !ids.has(answer)) throw new IllegalAction(`"${answer}" is not an option of "${request.prompt}"`);
        return;
    }
    if (!Array.isArray(answer)) throw new IllegalAction('expected a list of options');
    if (new Set(answer).size !== answer.length) throw new IllegalAction('repeated option');
    if (answer.length < request.min || answer.length > request.max) {
        throw new IllegalAction(`pick between ${request.min} and ${request.max} options`);
    }
    for (const a of answer) if (!ids.has(a)) throw new IllegalAction(`"${a}" is not an option of "${request.prompt}"`);
}

/**
 * Game log. `kind`: info, french, british, good, bad, phase, dice.
 * @param {any} g @param {string} text @param {string} [kind]
 */
export function log(g, text, kind = 'info') {
    g.log.push({ round: g.roundNo, turn: g.turnNo, text, kind });
}
