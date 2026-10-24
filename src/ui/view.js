// Game screen: the illustrated map with its tokens, the armies, hands, tactics
// and market, the pending decision (with the dice of the combat in course), the
// log and the debug tools. It re-renders everything after each answer: the
// state is small and the engine is the single source of truth.

import { h } from './dom.js';
import {
    UNITS, COMMANDERS, ACTIONS, ACTION_BACKS, TACTICS, BOARD, LOCATIONS, unitsOf, enemyOf, SIDE_NAME, currentResults, describe,
    cardLabel, orderLabel, makeRecord, encodeRecord, IllegalAction, eliminatedOf, currentDice, attackDice, activeModifiers,
} from '../engine/index.js';
import { createGreedyBot } from '../ai/greedyBot.js';
import { createRandomBot } from '../ai/randomBot.js';
import { BOT_SPEEDS, rulesLink } from './setup.js';
import { snapshot, animateBoard } from './anim.js';
import { playCombat, playCapture, playRout } from './combatScene.js';
import { setSound } from './audio.js';
import { emptyWindow } from './mail.js';

const BOT_MS = { fast: 80, normal: 450, slow: 1300, step: null };
/** Replay of what happened in each answer (Session frames): ms per step; step: wait for "Siguiente"; off: no replay. */
const REPLAY_MS = { slow: 1700, normal: 950, fast: 400, step: null, off: 0 };
export const REPLAYS = [['normal', 'Repetición normal'], ['slow', 'Repetición lenta'], ['fast', 'Repetición rápida'], ['step', 'Repetición paso a paso'], ['off', 'Sin repetición']];
/** Which routine questions of a human are answered by themselves (autoAnswer). */
/** Speed of the 3D dice for each replay speed (dice3d.js rate). */
const DICE_RATE = { slow: 1, normal: 1.3, fast: 2.2, step: 1.3, off: 1.6 };
export const DICE = [['on', 'Dados 3D'], ['off', 'Sin dados 3D']];
export const SCENES = [['on', 'Escenas de combate'], ['off', 'Sin escenas']];
export const SOUND = [['on', 'Sonido'], ['off', 'Sin sonido']];
export const AUTO = [['useful', 'Saltar ventanas sin cartas'], ['minimal', 'Solo decisiones importantes'], ['all', 'Preguntar todo']];
const [W, H] = BOARD.size;
const SIDES = ['french', 'british'];
const CODE = { french: 'fr', british: 'gb' };
const SIDE_TITLE = { french: 'Francés', british: 'Británico' };

const at = ([x, y]) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** What a replay step shows (the beats of the engine: ask.js beat). */
function beatText(b) {
    switch (b.kind) {
        case 'turn': return `Turno ${b.side === 'french' ? 'francés' : 'británico'}`;
        case 'card': return `Se juega ${cardLabel(b.card)}`;
        case 'roll': return `Tirada: ${b.dice.join(' · ')}`;
        case 'results': return `Resultado: ${describe(b.results)}`;
        case 'morale': return `Test de moral de ${UNITS[b.unit].name}: sale ${b.roll} contra ${b.limit}, ${b.ok ? 'aguanta' : 'falla'}`;
        case 'moore_risk': return `Tirada de riesgo de Moore: ${b.dice[0]} + ${b.dice[1]} contra ${b.track}${b.fell ? ': ¡cae abatido!' : ': sale ileso'}`;
        case 'moore_dead': return 'Muere Sir John Moore';
        case 'rally': return `Arenga de Moore: sale ${b.roll}, ${b.ok ? 'la unidad se salva' : 'no basta'}`;
        case 'rout': return `¡Desbandada de ${UNITS[b.unit].name}!`;
        case 'received': return 'Así lo dejaste; ahora, lo que ha hecho el rival';
        default: return b.kind;
    }
}

/**
 * The dice thrown at a beat, for the 3D tray: the attacker's (blue French, red British; only those
 * rolled, not the fixed 6s), the white die of a morale test, Moore's black dice.
 */
function beatDice(b) {
    switch (b.kind) {
        case 'roll': return b.thrown.map((value) => ({ sides: 6, value, color: b.side === 'french' ? 'blue' : 'red' }));
        case 'morale': return [{ sides: 6, value: b.roll, color: 'white' }];
        case 'moore_risk': return b.dice.map((value) => ({ sides: 6, value, color: 'black' }));
        case 'rally': return [{ sides: 6, value: b.roll, color: 'black' }];
        default: return [];
    }
}

/** The run of equal cubes at the end of a streak (docs/01 §9): { n: cards, cubes }. */
function runOf(streak) {
    const cubes = streak.at(-1);
    let n = 0;
    for (let i = streak.length - 1; i >= 0 && streak[i] === cubes; i--) n++;
    return { n, cubes };
}

/** Would playing this card now give the +2 of the streak? (2 cards in a row with its cubes) */
const givesBonus = (p, cardId) => {
    const r = runOf(p.streak);
    return r.n >= 2 && ACTIONS[cardId].cubes === r.cubes;
};

/** What the streak means for the next card. */
function streakHint(p) {
    const r = runOf(p.streak);
    const cubes = (n) => `${n} cubo${n > 1 ? 's' : ''}`;
    if (!r.n) return 'Aún no ha jugado cartas de Acción: tres seguidas con los mismos cubos dan +2.';
    if (r.n >= 2) return `Racha de ${r.n} cartas de ${cubes(r.cubes)}: otra de ${cubes(r.cubes)} da +2.`;
    return `Última carta de ${cubes(r.cubes)}: dos más seguidas de ${cubes(r.cubes)} dan +2.`;
}

/** The cards played as groups of cubes, oldest first; the run at the end in gold. max: only the last ones. */
function streakView(p, max = 0, big = false) {
    const s = p.streak;
    const r = runOf(s);
    const from = max ? Math.max(0, s.length - max) : 0;
    const chips = s.slice(from).map((c, k) => {
        const inRun = r.n >= 2 && from + k >= s.length - r.n;
        return h(`span.cubechip${inRun ? '.run' : ''}`, { title: `Carta de ${c} cubo${c > 1 ? 's' : ''}` }, Array.from({ length: c }, () => h('i')));
    });
    return h(`span.streak${big ? '.big' : ''}`, { title: streakHint(p) }, from > 0 && h('span.more', null, `+${from}`), chips.length ? chips : h('span.muted', null, '—'));
}

/**
 * The dice a unit rolls now, explained: its card, the modifiers that hold, and each attack it could
 * make (an order can add or take dice). Moore's support and tactics come on top, in the combat.
 */
function diceInfo(g, id) {
    const u = UNITS[id];
    const n = currentDice(g, id);
    const mods = activeModifiers(g, id);
    const lines = [`Dados ahora: ${n}${mods.length ? ` (${u.dice} de la tarjeta; ${mods.map((m) => m.text).join('; ')})` : ''}`];
    const attacks = attackDice(g, id);
    if (attacks.length) lines.push(...attacks.map((a) => `${orderLabel(a)}: ${a.dice} dados`));
    else lines.push('Ahora no tiene ningún ataque posible');
    if (u.side === 'british' && u.type !== 'reserve') lines.push('Moore en su posición: +1 dado o un relanzamiento gratis');
    return { n, changed: n !== u.dice, text: lines.join('\n') };
}

/** Cells per group of the casualty tracks: each group ends at a threshold of the taker (docs/01 §4.4). */
const CASUALTY_GROUPS = { british: 5, french: 4 };
const CASUALTY_HINT = {
    british: 'El francés recibe +1 cubo de Inercia al llegar a 5 bajas británicas y +2 a las 10.',
    french: 'El británico recibe +1 cubo de Inercia al llegar a 4 bajas francesas, +2 a las 8 y +3 a las 12.',
};

/** A small white die with the number of dice. */
const diceChip = (n, changed) => h(`span.d6${changed ? '.changed' : ''}`, null, n);

/** Image of whatever an option or a token refers to. */
function refImage(ref) {
    if (!ref) return null;
    if (ACTIONS[ref]) return { src: ACTIONS[ref].image };
    if (TACTICS[ref]) return { src: TACTICS[ref].image, text: TACTICS[ref].text };
    if (UNITS[ref]) return { src: UNITS[ref].card, wide: true };
    if (COMMANDERS[ref]) return { src: COMMANDERS[ref].card, wide: true };
    return null;
}

export class GameView {
    /**
     * @param {HTMLElement} root
     * @param {import('../engine/session.js').Session} session
     * @param {{ build: string, players: Record<string, string>, ui?: any, notice?: string, onExit: Function, save: Function, saveUi?: Function }} opts
     */
    constructor(root, session, opts) {
        this.root = root;
        this.session = session;
        this.opts = opts;
        this.players = { french: 'human', british: 'human', ...opts.players };
        const ui = opts.ui ?? {};
        /** speed: bots; replay: steps of each answer; auto: routine questions; handoff: "pass the device" screen */
        this.ui = {
            speed: BOT_MS[ui.speed] !== undefined ? ui.speed : 'normal',
            replay: REPLAY_MS[ui.replay] !== undefined ? ui.replay : 'normal',
            auto: AUTO.some(([v]) => v === ui.auto) ? ui.auto : 'useful',
            handoff: ui.handoff ?? true,
            dice: ui.dice === 'off' ? 'off' : 'on',
            scenes: ui.scenes === 'off' ? 'off' : 'on',
            sound: ui.sound === 'off' ? 'off' : 'on', // the battle sounds of the combat scenes
        };
        setSound(this.ui.sound === 'on');
        this.stage = null; // the combat scene on screen (combatScene.js), skipped like the dice
        this.tray = null; // the 3D dice (dice3d.js), loaded the first time they are needed
        this.diceHidden = null; // combat dice being thrown: '?' on screen until they land ('all' or a Set of indexes)
        this.playback = null; // { frames, i, timer }: replay of the last answer
        this.mark = session.state.log.length; // log entries since the last human decision are summarised
        this.shownSide = null; // hotseat: the side the screen was handed to
        this.paused = false;
        this.revealAll = false;
        this.selection = new Set();
        this.error = null;
        this.timer = null;
        this.makeBots();
        /** Correspondence: the rival's side (it decides elsewhere) and what can no longer be undone (received or sent). */
        this.mail = SIDES.find((s) => this.isRemote(s)) ?? null;
        this.mailFloor = session.answers.length;
        /** Live (app.js liveFor): the connection, and the rival's answers waiting for the replay of the previous one. */
        this.live = opts.live ?? null;
        this.inbox = [];
        this.preview = h('div.preview');
        this.dialog = h('dialog');
        document.body.append(this.preview, this.dialog);
        this.onKey = (e) => {
            if (this.stage && ['Enter', 'Escape', ' '].includes(e.key) && !e.target.closest('input, textarea, select')) {
                e.preventDefault();
                this.stage.skip();
                return;
            }
            if (this.playback?.rolling && ['Enter', 'Escape', ' '].includes(e.key) && !e.target.closest('input, textarea, select')) {
                e.preventDefault();
                this.tray?.then((t) => t?.skip());
                return;
            }
            if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.target.closest('input, textarea')) {
                e.preventDefault();
                this.undo();
            }
        };
        document.addEventListener('keydown', this.onKey);
        // a game received by correspondence: what the rival did is replayed first
        if (opts.replay?.frames.length) {
            this.mark = opts.replay.logStart;
            this.playFrames(opts.replay.frames, opts.replay.logStart);
        } else {
            this.render();
        }
        if (opts.notice) this.toast(opts.notice);
    }

    makeBots() {
        const seed = `${this.session.setup.seed}-${this.session.answers.length}`;
        const make = (kind, side) => kind === 'greedy' ? createGreedyBot(`${seed}-${side}`, () => this.session.state) : createRandomBot(`${seed}-${side}`);
        this.bots = Object.fromEntries(SIDES.map((s) => [s, this.players[s] === 'human' || this.isRemote(s) ? null : make(this.players[s], s)]));
    }

    dispose() {
        clearTimeout(this.timer);
        this.stopPlayback();
        this.tray?.then((t) => t?.destroy());
        document.removeEventListener('keydown', this.onKey);
        this.preview.remove();
        this.dialog.remove();
    }

    /** The state on screen: a step of the replay, else the live one. */
    get g() {
        const pb = this.playback;
        if (!pb) return this.session.state;
        const f = pb.frames[pb.i];
        // while its dice roll, a step does not show its log lines yet (they would tell the result)
        if (pb.rolling) return { ...f.state, log: this.session.state.log.slice(0, pb.i ? pb.frames[pb.i - 1].logLen : pb.logStart), pending: null };
        return (f.view ??= { ...f.state, log: this.session.state.log.slice(0, f.logLen), pending: null });
    }

    setUi(key, value) {
        this.ui[key] = value;
        if (key === 'sound') setSound(value === 'on');
        this.opts.saveUi?.(this.ui);
        this.render();
    }

    isBot(side) {
        return Boolean(this.bots[side]);
    }

    /** The rival at a distance (by correspondence or live): he answers in his own browser. */
    isRemote(side) {
        return this.players[side] === 'mail' || this.players[side] === 'live';
    }

    /** Live and connected: each answer travels at once. */
    get online() {
        return this.live?.link.state === 'open';
    }

    /** Undo stops at the last decision received or sent by correspondence; live, every answer has gone at once. */
    canUndo() {
        if (this.live) return false;
        return this.session.canUndo && (!this.mail || this.session.answers.length > this.mailFloor);
    }

    /** Live: the rival's answers, played one after another as their replays end. */
    receive(answers) {
        this.inbox.push(...answers);
        this.deliver();
    }

    deliver() {
        if (this.playback || this.stage || !this.inbox.length) return;
        this.act(this.inbox.shift(), { remote: true });
    }

    liveChanged(state) {
        const say = { open: 'Conectados en directo: cada jugada llega al momento.', failed: 'No se pudo conectar. Podéis volver a intentarlo o seguir por enlaces.', closed: 'Se ha cortado la conexión en directo. Podéis volver a conectar o seguir por enlaces.' }[state];
        if (say) this.toast(say);
        if (!this.playback) this.render();
    }

    /** Whose hand is face up: the humans' (only the one deciding when both are human); all with "show hands". */
    handVisible(side) {
        if (this.revealAll) return true;
        const humans = SIDES.filter((s) => !this.isBot(s) && !this.isRemote(s));
        if (!humans.length) return true;
        if (humans.length === 1) return humans[0] === side;
        return this.g.pending?.side === side;
    }

    // ------------------------------------------------------------ actions

    /** auto: an answer given by autoAnswer, which does not start a new summary. remote: the live rival's. */
    act(answer, { auto = false, remote = false } = {}) {
        clearTimeout(this.timer);
        this.stopPlayback();
        const p = this.session.state.pending;
        const logStart = this.session.state.log.length;
        const n = this.session.answers.length;
        try {
            this.session.act(answer, { capture: true }); // the snapshots carry the dice of each roll too
            this.error = null;
            if (!remote) this.live?.local(n, answer); // live: it goes to the rival at once
        } catch (err) {
            if (err instanceof IllegalAction) {
                if (remote) return void this.live?.sync.hello(); // it does not fit: the copies resync
                return this.toast(err.message);
            }
            this.error = err;
            console.error(err);
        }
        if (p && !this.isBot(p.side) && !auto && !remote) this.mark = logStart;
        this.selection.clear();
        this.opts.save(this.session, this.players);
        this.playFrames(this.session.frames, logStart);
    }

    /** Shows the steps of one or more answers as the replay setting says (or just the result). */
    playFrames(frames, logStart) {
        const shown = frames.filter((f) => f.beat.kind === 'received' || (this.ui.dice === 'on' && beatDice(f.beat).length) || this.scenesOf(f.beat).length);
        if (this.error || !frames.length) this.render();
        else if (this.ui.replay !== 'off') this.startPlayback(frames, logStart);
        else if (shown.length) this.startPlayback(shown, logStart, { diceOnly: true }); // only the throws and the combat scenes
        else this.render();
    }

    /**
     * Routine questions answered for a human (ui.auto): tactic windows where no card can be
     * played (only discarding 3 is offered); with "minimal", also preventing a market discard
     * (no) and the card to draw (the top one).
     */
    autoAnswer(p) {
        if (!p || this.isBot(p.side)) return null;
        const empty = emptyWindow(p);
        // the rival at a distance: his windows without cards pass by themselves, so only real decisions travel
        // (live and connected he answers them himself, so that the two copies never answer the same question)
        if (this.isRemote(p.side)) return empty && !this.online ? 'pass' : null;
        if (this.ui.auto === 'all') return null;
        if (empty) return 'pass';
        if (this.ui.auto === 'minimal') {
            if (p.kind === 'prevent') return 'no';
            if (p.kind === 'draw') return 'top';
        }
        return null;
    }

    // ------------------------------------------------------------ replay

    /**
     * The scenes a step plays before it is shown, if scenes are on: a combat and the places it
     * took, one after the other; or a unit routed by a failed morale test.
     */
    scenesOf(beat) {
        if (this.ui.scenes !== 'on') return [];
        if (beat.kind === 'rout' && beat.blocks > 0) return [(map) => playRout(map, beat)];
        const s = beat.kind === 'results' ? beat.scene : null;
        if (!s || s.attacker.blocks === 0) return [];
        return [(map) => playCombat(map, s), ...s.captured.map((c) => (map) => playCapture(map, c))];
    }

    /** diceOnly: no replay asked for, but the dice of these steps are thrown. */
    startPlayback(frames, logStart, { diceOnly = false } = {}) {
        this.playback = { frames, i: 0, timer: null, logStart, diceOnly, thrown: -1, rolling: false };
        this.showStep();
    }

    /** A step: its dice are thrown first (over the map, with the result hidden), then it is shown. */
    async showStep() {
        const pb = this.playback;
        clearTimeout(pb.timer);
        const f = pb.frames[pb.i];
        const dice = this.ui.dice === 'on' ? beatDice(f.beat) : [];
        if (dice.length && pb.thrown !== pb.i) {
            pb.thrown = pb.i;
            pb.rolling = true;
            this.diceHidden = f.beat.kind === 'roll' ? (f.beat.rolled.length ? new Set(f.beat.rolled.map(String)) : 'all') : null;
            this.render();
            try {
                await this.throwDice(dice, DICE_RATE[this.ui.replay]);
            } finally {
                pb.rolling = false;
                this.diceHidden = null;
            }
            if (this.playback !== pb) return; // skipped meanwhile
        }
        // the combat scene, then a place changing hands: before the step moves the pieces
        const scenes = this.scenesOf(f.beat);
        const map = this.root.querySelector('.map');
        if (scenes.length && map && pb.staged !== pb.i) {
            pb.staged = pb.i;
            for (const run of scenes) {
                this.stage = run(map);
                await this.stage.done;
                this.stage = null;
                if (this.playback !== pb) return;
            }
        }
        this.render();
        const ms = pb.diceOnly ? 150 : REPLAY_MS[this.ui.replay];
        if (ms) pb.timer = setTimeout(() => this.nextStep(), ms);
    }

    nextStep() {
        const pb = this.playback;
        if (!pb) return;
        if (pb.rolling) return void this.tray?.then((t) => t?.skip());
        if (this.stage) return void this.stage.skip();
        if (pb.i + 1 >= pb.frames.length) return this.endPlayback();
        pb.i++;
        this.showStep();
    }

    stopPlayback() {
        const pb = this.playback;
        if (!pb) return;
        clearTimeout(pb.timer);
        if (pb.rolling) this.tray?.then((t) => t?.skip());
        this.playback = null;
        this.stage?.skip();
    }

    /** Throws the dice over the map (or the whole window if the map is out of sight). False without WebGL. */
    async throwDice(dice, rate = 1) {
        const map = this.root.querySelector('.map');
        if (!map) return false;
        this.tray ??= import(new URL('src/ui/dice3d.js', document.baseURI).href)
            .then((m) => m.createDiceTray())
            .catch((err) => {
                console.warn('Sin dados 3D:', err);
                return null;
            });
        const tray = await this.tray;
        if (!tray) return false;
        let rect = map.getBoundingClientRect();
        if (Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0) < 220) rect = new DOMRect(0, 0, innerWidth, innerHeight);
        await tray.roll(dice, { rect, rate });
        return true;
    }

    endPlayback() {
        this.stopPlayback();
        this.render();
    }

    /** Hotseat: a new player must take the device before the screen shows his hand. */
    needsHandoff() {
        const p = this.session.state.pending;
        if (!this.ui.handoff || this.mail || this.playback || this.revealAll || !p || this.session.over) return false;
        if (SIDES.some((s) => this.isBot(s)) || this.autoAnswer(p)) return false;
        return this.shownSide !== p.side;
    }

    botStep() {
        const p = this.g.pending;
        if (!p || this.session.over || !this.isBot(p.side)) return;
        let answer;
        try {
            answer = this.bots[p.side](p);
        } catch (err) {
            this.error = err;
            this.paused = true;
            return this.render();
        }
        this.act(answer);
    }

    /** After each render: the bot's answer or an automatic one, unless a replay is on. */
    scheduleNext() {
        clearTimeout(this.timer);
        if (this.playback) return;
        if (this.inbox.length) return void this.deliver();
        const p = this.session.state.pending;
        if (!p || this.session.over || this.error) return;
        const auto = this.autoAnswer(p);
        if (auto) {
            this.timer = setTimeout(() => this.act(auto, { auto: true }), 0);
            return;
        }
        if (this.paused || !this.isBot(p.side)) return;
        const ms = BOT_MS[this.ui.speed];
        if (ms == null) return;
        this.timer = setTimeout(() => this.botStep(), ms);
    }

    /** Back to the last decision of a human (the bots' answers in between go too). */
    undo() {
        if (!this.canUndo()) {
            return this.toast(this.mail && this.session.canUndo
                ? 'No se puede deshacer lo que ya has enviado o recibido del rival.'
                : 'No se puede deshacer más: la última decisión tiró dados, robó o barajó.');
        }
        clearTimeout(this.timer);
        this.stopPlayback();
        this.session.undo(1);
        this.quiet = true;
        while (this.canUndo() && this.g.pending && (this.isBot(this.g.pending.side) || this.isRemote(this.g.pending.side))) this.session.undo(1);
        this.paused = SIDES.some((s) => this.isBot(s));
        this.error = null;
        this.selection.clear();
        this.opts.save(this.session, this.players);
        this.render();
    }

    setPlayer(side, kind) {
        this.players[side] = kind;
        this.makeBots();
        this.opts.save(this.session, this.players);
        this.render();
    }

    toast(text) {
        const t = h('div.toast', { role: 'status' }, text);
        document.body.append(t);
        setTimeout(() => t.remove(), 3800);
    }

    // ------------------------------------------------------------ render

    render() {
        const logScroll = this.root.querySelector('.log');
        const atBottom = !logScroll || logScroll.scrollTop + logScroll.clientHeight >= logScroll.scrollHeight - 30;
        this.preview.classList.remove('show');
        if (this.needsHandoff()) {
            this.root.replaceChildren(this.handoffScreen());
            return;
        }
        this.root.replaceChildren(h(
            'div.game', null,
            this.topbar(),
            h('main.main', null, this.mapView(), this.armies(), this.commanders()),
            h('aside.side', null, this.decisionPanel(), h('div.side-scroll', null, this.playersPanel(), this.marketPanel(), this.logPanel())),
        ));
        const log = this.root.querySelector('.log');
        if (log && atBottom) log.scrollTop = log.scrollHeight;
        // what changed since the last state drawn moves on the map (not after undoing or rewinding)
        const shown = snapshot(this.g);
        if (!this.quiet) animateBoard(this.root, this.shown, shown);
        this.shown = shown;
        this.quiet = false;
        this.scheduleNext();
    }

    handoffScreen() {
        const side = this.session.state.pending.side;
        return h(
            'div.handoff', null,
            h(`div.handoff-card.${CODE[side]}`, null,
                h('p.kicker', null, 'Partida a dos en la misma pantalla'),
                h('h1', null, `Le toca decidir al ${SIDE_NAME[side]}`),
                h('p', null, 'Pasa el dispositivo. La pantalla muestra la mano del jugador que decide.'),
                h('button.primary', {
                    onclick: () => {
                        this.shownSide = side;
                        this.render();
                    },
                }, `Soy el ${SIDE_NAME[side]}: continuar`),
                h('p.hint', null, h('label', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => this.setUi('handoff', e.target.checked) }), ' Avisar en cada cambio de jugador'))),
        );
    }

    topbar() {
        const g = this.g;
        const pend = g.pending;
        const botsExist = SIDES.some((s) => this.isBot(s));
        const botTurn = pend && this.isBot(pend.side) && !this.session.over;
        const sel = (key, list, title) => h('select', { title, onchange: (e) => this.setUi(key, e.target.value) },
            list.map(([v, l]) => h('option', { value: v, selected: v === this.ui[key] }, l)));
        const speedSel = sel('speed', BOT_SPEEDS.map(([v, l]) => [v, `Bots: ${l.toLowerCase()}`]), 'Velocidad de los bots');
        return h(
            'header.topbar', null,
            h('span.brand', null, 'Elviña 1809'),
            h('span.pill', null, `Ronda ${g.roundNo} · turno ${g.turnNo}`),
            g.turnNo > 0 && h(`span.pill.${CODE[g.active]}`, null, `Turno ${SIDE_TITLE[g.active].toLowerCase()}`),
            ...SIDES.map((s) => h(`span.pill.${CODE[s]}`, { title: `Cubos de Inercia del ${SIDE_NAME[s]} · ${streakHint(g.players[s])}`, dataset: { side: s } }, `${SIDE_TITLE[s]}: ${g.players[s].cubes} cubos `, streakView(g.players[s], 4))),
            h('span.pill.gold', { title: 'Reserva común de cubos de Inercia' }, `Reserva ${g.supply ?? '∞'}`),
            h('span.pill', { title: 'Divisiones eliminadas (2 = derrota)' }, `Bajas de División: FR ${eliminatedOf(g, 'french').length} · GB ${eliminatedOf(g, 'british').length}`),
            h('span.spacer'),
            this.mail && h(`span.pill.mail${this.live && !this.online ? '.off' : ''}`, { title: this.live ? 'Partida en directo: cada jugada llega al momento mientras estéis conectados' : 'Cada vez que le toque al rival, envíale el enlace de la partida' },
                `${this.live ? `En directo · ${this.online ? 'conectado' : 'sin conexión'}` : 'Por correspondencia'} · llevas el ${SIDE_NAME[enemyOf(this.mail)]}`),
            h('button.small', { onclick: () => this.undo(), disabled: !this.canUndo(), title: 'Ctrl+Z' }, '↶ Deshacer'),
            botsExist && h('button.small', {
                onclick: () => {
                    this.paused = !this.paused;
                    this.render();
                },
            }, this.paused ? '▶ Seguir bots' : '⏸ Pausar bots'),
            botTurn && !this.playback && (this.paused || this.ui.speed === 'step') && h('button.small', { onclick: () => this.botStep() }, 'Paso del bot'),
            botsExist && speedSel,
            sel('replay', REPLAYS, 'Cómo se repite lo que pasa en cada decisión'),
            sel('auto', AUTO, 'Preguntas rutinarias que se responden solas'),
            sel('dice', DICE, 'Lanzar los dados en 3D sobre el mapa'),
            sel('scenes', SCENES, 'Escena animada de cada combate antes de mover las fichas'),
            sel('sound', SOUND, 'Sonidos de batalla de las escenas de combate'),
            h('button.small', { onclick: () => this.copyCode() }, 'Copiar código'),
            rulesLink('.small'),
            !this.mail && h('button.small', { onclick: () => this.openDebug() }, 'Depuración'), // it shows hidden cards
            h('button.small', { onclick: () => this.opts.onExit() }, 'Menú'),
        );
    }

    // ------------------------------------------------------------ map

    /** Options of the pending decision that point at `ref`. */
    optionsFor(ref) {
        const p = this.g.pending;
        if (!p || p.type !== 'choose' || this.isBot(p.side)) return [];
        return p.options.filter((o) => o.ref === ref);
    }

    /** Marks an element as an answer when exactly one option points at `ref`. */
    clickable(el, ref, { zoom = true } = {}) {
        const opts = this.optionsFor(ref);
        if (opts.length === 1) {
            el.classList.add('option');
            el.title = opts[0].label;
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.act(opts[0].id);
            });
        } else if (zoom) {
            el.addEventListener('click', () => this.zoomRef(ref));
        }
        this.hover(el, ref);
        return el;
    }

    hover(el, ref) {
        const img = refImage(ref);
        if (!img) return el;
        el.addEventListener('mouseenter', (e) => this.showPreview(e, img));
        el.addEventListener('mousemove', (e) => this.placePreview(e));
        el.addEventListener('mouseleave', () => this.preview.classList.remove('show'));
        return el;
    }

    showPreview(e, img) {
        // an open modal dialog sits in the browser's top layer, above any z-index: the preview goes inside it
        const host = this.dialog.open ? this.dialog : document.body;
        if (this.preview.parentNode !== host) host.append(this.preview);
        this.preview.replaceChildren(h('img', { src: img.src, alt: '' }), ...(img.text ? [h('p', null, img.text)] : [])); // replaceChildren would print «undefined»
        this.preview.classList.toggle('wide', Boolean(img.wide));
        this.preview.classList.add('show');
        this.placePreview(e);
    }

    placePreview(e) {
        const r = this.preview.getBoundingClientRect();
        const x = e.clientX + 18 + r.width > innerWidth ? e.clientX - r.width - 18 : e.clientX + 18;
        const y = Math.min(Math.max(8, e.clientY - r.height / 2), innerHeight - r.height - 8);
        this.preview.style.left = `${x}px`;
        this.preview.style.top = `${y}px`;
    }

    mapView() {
        const g = this.g;
        const c = g.combat;
        const focus = new Set(c ? [c.attacker, c.target] : []);
        const items = [];
        for (const id of Object.keys(UNITS)) {
            const u = UNITS[id];
            const st = g.units[id];
            const side = CODE[u.side];
            let slots = BOARD.slots[id];
            if (id === 'paget') {
                const other = st.pos === 1 ? 2 : 1;
                for (const b of slots[other]) items.push(h('div.slot.lost', { style: at(center(b)) }));
                slots = slots[st.pos];
            }
            const out = st.status !== 'in';
            slots.forEach((b, i) => {
                const cls = out ? '.gone' : i < st.blocks ? `.${side}` : '.lost';
                const dataset = !out && i < st.blocks ? { unit: id, i } : null; // the pieces anim.js moves
                items.push(h(`div.slot${cls}${u.type === 'artillery' ? '.disc' : ''}`, { style: at(center(b)), title: u.name, dataset }));
            });
            const top = slots.reduce((m, b) => Math.min(m, b[1]), Infinity);
            const xs = slots.flatMap((b) => [b[0], b[2]]);
            // name, dice it rolls now (pieces are the tokens themselves) and morale
            const fights = !out && u.type !== 'reserve';
            const info = fights ? diceInfo(g, id) : null;
            const tagBody = out
                ? `${u.name}: ${st.status === 'routed' ? 'desbandada' : 'destruida'}`
                : [`${u.name} `, info && diceChip(info.n, info.changed), st.morale !== null && ` ${st.morale}♥`];
            const tag = h(`div.unit-tag.${side}${out ? '.out' : ''}${focus.has(id) ? '.focus' : ''}`, { style: at([(Math.min(...xs) + Math.max(...xs)) / 2, top - 20]), title: info?.text ?? null, dataset: { unit: id } }, tagBody);
            items.push(this.clickable(tag, id));
        }
        // casualty tracks on the edges: the markers each side has lost, kept by the other (§4.4)
        for (const [victim, cells] of Object.entries(BOARD.casualties)) {
            const taker = enemyOf(victim);
            const n = g.players[taker].casualties;
            const groups = CASUALTY_GROUPS[victim];
            const title = `Bajas ${victim === 'french' ? 'francesas' : 'británicas'}: ${n}. ${CASUALTY_HINT[victim]}`;
            cells.forEach((b, i) => {
                if (i >= n) return;
                const step = (i + 1) % groups === 0; // the last cell of a group: a threshold reached
                items.push(h(`div.slot.cas.${CODE[victim]}${step ? '.step' : ''}`, { style: at(center(b)), title, dataset: { cas: victim, i } }));
            });
            if (n > cells.length) {
                const last = cells.at(-1);
                items.push(h(`div.cas-more.${CODE[victim]}`, { style: at([center(last)[0], last[3] + 90]), title }, `+${n - cells.length}`));
            }
        }
        for (const [loc, l] of Object.entries(LOCATIONS)) {
            const owner = g.locations[loc];
            const el = h(`div.ctrl.${CODE[owner]}${focus.has(loc) ? '.focus' : ''}`, { style: at(l.center), title: `${l.name}: ${SIDE_NAME[owner]}`, dataset: { loc } });
            items.push(this.clickable(el, loc, { zoom: false }));
        }
        // Moore: his marker, and the positions he can ride to when that is the question
        const p = g.pending;
        if (p?.kind === 'moore_move' && !this.isBot('british')) {
            for (const o of p.options) {
                if (!BOARD.moore[o.id]) continue;
                const spot = h('div.moore-spot.option', { style: at(center(BOARD.moore[o.id])), title: o.label, onclick: () => this.act(o.id) });
                items.push(spot);
            }
        }
        if (g.moore.status === 'active' || g.moore.status === 'dying') {
            items.push(this.hover(h(`div.moore${g.moore.status === 'dying' ? '.dying' : ''}`, {
                style: at(center(BOARD.moore[g.moore.pos])),
                title: `Moore en #${g.moore.pos} · Senda del Sacrificio ${g.moore.track}${g.moore.status === 'dying' ? ' · abatido' : ''}`,
                onclick: () => this.zoomRef('moore'),
            }, h('img', { src: 'assets/icons/horse.webp', alt: '' }), h('b', null, g.moore.status === 'dying' ? '†' : g.moore.track)), 'moore'));
        }
        const note = p?.kind === 'moore_move' ? 'Elige en el mapa adónde cabalga Moore' : null;
        return h('div.map', { style: { backgroundImage: `url(${BOARD.image})` } }, items, note && h('div.map-note', null, note));
    }

    // ------------------------------------------------------------ armies and commanders

    armies() {
        const g = this.g;
        const col = (side) => h(
            'section.panel.army', null,
            h('h2', null, h(`span.${CODE[side]}`, null, side === 'french' ? 'Ejército francés' : 'Ejército británico'), h('small', null, `${g.players[side].casualties} bajas enemigas en su contador`)),
            unitsOf(side).map((id) => this.unitRow(id)),
        );
        return h('div.armies', null, col('french'), col('british'));
    }

    unitRow(id) {
        const g = this.g;
        const u = UNITS[id];
        const st = g.units[id];
        const c = g.combat;
        const info = st.status === 'in' && u.type !== 'reserve' ? diceInfo(g, id) : null;
        const name = h('span.name', { onclick: () => this.zoomRef(id), title: info?.text ?? null }, u.name,
            h('small', null, info ? [diceChip(info.n, info.changed), info.changed ? ` dados (tarjeta ${u.dice})` : ' dados'] : u.type === 'reserve' ? 'no combate' : '—'));
        this.hover(name, id);
        const morale = st.morale === null
            ? h('span.muted', null, 'sin moral · no combate')
            : h('div.morale', { title: `Moral ${st.morale}/${u.morale.max}` }, Array.from({ length: u.morale.max + 1 }, (_, v) => h(`b${v === st.morale ? '.on' : ''}${v <= 5 ? '.test' : ''}`, null, v)));
        const status = st.status === 'in' ? `${st.blocks}▮` : st.status === 'routed' ? 'Desbandada' : 'Destruida';
        const row = h(`div.unit-row${st.status !== 'in' ? '.out' : ''}${c && (c.attacker === id || c.target === id) ? '.focus' : ''}`, { dataset: { unit: id } }, name, morale, h('span.blocks', null, status));
        const opts = this.optionsFor(id);
        if (opts.length === 1) {
            row.classList.add('option');
            row.title = opts[0].label;
            row.addEventListener('click', () => this.act(opts[0].id));
        }
        return row;
    }

    commanders() {
        const g = this.g;
        const m = g.moore;
        const status = { active: `en la posición #${m.pos}`, dying: `abatido en #${m.pos}: se retira al final del turno británico`, dead: 'muerto' }[m.status];
        const moore = h(
            'section.panel', null,
            h('h2', null, h('span.gb', null, 'Sir John Moore'), h('small', null, status)),
            h('div.path', { title: 'Senda del Sacrificio: por encima de 2, cada avance pide una tirada de riesgo' }, Array.from({ length: 12 }, (_, i) => h(`b${i + 1 === m.track ? '.on' : ''}${i + 1 > 2 ? '.risk' : ''}`, null, i + 1))),
        );
        this.hover(moore, 'moore');
        const soult = h(
            'section.panel', null,
            h('h2', null, h('span.fr', null, 'Mariscal Soult'), h('small', null, g.soult.used ? 'agotado' : 'disponible: doble activación o salvar de la desbandada (un uso)')),
        );
        this.hover(soult, 'soult');
        return h('div.commanders', null, soult, moore);
    }

    // ------------------------------------------------------------ side panel

    decisionPanel() {
        if (this.playback) return this.playbackPanel();
        const g = this.g;
        const p = g.pending;
        const out = [];
        const err = this.error ?? g.error;
        if (err) out.push(h('div.result.error', null, 'Error del motor: es un fallo. Deshaz para volver atrás o copia el código para reportarlo.', h('pre', null, err.stack ?? err.message)));
        if (g.result) {
            out.push(h(`div.result.${g.result.winner}`, null, `Gana el ${SIDE_NAME[g.result.winner]} en la ronda ${g.result.round}: ${g.result.reason}.`));
            if (this.mail) out.push(this.mailPanel(true));
            out.push(h('button.primary', { onclick: () => this.opts.onExit() }, 'Nueva partida'));
        }
        if (g.combat) out.push(this.combatBox());
        if (p && !this.session.over && !this.isBot(p.side)) out.push(this.summary());
        if (this.live && !this.online && !this.session.over) out.unshift(this.livePanel());
        if (p && !this.session.over && this.isRemote(p.side)) {
            if (this.online) out.push(h('div.mail', null, h(`span.who.${CODE[this.mail]}`, null, `Le toca al ${SIDE_NAME[this.mail]}`), h('p.bot-wait', null, 'Esperando su jugada: llegará al momento.')));
            else out.push(this.mailPanel(false));
            return h('section.decision', { 'aria-live': 'polite' }, out);
        }
        if (p && !this.session.over) {
            const bot = this.isBot(p.side);
            out.push(h(`span.who.${CODE[p.side]}${bot ? '.bot' : ''}`, null, `Decide: ${SIDE_TITLE[p.side]}`));
            out.push(h('p.prompt', null, p.prompt));
            if (bot) {
                out.push(h('p.bot-wait', null, this.paused || this.ui.speed === 'step' ? 'Bot en pausa: pulsa «Paso del bot» o «Seguir bots».' : 'El bot está pensando…'));
            } else if (p.type === 'choose') {
                out.push(h('div.opts', null, p.options.map((o) => {
                    // planning (not Soult's cards, which give no cubes): which card would complete the streak
                    const bonus = p.kind === 'play' && !p.prompt.startsWith('Soult') && ACTIONS[o.id] && givesBonus(g.players[p.side], o.id);
                    const b = h(`button${o.id === 'pass' || o.id === 'none' ? '.ghost' : ''}`, { onclick: () => this.act(o.id), title: o.hint ?? null }, o.label, bonus && h('b.bonus', null, ' +2 racha'));
                    return this.hover(b, o.ref);
                })));
            } else {
                const n = this.selection.size;
                out.push(h('p.muted', null, `Elige ${p.min === p.max ? p.min : `de ${p.min} a ${p.max}`} (${n} marcadas).`));
                const toggle = (id) => {
                    if (this.selection.has(id)) this.selection.delete(id);
                    else this.selection.add(id);
                    this.render();
                };
                // a choice among cards: the cards themselves, to click
                if (p.options.every((o) => ACTIONS[o.ref] || TACTICS[o.ref])) {
                    out.push(h('div.cards', null, p.options.map((o) => this.hover(h(`div.card${TACTICS[o.ref] ? '.tactic' : ''}.option${this.selection.has(o.id) ? '.selected' : ''}`, { title: o.label, onclick: () => toggle(o.id) },
                        h('img', { src: refImage(o.ref).src, alt: o.label })), o.ref))));
                }
                out.push(h('div.opts', null, p.options.map((o) => this.hover(h('label.opt-check', null, h('input', {
                    type: 'checkbox', checked: this.selection.has(o.id),
                    onchange: (e) => {
                        if (e.target.checked) this.selection.add(o.id);
                        else this.selection.delete(o.id);
                        this.render();
                    },
                }), h('span', null, o.label)), o.ref))));
                out.push(h('div.confirm', null, h('button.primary', { disabled: n < p.min || n > p.max, onclick: () => this.act([...this.selection]) }, 'Confirmar')));
            }
        }
        return h('section.decision', { 'aria-live': 'polite' }, out);
    }

    /** Correspondence: the rival has to decide (or see the end); the game travels as a link. */
    mailPanel(over) {
        const rival = SIDE_NAME[this.mail];
        return h(
            'div.mail', null,
            h(`span.who.${CODE[this.mail]}`, null, over ? 'Partida terminada' : `Le toca al ${rival}`),
            h('p', null, over ? `Envía la partida al ${rival} para que vea el final.` : `Envíale la partida: al abrir el enlace, seguirá desde aquí en su navegador.`),
            h('div.opts', null,
                navigator.share && h('button.primary', { onclick: () => this.shareLink('share') }, 'Compartir… (WhatsApp, Telegram…)'),
                h(`button${navigator.share ? '' : '.primary'}`, { onclick: () => this.shareLink('copy') }, 'Copiar enlace'),
                h('button', { onclick: () => this.shareLink('mail') }, 'Enviar por correo')),
            h('p.hint', null, 'Cuando te devuelva su enlace, ábrelo en este navegador y la partida seguirá donde la dejasteis. Lo enviado ya no se puede deshacer.'),
        );
    }

    /** Live and not connected: invite the rival, paste his reply, or send him yours. */
    livePanel() {
        const c = this.live;
        const state = c.link.state;
        const copy = async (text, what) => {
            try {
                await navigator.clipboard.writeText(text);
                this.toast(`${what} copiado.`);
            } catch {
                this.openDialog(what, h('textarea', { rows: 6, readonly: true }, text));
            }
        };
        const out = [h('span.who.live', null, 'Jugar en directo')];
        if (c.replyCode) {
            out.push(h('p', null, 'Envía este código de respuesta a tu rival (WhatsApp, correo…). Cuando lo pegue en su partida, os conectaréis.'),
                h('textarea.code', { rows: 3, readonly: true, onclick: (e) => e.target.select() }, c.replyCode),
                h('div.opts', null, h('button.primary', { onclick: () => copy(c.replyCode, 'Código de respuesta') }, 'Copiar código de respuesta')));
        } else if (c.inviteLink) {
            const box = h('textarea.code', { rows: 3, placeholder: 'Pega aquí el código de respuesta de tu rival (E18R.…)' });
            out.push(h('p', null, '1. Envía la invitación a tu rival. 2. Él te devolverá un código de respuesta: pégalo aquí. No cierres esta pestaña mientras tanto.'),
                h('div.opts', null,
                    navigator.share && h('button', { onclick: () => navigator.share({ title: 'Elviña 1809', text: 'Te invito a una partida de Elviña 1809 en directo.', url: c.inviteLink }).catch(() => {}) }, 'Compartir invitación…'),
                    h('button', { onclick: () => copy(c.inviteLink, 'Enlace de invitación') }, 'Copiar invitación')),
                box,
                h('div.opts', null, h('button.primary', {
                    onclick: () => c.complete(box.value).catch((err) => this.toast(`Ese código no sirve: ${err.message}`)),
                }, 'Conectar')));
        } else {
            out.push(h('p', null, state === 'failed' ? 'No se pudo conectar. Vuelve a invitar a tu rival, o seguid por enlaces.' : state === 'closed' ? 'Se cortó la conexión. Vuelve a invitar a tu rival para seguir en directo, o seguid por enlaces.' : 'Invita a tu rival: os conectáis una vez y cada jugada llega al momento.'),
                h('div.opts', null, h('button.primary', { onclick: () => c.invite().catch((err) => this.toast(`No se pudo crear la invitación: ${err.message}`)) }, 'Invitar a tu rival')));
        }
        if (state === 'connecting') out.push(h('p.bot-wait', null, 'Conectando…'));
        return h('div.live', null, out);
    }

    async shareLink(how) {
        const code = await encodeRecord(makeRecord(this.session, this.opts.build));
        const url = `${location.origin}${location.pathname}#${code}`;
        const text = this.session.over
            ? `Elviña 1809: la partida ha terminado (ronda ${this.session.state.roundNo}).`
            : `Elviña 1809, ronda ${this.session.state.roundNo}: te toca a ti (${SIDE_NAME[this.mail]}).`;
        this.mailFloor = this.session.answers.length; // what has been sent cannot be undone
        try {
            if (how === 'share') await navigator.share({ title: 'Elviña 1809', text, url });
            else if (how === 'mail') location.href = `mailto:?subject=${encodeURIComponent('Elviña 1809: te toca')}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
            else {
                await navigator.clipboard.writeText(url);
                this.toast('Enlace copiado: pégalo en WhatsApp, Telegram o un correo.');
            }
        } catch (err) {
            if (err.name !== 'AbortError') this.openDialog('Enlace de la partida', h('p', null, text), h('textarea', { rows: 6, readonly: true }, url));
        }
        this.render();
    }

    /** One step of the replay: what happened, the dice, and buttons to go on. */
    playbackPanel() {
        const pb = this.playback;
        const f = pb.frames[pb.i];
        const g = this.g;
        const side = f.beat.side ?? g.active;
        return h(
            'section.decision', { 'aria-live': 'polite' },
            h(`span.who.${CODE[side]}`, null, pb.diceOnly ? 'Dados' : `Repetición ${pb.i + 1}/${pb.frames.length}`),
            h('p.prompt', null, pb.rolling ? 'Tirando los dados… (un toque o Intro para verlos ya)' : beatText(f.beat)),
            g.combat && this.combatBox(),
            h('div.confirm', null,
                h('button.primary', { onclick: () => this.nextStep() }, pb.i + 1 < pb.frames.length ? 'Siguiente' : 'Terminar'),
                h('button.ghost', { onclick: () => this.endPlayback() }, 'Saltar la repetición')),
        );
    }

    /** What happened since the last decision of a human (the bot's turn, the results of his answer). */
    summary() {
        const lines = this.session.state.log.slice(this.mark).filter((l) => l.kind !== 'phase' || l.text.startsWith('Ronda'));
        if (!lines.length) return null;
        return h('details.summary', { open: true },
            h('summary', null, `Lo que acaba de pasar (${lines.length})`),
            h('div.log', null, lines.slice(-30).map((l) => h(`p.${l.kind}`, null, l.text))));
    }

    combatBox() {
        const c = this.g.combat;
        const lines = [h('p.combat-line', null, h('b', null, UNITS[c.attacker].name), ` ataca a ${UNITS[c.target]?.name ?? LOCATIONS[c.target].name}`)];
        if (c.dice.length) {
            const count = [0, 0, 0, 0, 0, 0, 0];
            for (const d of c.dice) count[d.v]++;
            const art = c.attacker === 'artilleria';
            const cls = (v) => (count[v] < 2 ? '' : v >= 4 || (art && v === 1) ? '.pair-good' : v <= 2 && !(art && v === 2) ? '.pair-bad' : '');
            // choosing dice (to reroll, Voluntad, Avanzadillas): the dice themselves are the options
            const p = this.g.pending;
            const human = p && !this.isBot(p.side);
            const pickDice = human && p.kind === 'reroll_dice';
            const oneDie = human && p.kind === 'die_pick';
            lines.push(h('div.dice', null, c.dice.map((d, i) => {
                const id = String(i);
                const can = (pickDice || oneDie) && p.options.some((o) => o.id === id);
                const hidden = !d.fixed && (this.diceHidden === 'all' || this.diceHidden?.has(id));
                if (hidden) return h('span.die.rolling', null, '?');
                const el = h(`span.die${d.fixed ? '.fixed' : ''}${d.v ? cls(d.v) : ''}${can ? '.option' : ''}${pickDice && this.selection.has(id) ? '.selected' : ''}`, { title: d.fixed ? '6 fijo (Brigadas de élite)' : can ? 'Clic para elegir este dado' : null }, d.v || '?');
                if (can) {
                    el.addEventListener('click', () => {
                        if (oneDie) return this.act(id);
                        if (this.selection.has(id)) this.selection.delete(id);
                        else this.selection.add(id);
                        this.render();
                    });
                }
                return el;
            })));
            if (c.rolls && !this.diceHidden) lines.push(h('p.combat-line', null, `${c.rolls === 1 ? 'Primera tirada' : `Tirada ${c.rolls}`}: ${describe(currentResults(c))}`));
        }
        const extras = [c.extraDice && `${c.extraDice > 0 ? '+' : ''}${c.extraDice} dados extra`, c.mooreReroll && 'relanzamiento gratuito de Moore', c.calen && '¡Calen bayonetas! disponible', c.veteranos && 'Veteranos de Iberia', c.vacilacion && 'Vacilación'].filter(Boolean);
        if (extras.length) lines.push(h('p.combat-line.muted', null, extras.join(' · ')));
        return h('div.panel', { style: { marginBottom: '10px' } }, lines);
    }

    playersPanel() {
        return SIDES.map((side) => this.playerPanel(side));
    }

    playerPanel(side) {
        const g = this.g;
        const p = g.players[side];
        const visible = this.handVisible(side);
        const pend = g.pending;
        const handCards = p.hand.map((id) => {
            if (!visible) return h('img', { src: ACTION_BACKS[side], alt: 'carta oculta' });
            const opts = this.optionsFor(id);
            const el = h(`div.card${opts.length === 1 ? '.option' : ''}`, { title: cardLabel(id) }, h('img', { src: ACTIONS[id].image, alt: cardLabel(id) }), givesBonus(p, id) && h('span.badge', { title: streakHint(p) }, '+2'));
            if (opts.length === 1) el.addEventListener('click', () => this.act(opts[0].id));
            return this.hover(el, id);
        });
        const limbo = visible && p.limbo.length > 0 && h('p.muted', null, `En juego: ${p.limbo.map(cardLabel).join(', ')}`);
        const tactics = p.tactics.map((id) => {
            const locked = p.locked[id] === g.turnNo;
            const el = h(`div.card.tactic${this.optionsFor(id).length === 1 ? '.option' : ''}`, null, h('img', { src: TACTICS[id].image, alt: TACTICS[id].name }), TACTICS[id].permanent && h('span.badge', null, 'P'), locked && h('span.locked', null, 'este turno no'));
            const opts = this.optionsFor(id);
            if (opts.length === 1 && pend?.kind === 'tactic') el.addEventListener('click', () => this.act(opts[0].id));
            return this.hover(el, id);
        });
        const who = this.mail
            ? h('small.muted', null, this.isRemote(side) ? 'Rival por correspondencia' : 'Tú')
            : h('select', { onchange: (e) => this.setPlayer(side, e.target.value), title: 'Quién juega este bando' },
                [['human', 'Humano'], ['greedy', 'Bot codicioso'], ['random', 'Bot aleatorio']].map(([v, l]) => h('option', { value: v, selected: this.players[side] === v }, l)));
        return h(
            'section.panel', null,
            h('h2', null, h(`span.${CODE[side]}`, null, SIDE_TITLE[side]), h('small', null, `${p.cubes} cubos · mazo ${p.deck.length} · descarte ${p.discard.length}`), who),
            h('p.kicker', null, `Cartas jugadas (${p.streak.length})`),
            h('div.streak-row', null, streakView(p, 0, true), h('p.hint', null, streakHint(p))),
            h('p.kicker', null, `Mano (${p.hand.length})`),
            h(visible ? 'div.cards' : 'div.hand-hidden', null, handCards.length ? handCards : h('span.empty', null, 'Sin cartas')),
            limbo,
            h('p.kicker', { style: { marginTop: '10px' } }, `Tácticas (${p.tactics.length})`),
            h('div.cards', null, tactics.length ? tactics : h('span.empty', null, 'Ninguna')),
        );
    }

    marketPanel() {
        const m = this.g.market;
        const row = m.row.map((slot, i) => {
            const opts = this.g.pending?.options?.filter((o) => o.id === `buy:${i}`) ?? [];
            const human = this.g.pending && !this.isBot(this.g.pending.side);
            const el = h(`div.card.tactic${opts.length && human ? '.option' : ''}`, null, h('img', { src: TACTICS[slot.id].image, alt: TACTICS[slot.id].name }), slot.cubes > 0 && h('span.slot-cubes', null, `+${slot.cubes}`));
            if (opts.length && human) el.addEventListener('click', () => this.act(opts[0].id));
            return this.hover(el, slot.id);
        });
        return h(
            'section.panel.market', null,
            h('h2', null, 'Mercado de Táctica', h('small', null, `mazo ${m.deck.length} · descarte ${m.discard.length} · se descarta la de la derecha`)),
            h('div.cards', null, row.length ? row : h('span.empty', null, 'Vacío')),
            m.discard.length > 0 && h('p', null, h('button.small', { onclick: () => this.showTactics('Descarte del Mercado', m.discard) }, 'Ver descarte')),
        );
    }

    logPanel() {
        return h('section.panel', null, h('h2', null, 'Registro'), h('div.log', null, this.g.log.map((l) => h(`p.${l.kind}`, null, l.text))));
    }

    // ------------------------------------------------------------ dialogs

    openDialog(title, ...body) {
        this.dialog.replaceChildren(
            h('div.dialog-head', null, h('h2', null, title), h('button.small', { onclick: () => this.dialog.close() }, 'Cerrar')),
            h('div.dialog-body', null, body),
        );
        if (!this.dialog.open) this.dialog.showModal();
    }

    zoomRef(ref) {
        const img = refImage(ref);
        if (!img) return;
        this.openDialog(UNITS[ref]?.name ?? COMMANDERS[ref]?.name ?? TACTICS[ref]?.name ?? cardLabel(ref), h('img.zoom-img', { src: img.src, alt: '' }));
    }

    showTactics(title, ids) {
        this.openDialog(title, h('div.cards', null, [...ids].reverse().map((id) => this.hover(h('div.card.tactic', null, h('img', { src: TACTICS[id].image, alt: TACTICS[id].name })), id))));
    }

    async copyCode() {
        const code = await encodeRecord(makeRecord(this.session, this.opts.build));
        try {
            await navigator.clipboard.writeText(code);
            this.toast(`Código copiado (${this.session.answers.length} decisiones). Pégalo en «Cargar un código» o en tools/replay.mjs.`);
        } catch {
            this.openDialog('Código de la partida', h('textarea', { rows: 6, readonly: true }, code));
        }
    }

    openDebug() {
        const g = this.g;
        const trail = this.session.trail.map((t, i) => h('button.ghost', {
            title: 'Volver a antes de esta decisión',
            onclick: () => {
                this.session.rewindTo(i);
                this.quiet = true;
                this.paused = SIDES.some((s) => this.isBot(s));
                this.dialog.close();
                this.render();
            },
        }, `${i + 1}. R${t.round} ${t.side === 'french' ? 'FR' : 'GB'} · ${t.prompt} → ${t.answer}`));
        const decks = SIDES.map((s) => h('p', null, h('b', null, `Mazo ${SIDE_NAME[s]} (de arriba abajo): `), g.players[s].deck.map(cardLabel).join(' · ') || '—'));
        this.openDialog(
            'Depuración',
            h('p', null,
                h('label.opt-check', null, h('input', {
                    type: 'checkbox', checked: this.revealAll,
                    onchange: (e) => {
                        this.revealAll = e.target.checked;
                        this.render();
                    },
                }), 'Ver las dos manos')),
            h('p.muted', null, `Semilla ${this.session.setup.seed} · reglas ${JSON.stringify(this.session.setup.rules)}`),
            Object.keys(this.session.setup.scenario ?? {}).length > 0 && h('p.muted', null, `Escenario ${JSON.stringify(this.session.setup.scenario)}`),
            decks,
            h('p', null, h('b', null, 'Mazo de Táctica: '), g.market.deck.map((id) => TACTICS[id].name).join(' · ') || '—'),
            h('p.kicker', null, `Decisiones (${trail.length}) · clic para volver a antes de una`),
            h('div.trail', null, trail),
            h('details', null, h('summary', null, 'Estado completo (JSON)'), h('pre', null, JSON.stringify({ ...g, log: undefined, pending: g.pending }, null, 1))),
        );
    }
}
