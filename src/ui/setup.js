// Setup screen: who plays each side (human or bot), rules options (docs/01 §12),
// seed and a debug scenario. Also continues the saved game or loads an E18. code.

import { h } from './dom.js';
import { DEFAULT_SETUP, DEFAULT_RULES } from '../engine/index.js';

export const PLAYERS = [['human', 'Humano'], ['greedy', 'Bot codicioso'], ['random', 'Bot aleatorio']];
export const BOT_SPEEDS = [['fast', 'Rápida'], ['normal', 'Normal'], ['slow', 'Lenta'], ['step', 'Paso a paso (botón)']];

/** Rules options of docs/01 §12: [key, label, [[value, text], …]]. The first value is the default. */
const RULES = [
    ['bayonet', 'Bayoneta [D-1]', [['die', '±1 a un dado por combate'], ['none', 'Sin efecto']]],
    ['mooreRally', 'Arenga de Moore [D-2]', [['rulebook', 'Reglamento: 1 paso y sobrevivir'], ['card', 'Tarjeta: 2 pasos y 1d6 de 1–5']]],
    ['mooreUnderFire', 'Artillería contra Moore [D-8]', [['always', 'En todo combate'], ['influence', 'Solo si apoya al objetivo']]],
    ['reserveActivation', 'Activar la Reserva [D-17]', [['free', 'Gratis'], ['block', 'Retira 1 ficha']]],
    ['moraleTests', 'Tests de moral [D-15]', [['hit', 'Uno por golpe'], ['point', 'Uno por punto']]],
    ['minDice', 'Dados mínimos [D-21]', [['1', '1'], ['0', '0']]],
    ['inertiaSupply', 'Reserva de Inercia [D-24]', [['25', '25 cubos'], ['unlimited', 'Ilimitada']]],
    ['discardThreeTactics', 'Descartar 3 tácticas [D-30]', [['3', '3 cubos (v1.6c)'], ['2', '2 cubos (v2.1)']]],
];
const NUMERIC = new Set(['minDice', 'discardThreeTactics']);

const select = (name, value, options) =>
    h('select', { name }, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));

/** The rulebook (rules.html, tools/build_rules_page.py), in a new tab. */
export const rulesLink = (extra = '') => h(`a.button${extra}`, { href: 'rules.html', target: '_blank', rel: 'noopener', title: 'El reglamento v1.6c y las aclaraciones de la versión digital, en una pestaña nueva' }, '📖 Reglamento');

const field = (label, control, hint) => h('label.field', null, h('span', null, label), control, hint && h('p.hint', null, hint));

/**
 * @param {{ prefs: any, saved: any, onStart: Function, onContinue: Function, onLoadCode: Function }} o
 */
export function renderSetup(root, { prefs, saved, onStart, onContinue, onLoadCode }) {
    const p = prefs ?? {};
    const rules = { ...DEFAULT_RULES, ...p.setup?.rules };
    const players = { french: 'human', british: 'greedy', ...p.players };
    const err = h('p.error-text');
    const seed = h('input', { type: 'text', name: 'seed', value: p.setup?.seed ?? DEFAULT_SETUP.seed });
    const sc = p.setup?.scenario ?? {};
    const hasScenario = Object.keys(sc).length > 0;
    const scenario = h('textarea', { name: 'scenario', rows: 6, placeholder: '{ "hands": { "french": ["mermet-1", "merle-1", "delaborde-1"] }, "dice": [6, 6, 4, 4, 1] }' }, hasScenario ? JSON.stringify(sc, null, 1) : '');
    const code = h('textarea', { rows: 3, placeholder: 'E18.…' });
    const savedText = saved && `ronda ${saved.round}, ${saved.answers} decisiones`;
    const replaceSaved = () => !saved || confirm(`Esto sustituye la partida guardada (${savedText}). ¿Seguir?`);

    const form = h(
        'form.setup-card', {
            onsubmit: (e) => {
                e.preventDefault();
                const f = new FormData(form);
                let scenarioJson = {};
                try {
                    scenarioJson = f.get('scenario').trim() ? JSON.parse(f.get('scenario')) : {};
                } catch (ex) {
                    err.textContent = `El escenario no es JSON válido: ${ex.message}`;
                    return;
                }
                const r = {};
                for (const [key] of RULES) {
                    const v = f.get(key);
                    r[key] = NUMERIC.has(key) ? Number(v) : key === 'inertiaSupply' && v !== 'unlimited' ? Number(v) : v;
                }
                const setup = { seed: f.get('seed') || String(Date.now() % 100000), rules: r, scenario: scenarioJson };
                const who = { french: f.get('french'), british: f.get('british') };
                if (!replaceSaved()) return;
                try {
                    onStart(setup, who, f.get('speed'));
                } catch (ex) {
                    err.textContent = ex.message.startsWith('scenario:') ? `Escenario de depuración: ${ex.message.slice(10)}.` : ex.message;
                }
            },
        },
        h(
            'div.setup-head', null,
            h('img', { src: 'assets/cover.webp', alt: 'Portada de Elviña 1809' }),
            h(
                'div', null,
                h('p.kicker', null, 'Prototipo de reglas · v1.6c'),
                h('h1.title', null, 'Elviña 1809'),
                h('p.lede', null, 'A Coruña, 16 de enero de 1809. Moore defiende el embarque frente a Soult. Cada decisión queda grabada: cualquier partida se puede deshacer, repetir o compartir como código.'),
            ),
        ),
        saved && h('p', null, h('button.primary', { type: 'button', onclick: onContinue }, `Continuar la partida guardada (${savedText})`)),
        h(
            'div.setup-grid', null,
            field('Francés (Soult)', select('french', players.french, PLAYERS)),
            field('Británico (Moore)', select('british', players.british, PLAYERS)),
            field('Velocidad de los bots', select('speed', p.speed ?? 'normal', BOT_SPEEDS), 'También en la barra superior.'),
            field('Semilla', seed, 'Misma semilla + mismas decisiones = misma partida.'),
        ),
        h(
            'details', null,
            h('summary', null, 'Opciones de reglas (docs/01 §12)'),
            h('div.setup-grid', null, RULES.map(([key, label, opts]) => field(label, select(key, rules[key], opts)))),
        ),
        h(
            'details', { open: hasScenario },
            h('summary', null, hasScenario ? 'Escenario de depuración — ACTIVO (cambia la partida: vacíalo para jugar normal)' : 'Escenario de depuración'),
            h('p.hint', null, 'JSON aplicado tras barajar: hands, deckTop, discard, streak, units, locations, moore, soultUsed, cubes, tactics, market, marketDiscard, dice. Ver DEFAULT_SETUP en src/engine/game.js.'),
            scenario,
        ),
        h(
            'details', null,
            h('summary', null, 'Cargar un código de partida'),
            code,
            h('p', null, h('button', {
                type: 'button',
                onclick: async () => {
                    if (!code.value.trim() || !replaceSaved()) return;
                    const f = new FormData(form);
                    try {
                        await onLoadCode(code.value, { french: f.get('french'), british: f.get('british') }, f.get('speed'));
                    } catch (ex) {
                        err.textContent = ex.message;
                    }
                },
            }, 'Cargar y repetir')),
        ),
        err,
        h('div.actions', null, h('button.primary', { type: 'submit' }, 'Empezar la batalla'), h('button', { type: 'button', onclick: () => (seed.value = String(Math.floor(Math.random() * 1e6))) }, 'Semilla al azar'), rulesLink()),
    );
    root.replaceChildren(h('div.setup', null, form));
}
