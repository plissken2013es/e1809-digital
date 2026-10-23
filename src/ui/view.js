// Game screen: the illustrated map with its tokens, the armies, hands, tactics
// and market, the pending decision (with the dice of the combat in course), the
// log and the debug tools. It re-renders everything after each answer: the
// state is small and the engine is the single source of truth.

import { h } from './dom.js';
import {
    UNITS, COMMANDERS, ACTIONS, TACTICS, BOARD, LOCATIONS, unitsOf, SIDE_NAME, currentResults, describe,
    cardLabel, makeRecord, encodeRecord, IllegalAction, eliminatedOf,
} from '../engine/index.js';
import { createGreedyBot } from '../ai/greedyBot.js';
import { createRandomBot } from '../ai/randomBot.js';
import { BOT_SPEEDS } from './setup.js';

const BOT_MS = { fast: 80, normal: 450, slow: 1300, step: null };
const [W, H] = BOARD.size;
const SIDES = ['french', 'british'];
const CODE = { french: 'fr', british: 'gb' };
const SIDE_TITLE = { french: 'Francés', british: 'Británico' };

const at = ([x, y]) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

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
     * @param {{ build: string, players: Record<string, string>, speed?: string, notice?: string, onExit: Function, save: Function, saveSpeed?: Function }} opts
     */
    constructor(root, session, opts) {
        this.root = root;
        this.session = session;
        this.opts = opts;
        this.players = { french: 'human', british: 'human', ...opts.players };
        this.speed = BOT_MS[opts.speed] !== undefined ? opts.speed : 'normal';
        this.paused = false;
        this.revealAll = false;
        this.selection = new Set();
        this.error = null;
        this.timer = null;
        this.makeBots();
        this.preview = h('div.preview');
        this.dialog = h('dialog');
        document.body.append(this.preview, this.dialog);
        this.onKey = (e) => {
            if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.target.closest('input, textarea')) {
                e.preventDefault();
                this.undo();
            }
        };
        document.addEventListener('keydown', this.onKey);
        this.render();
        if (opts.notice) this.toast(opts.notice);
    }

    makeBots() {
        const seed = `${this.session.setup.seed}-${this.session.answers.length}`;
        const make = (kind, side) => kind === 'greedy' ? createGreedyBot(`${seed}-${side}`, () => this.session.state) : createRandomBot(`${seed}-${side}`);
        this.bots = Object.fromEntries(SIDES.map((s) => [s, this.players[s] === 'human' ? null : make(this.players[s], s)]));
    }

    dispose() {
        clearTimeout(this.timer);
        document.removeEventListener('keydown', this.onKey);
        this.preview.remove();
        this.dialog.remove();
    }

    get g() {
        return this.session.state;
    }

    isBot(side) {
        return Boolean(this.bots[side]);
    }

    /** Whose hand is face up: the humans' (only the one deciding when both are human); all with "show hands". */
    handVisible(side) {
        if (this.revealAll) return true;
        const humans = SIDES.filter((s) => !this.isBot(s));
        if (!humans.length) return true;
        if (humans.length === 1) return humans[0] === side;
        return this.g.pending?.side === side;
    }

    // ------------------------------------------------------------ actions

    act(answer) {
        clearTimeout(this.timer);
        try {
            this.session.act(answer);
            this.error = null;
        } catch (err) {
            if (err instanceof IllegalAction) return this.toast(err.message);
            this.error = err;
            console.error(err);
        }
        this.selection.clear();
        this.opts.save(this.session, this.players);
        this.render();
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

    scheduleBot() {
        clearTimeout(this.timer);
        const p = this.g.pending;
        if (!p || this.session.over || this.error || this.paused || !this.isBot(p.side)) return;
        const ms = BOT_MS[this.speed];
        if (ms == null) return;
        this.timer = setTimeout(() => this.botStep(), ms);
    }

    /** Back to the last decision of a human (the bots' answers in between go too). */
    undo() {
        if (!this.session.canUndo) return this.toast('No se puede deshacer más: la última decisión tiró dados, robó o barajó.');
        clearTimeout(this.timer);
        this.session.undo(1);
        while (this.session.canUndo && this.g.pending && this.isBot(this.g.pending.side)) this.session.undo(1);
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
        this.root.replaceChildren(h(
            'div.game', null,
            this.topbar(),
            h('main.main', null, this.mapView(), this.armies(), this.commanders()),
            h('aside.side', null, this.decisionPanel(), h('div.side-scroll', null, this.playersPanel(), this.marketPanel(), this.logPanel())),
        ));
        const log = this.root.querySelector('.log');
        if (log && atBottom) log.scrollTop = log.scrollHeight;
        this.scheduleBot();
    }

    topbar() {
        const g = this.g;
        const pend = g.pending;
        const botsExist = SIDES.some((s) => this.isBot(s));
        const botTurn = pend && this.isBot(pend.side) && !this.session.over;
        const speedSel = h('select', {
            title: 'Velocidad de los bots',
            onchange: (e) => {
                this.speed = e.target.value;
                this.opts.saveSpeed?.(this.speed);
                this.render();
            },
        }, BOT_SPEEDS.map(([v, l]) => h('option', { value: v, selected: v === this.speed }, l)));
        return h(
            'header.topbar', null,
            h('span.brand', null, 'Elviña 1809'),
            h('span.pill', null, `Ronda ${g.roundNo} · turno ${g.turnNo}`),
            g.turnNo > 0 && h(`span.pill.${CODE[g.active]}`, null, `Turno ${SIDE_TITLE[g.active].toLowerCase()}`),
            ...SIDES.map((s) => h(`span.pill.${CODE[s]}`, { title: `Cubos de Inercia del ${SIDE_NAME[s]}` }, `${SIDE_TITLE[s]}: ${g.players[s].cubes} cubos`)),
            h('span.pill.gold', { title: 'Reserva común de cubos de Inercia' }, `Reserva ${g.supply ?? '∞'}`),
            h('span.pill', { title: 'Divisiones eliminadas (2 = derrota)' }, `Bajas de División: FR ${eliminatedOf(g, 'french').length} · GB ${eliminatedOf(g, 'british').length}`),
            h('span.spacer'),
            h('button.small', { onclick: () => this.undo(), disabled: !this.session.canUndo, title: 'Ctrl+Z' }, '↶ Deshacer'),
            botsExist && h('button.small', {
                onclick: () => {
                    this.paused = !this.paused;
                    this.render();
                },
            }, this.paused ? '▶ Seguir bots' : '⏸ Pausar bots'),
            botTurn && (this.paused || this.speed === 'step') && h('button.small', { onclick: () => this.botStep() }, 'Paso del bot'),
            botsExist && speedSel,
            h('button.small', { onclick: () => this.copyCode() }, 'Copiar código'),
            h('button.small', { onclick: () => this.openDebug() }, 'Depuración'),
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
        this.preview.replaceChildren(h('img', { src: img.src, alt: '' }), img.text && h('p', null, img.text));
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
                items.push(h(`div.slot${cls}${u.type === 'artillery' ? '.disc' : ''}`, { style: at(center(b)), title: u.name }));
            });
            // reinforcements beyond the printed slots: extra pieces next to the last one
            for (let i = slots.length; i < st.blocks && !out; i++) {
                const [x, y] = center(slots[slots.length - 1]);
                items.push(h(`div.slot.${side}.extra`, { style: at([x + (i - slots.length + 1) * 110, y + (i - slots.length + 1) * 70]), title: `${u.name}: refuerzo` }));
            }
            const top = slots.reduce((m, b) => Math.min(m, b[1]), Infinity);
            const xs = slots.flatMap((b) => [b[0], b[2]]);
            const tagText = out ? `${u.name}: ${st.status === 'routed' ? 'desbandada' : 'destruida'}` : `${u.name} · ${st.blocks}▮${st.morale !== null ? ` · ${st.morale}♥` : ''}`;
            const tag = h(`div.unit-tag.${side}${out ? '.out' : ''}${focus.has(id) ? '.focus' : ''}`, { style: at([(Math.min(...xs) + Math.max(...xs)) / 2, top - 20]) }, tagText);
            items.push(this.clickable(tag, id));
        }
        for (const [loc, l] of Object.entries(LOCATIONS)) {
            const owner = g.locations[loc];
            const el = h(`div.ctrl.${CODE[owner]}${focus.has(loc) ? '.focus' : ''}`, { style: at(l.center), title: `${l.name}: ${SIDE_NAME[owner]}` });
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
            }, g.moore.status === 'dying' ? '†' : g.moore.track), 'moore'));
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
        const name = h('span.name', { onclick: () => this.zoomRef(id) }, u.name, h('small', null, `${u.dice} dados · ${u.activations} act.`));
        this.hover(name, id);
        const morale = st.morale === null
            ? h('span.muted', null, 'sin moral · no combate')
            : h('div.morale', { title: `Moral ${st.morale}/${u.morale.max}` }, Array.from({ length: u.morale.max + 1 }, (_, v) => h(`b${v === st.morale ? '.on' : ''}${v <= 5 ? '.test' : ''}`, null, v)));
        const status = st.status === 'in' ? `${st.blocks}▮` : st.status === 'routed' ? 'Desbandada' : 'Destruida';
        const row = h(`div.unit-row${st.status !== 'in' ? '.out' : ''}${c && (c.attacker === id || c.target === id) ? '.focus' : ''}`, null, name, morale, h('span.blocks', null, status));
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
        const g = this.g;
        const p = g.pending;
        const out = [];
        const err = this.error ?? g.error;
        if (err) out.push(h('div.result.error', null, 'Error del motor: es un fallo. Deshaz para volver atrás o copia el código para reportarlo.', h('pre', null, err.stack ?? err.message)));
        if (g.result) {
            out.push(h(`div.result.${g.result.winner}`, null, `Gana el ${SIDE_NAME[g.result.winner]} en la ronda ${g.result.round}: ${g.result.reason}.`));
            out.push(h('button.primary', { onclick: () => this.opts.onExit() }, 'Nueva partida'));
        }
        if (g.combat) out.push(this.combatBox());
        if (p && !this.session.over) {
            const bot = this.isBot(p.side);
            out.push(h(`span.who.${CODE[p.side]}${bot ? '.bot' : ''}`, null, `Decide: ${SIDE_TITLE[p.side]}`));
            out.push(h('p.prompt', null, p.prompt));
            if (bot) {
                out.push(h('p.bot-wait', null, this.paused || this.speed === 'step' ? 'Bot en pausa: pulsa «Paso del bot» o «Seguir bots».' : 'El bot está pensando…'));
            } else if (p.type === 'choose') {
                out.push(h('div.opts', null, p.options.map((o) => {
                    const b = h(`button${o.id === 'pass' || o.id === 'none' ? '.ghost' : ''}`, { onclick: () => this.act(o.id), title: o.hint ?? null }, o.label);
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
            if (c.rolls) lines.push(h('p.combat-line', null, `${c.rolls === 1 ? 'Primera tirada' : `Tirada ${c.rolls}`}: ${describe(currentResults(c))}`));
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
            if (!visible) return h('img', { src: ACTIONS[id].side === 'french' ? 'assets/cards/backs/action_french.webp' : 'assets/cards/backs/action_british.webp', alt: 'carta oculta' });
            const opts = this.optionsFor(id);
            const el = h(`div.card${opts.length === 1 ? '.option' : ''}`, { title: cardLabel(id) }, h('img', { src: ACTIONS[id].image, alt: cardLabel(id) }));
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
        const who = h('select', { onchange: (e) => this.setPlayer(side, e.target.value), title: 'Quién juega este bando' },
            [['human', 'Humano'], ['greedy', 'Bot codicioso'], ['random', 'Bot aleatorio']].map(([v, l]) => h('option', { value: v, selected: this.players[side] === v }, l)));
        return h(
            'section.panel', null,
            h('h2', null, h(`span.${CODE[side]}`, null, SIDE_TITLE[side]), h('small', null, `${p.cubes} cubos · racha ${p.streak.join('-') || '—'} · mazo ${p.deck.length} · descarte ${p.discard.length}`), who),
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
