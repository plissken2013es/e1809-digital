// Discreet animations of what changed on the board between two renders: the view
// repaints everything after each answer (and each replay step), so it keeps a
// snapshot of the last state drawn and, once the new one is on screen, animates the
// differences. Nothing here changes the game; everything lasts well under a second.
//
// - blocks lost: they fly from their slot to the casualty track on the map edge
// - blocks moved (reinforcements, Paget #1 → #2): they slide to their new slot
// - blocks back (Cirujanos): they pop in
// - morale: the marker slides along the unit's track, the row flashes, a «−1♥»
//   floats over the map label
// - Moore riding, his Path marker, his fall; a location changing hands; Inertia cubes

import { BOARD, UNITS, enemyOf } from '../engine/index.js';

export const MS = 650;
const [W, H] = BOARD.size;
const pct = ([x, y]) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const EASE = 'cubic-bezier(.45,.05,.3,1)';
const SIDE_CLASS = { french: 'fr', british: 'gb' };

/** What the animations compare. */
export function snapshot(g) {
    return {
        units: Object.fromEntries(Object.entries(g.units).map(([id, u]) => [id, { blocks: u.blocks, morale: u.morale, status: u.status, pos: u.pos }])),
        casualties: { french: g.players.french.casualties, british: g.players.british.casualties }, // kept by each side
        locations: { ...g.locations },
        moore: { pos: g.moore.pos, track: g.moore.track, status: g.moore.status },
        cubes: { french: g.players.french.cubes, british: g.players.british.cubes },
    };
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Centre of piece `i` of a unit (Paget: in the given position). */
function slotAt(id, i, pos) {
    const slots = id === 'paget' ? BOARD.slots.paget[pos] : BOARD.slots[id];
    return center(slots[Math.min(i, slots.length - 1)]);
}

/** Centre of cell `i` of the casualty track of `victim` (null past its end). */
function cellAt(victim, i) {
    const cells = BOARD.casualties[victim];
    return i < cells.length ? center(cells[i]) : null;
}

/** Animates on the new DOM (`root`) the changes from `prev` to `cur`. */
export function animateBoard(root, prev, cur) {
    if (!prev || reducedMotion()) return;
    const map = root.querySelector('.map');
    if (!map) return;
    blocks(map, prev, cur);
    morale(root, map, prev, cur);
    moore(root, map, prev, cur);
    locations(map, prev, cur);
    cubes(root, prev, cur);
}

// ------------------------------------------------------------------ blocks

/** A temporary piece flying from `from` to `to` (or fading where it was, if `to` is null). */
function ghost(map, cls, from, to, delay = 0) {
    const el = document.createElement('div');
    el.className = `slot ghost ${cls}`;
    Object.assign(el.style, pct(from));
    map.append(el);
    const keys = to
        ? [{ ...pct(from), transform: 'translate(-50%, -50%) scale(1)' }, { ...pct(to), transform: 'translate(-50%, -50%) scale(.8)' }]
        : [{ opacity: 1, transform: 'translate(-50%, -50%)' }, { opacity: 0, transform: 'translate(-50%, 20%) scale(.6)' }];
    const a = el.animate(keys, { duration: MS, delay, easing: EASE, fill: 'both' });
    a.onfinish = () => el.remove();
}

/** The real piece stays hidden while a ghost flies to it, then appears. */
function arriveLater(el, delay) {
    el?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.92 }, { opacity: 1 }], { duration: MS + delay, easing: 'linear' });
}

function popIn(el) {
    el?.animate([
        { transform: 'translate(-50%, -50%) scale(0)' },
        { transform: 'translate(-50%, -50%) scale(1.25)', offset: 0.7 },
        { transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: MS, easing: EASE });
}

const piece = (map, id, i) => map.querySelector(`.slot[data-unit="${id}"][data-i="${i}"]`);
const cellPiece = (map, victim, i) => map.querySelector(`.slot.cas[data-cas="${victim}"][data-i="${i}"]`);

function blocks(map, prev, cur) {
    for (const side of ['french', 'british']) {
        const cls = SIDE_CLASS[side];
        const taker = enemyOf(side);
        let toTrack = cur.casualties[taker] - prev.casualties[taker];
        let cell = prev.casualties[taker];
        const lost = [];
        const gained = [];
        for (const [id, u] of Object.entries(UNITS)) {
            if (u.side !== side) continue;
            const p = prev.units[id];
            const c = cur.units[id];
            const disc = u.type === 'artillery' ? ' disc' : '';
            for (let i = p.blocks - 1; i >= c.blocks; i--) lost.push({ id, i, from: slotAt(id, i, p.pos), disc });
            for (let i = p.blocks; i < c.blocks; i++) gained.push({ id, i, to: slotAt(id, i, c.pos) });
            if (id === 'paget' && p.pos !== c.pos) {
                // Paget marching from #1 to #2: his pieces slide
                for (let i = 0; i < Math.min(p.blocks, c.blocks); i++) {
                    piece(map, id, i)?.animate([pct(slotAt(id, i, p.pos)), pct(slotAt(id, i, c.pos))], { duration: MS * 1.6, easing: EASE });
                }
            }
        }
        let k = 0;
        for (const l of lost) {
            const delay = 60 * k++;
            if (toTrack > 0) {
                // a casualty: to the next cell of the track kept by the enemy
                const to = cellAt(side, cell);
                ghost(map, `${cls}${l.disc}`, l.from, to, delay);
                arriveLater(cellPiece(map, side, cell), delay);
                cell++;
                toTrack--;
            } else if (gained.length) {
                // a reinforcement: to the slot it fills
                const g = gained.shift();
                ghost(map, cls, l.from, g.to, delay);
                arriveLater(piece(map, g.id, g.i), delay);
            } else {
                ghost(map, `${cls}${l.disc}`, l.from, null, delay);
            }
        }
        // pieces back with nothing that left (Cirujanos), casualties with no piece flying: they pop in
        for (const g of gained) popIn(piece(map, g.id, g.i));
        for (; toTrack > 0; toTrack--) popIn(cellPiece(map, side, cell++));
    }
}

// ------------------------------------------------------------------ morale

/** Slides the highlighted box of a track (the `b` inside `container`) from index `from` to `to`. */
function slideMarker(container, from, to) {
    const boxes = container?.querySelectorAll('b');
    if (!boxes || !boxes[from] || !boxes[to]) return;
    const a = boxes[from].getBoundingClientRect();
    const b = boxes[to].getBoundingClientRect();
    boxes[to].animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: MS, easing: EASE });
}

function floatDelta(map, tag, text, good) {
    if (!tag) return;
    const el = document.createElement('div');
    el.className = `float-delta ${good ? 'good' : 'bad'}`;
    el.textContent = text;
    el.style.left = tag.style.left;
    el.style.top = tag.style.top;
    map.append(el);
    const a = el.animate([
        { opacity: 0, transform: 'translate(-50%, -100%)' },
        { opacity: 1, transform: 'translate(-50%, -230%)', offset: 0.2 },
        { opacity: 1, transform: 'translate(-50%, -270%)', offset: 0.75 },
        { opacity: 0, transform: 'translate(-50%, -320%)' },
    ], { duration: 1600, easing: 'ease-out' });
    a.onfinish = () => el.remove();
}

function morale(root, map, prev, cur) {
    for (const id of Object.keys(UNITS)) {
        const p = prev.units[id].morale;
        const c = cur.units[id].morale;
        if (p === null || c === null || p === c) continue;
        const good = c > p;
        const row = root.querySelector(`.unit-row[data-unit="${id}"]`);
        slideMarker(row?.querySelector('.morale'), p, c);
        row?.animate([{ boxShadow: `inset 0 0 0 999px ${good ? '#2f8a5a55' : '#b0303a55'}` }, { boxShadow: 'inset 0 0 0 999px #0000' }], { duration: 1200, easing: 'ease-out' });
        floatDelta(map, map.querySelector(`.unit-tag[data-unit="${id}"]`), `${good ? '+' : '−'}${Math.abs(c - p)}♥`, good);
    }
}

// ------------------------------------------------------------------ Moore, locations, cubes

function moore(root, map, prev, cur) {
    const p = prev.moore;
    const c = cur.moore;
    const marker = map.querySelector('.moore');
    if (marker && p.pos !== c.pos && p.status !== 'dead') {
        marker.animate([pct(center(BOARD.moore[p.pos])), pct(center(BOARD.moore[c.pos]))], { duration: MS * 1.6, easing: EASE });
    }
    if (marker && p.status === 'active' && c.status === 'dying') {
        // hit: he staggers
        marker.animate([
            { transform: 'translate(-50%, -50%)' }, { transform: 'translate(-58%, -50%) rotate(-12deg)' },
            { transform: 'translate(-42%, -50%) rotate(10deg)' }, { transform: 'translate(-50%, -50%)' },
        ], { duration: MS, easing: 'ease-in-out' });
    }
    if (p.track !== c.track) slideMarker(root.querySelector('.path'), p.track - 1, c.track - 1);
    if (p.status !== 'dead' && c.status === 'dead') {
        // his marker falls and fades
        const el = document.createElement('div');
        el.className = 'moore dying ghost';
        Object.assign(el.style, pct(center(BOARD.moore[c.pos])));
        el.innerHTML = '<b>†</b>';
        map.append(el);
        const a = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -20%) scale(.6)' }], { duration: MS * 2, easing: 'ease-in', fill: 'both' });
        a.onfinish = () => el.remove();
    }
}

function locations(map, prev, cur) {
    for (const loc of Object.keys(cur.locations)) {
        if (prev.locations[loc] === cur.locations[loc]) continue;
        map.querySelector(`.ctrl[data-loc="${loc}"]`)?.animate([
            { transform: 'translate(-50%, -50%) scale(1.9) rotate(-90deg)', boxShadow: '0 0 18px #fff' },
            { transform: 'translate(-50%, -50%) scale(1)', boxShadow: '0 2px 8px #000' },
        ], { duration: MS * 1.3, easing: EASE });
    }
}

function cubes(root, prev, cur) {
    for (const side of ['french', 'british']) {
        const d = cur.cubes[side] - prev.cubes[side];
        const pill = root.querySelector(`.topbar .pill[data-side="${side}"]`);
        if (!d || !pill) continue;
        const el = document.createElement('b');
        el.className = `delta ${d > 0 ? 'good' : 'bad'}`;
        el.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
        pill.prepend(el);
        el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1800, fill: 'forwards' });
    }
}
