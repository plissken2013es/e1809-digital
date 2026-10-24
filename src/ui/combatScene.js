// Combat scenes in the style of 34_W1815_Advance_Wars (its pixel art, in
// assets/combat/): a small split window over the map, French on the left and
// British on the right, played after the dice and before the pieces move.
// Each block is 3 soldiers (15 at most): a casualty kills 3, each point of
// morale lost sends 2 running off; with neither they only fire. Moore's
// support puts him on horseback in the British panel; the Artillery fires its
// guns and its target does not answer (its dice ignore 1s and 2s). A place
// that changes hands gets its own short scene next: the flag comes down and
// the other goes up. Everything is drawn at 1× on a canvas scaled up with
// pixelated rendering; a click or Enter skips it.

import { h } from './dom.js';
import { UNITS, LOCATIONS } from '../engine/index.js';

const BASE = 'assets/combat/';
const PW = 128; // a panel is one W1815 background
const PH = 160;
const GAP = 6;
const PER_BLOCK = 3;
const MAX_SOLDIERS = 15;
/** Timeline of a combat (ms): walk in, fire, casualties, flight, end. */
const T = { walk: 650, fire: 850, deaths: [1100, 2500], flee: [1900, 2800], ceasefire: 3100, end: 3500, fade: 280 };
const CAPTURE_MS = 2600;

// Background of each panel: the place for its garrison, else the field of each side.
const BG = { elvina: 2, palavea: 3, french: 1, british: 8, artilleria: 9 };
/** Ground (feet) of each background, from W1815 (combat/constants.ts). */
const GROUND = { 1: [60, 152], 9: [60, 152] };
const ground = (bg) => GROUND[bg] ?? [104, 152];

const SHEETS = {
    walk: { fw: 80, fh: 64, n: 6, fps: 9, loop: true },
    run: { fw: 80, fh: 64, n: 8, fps: 12, loop: true },
    fire: { fw: 80, fh: 64, n: 4, fps: 12 },
    crouch: { fw: 80, fh: 64, n: 4, fps: 12 },
    crouching_fire: { fw: 80, fh: 64, n: 3, fps: 12 },
    death_by_gunfire: { fw: 80, fh: 64, n: 11, fps: 16 },
    death_by_cannon: { fw: 80, fh: 64, n: 12, fps: 16 },
    gun: { file: 'blue_artillery_firing', fw: 96, fh: 34, n: 9, fps: 12 },
    gunDeath: { file: 'artillery_death', fw: 48, fh: 32, n: 5, fps: 8 },
    smoke: { file: 'gunfire_sheet', fw: 38, fh: 16, n: 8, fps: 16 },
    blast: { file: 'explosion_sheet_01', fw: 64, fh: 64, n: 8, fps: 18 },
    horse: { file: 'red_horse_stand_idle', fw: 48, fh: 48, n: 5, fps: 6, loop: true },
    flag: { fw: 53, fh: 39, n: 3, fps: 6, loop: true },
};
const COLOR = { french: 'blue', british: 'red' };
const INFANTRY = ['walk', 'run', 'fire', 'crouch', 'crouching_fire', 'death_by_gunfire', 'death_by_cannon'];

let images = null;
/** Loads every image once; resolves to null if any is missing (no scenes then). */
function load() {
    const files = {
        ...Object.fromEntries(['blue', 'red'].flatMap((c) => INFANTRY.map((a) => [`${c}:${a}`, `${c}_infantry_${a}_sheet`]))),
        gun: SHEETS.gun.file, gunDeath: SHEETS.gunDeath.file, smoke: SHEETS.smoke.file, blast: SHEETS.blast.file, horse: SHEETS.horse.file,
        'flag:french': 'french_flag_sheet', 'flag:british': 'brit_flag_sheet', place: 'place_captured',
        ...Object.fromEntries(Object.values(BG).map((n) => [`bg${n}`, `bg${n}`])),
    };
    images ??= Promise.all(Object.entries(files).map(([key, file]) => new Promise((ok, ko) => {
        const img = new Image();
        img.onload = () => ok([key, img]);
        img.onerror = ko;
        img.src = `${BASE}${file}.png`;
    }))).then(Object.fromEntries).catch((err) => {
        console.warn('Sin escenas de combate:', err);
        return null;
    });
    return images;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const nameOf = (id) => UNITS[id]?.name ?? LOCATIONS[id]?.name ?? id;

/**
 * A sprite on its panel, feet at (x, y): it plays an animation (from `t0`) and, when a
 * non-looping one ends, shows its rest pose (standing, crouched, lying dead) or nothing.
 */
class Sprite {
    constructor(x, y, { flip = false, ax = 0.5 } = {}) {
        Object.assign(this, { x, y, flip, ax, anim: null, rest: null });
    }

    /** rest: [img, sheet, frame] shown after the animation; undefined keeps the current one. */
    play(img, sheet, t0, rest) {
        this.anim = { img, sheet, t0 };
        if (rest !== undefined) this.rest = rest;
        return this;
    }

    /** [img, sheet, frame] to draw at `t`, or null. */
    pose(t) {
        const a = this.anim;
        if (a && t >= a.t0) {
            const k = Math.floor(((t - a.t0) / 1000) * a.sheet.fps);
            if (a.sheet.loop) return [a.img, a.sheet, k % a.sheet.n];
            if (k < a.sheet.n) return [a.img, a.sheet, k];
        }
        return this.rest;
    }
}

/**
 * Plays the scene of a combat (the `scene` of the engine's results step) over `host`.
 * @returns {{ done: Promise<void>, skip(): void, at(ms: number): void }} `at` draws one instant (debugging)
 */
export function playCombat(host, scene) {
    return play(host, (imgs) => combatStage(imgs, scene));
}

/** The short scene of a place changing hands: one flag down, the other up. */
export function playCapture(host, { location, by }) {
    return play(host, (imgs) => captureStage(imgs, location, by));
}

/** Common player: an overlay with a canvas, its stage drawn each frame until it ends or is skipped. */
function play(host, makeStage) {
    let finish;
    const done = new Promise((ok) => (finish = ok));
    let over = false;
    let el = null;
    const handle = { done, skip: () => close(), at: () => {} };
    const close = () => {
        if (over) return;
        over = true;
        el?.remove();
        finish();
    };
    load().then((imgs) => {
        if (over) return;
        if (!imgs) return close();
        const stage = makeStage(imgs);
        const canvas = h('canvas', { width: stage.w, height: stage.h });
        el = h(`div.combat-scene${stage.cls ? `.${stage.cls}` : ''}`, { onclick: close, title: 'Pulsa para saltar' }, stage.head, canvas);
        el.style.setProperty('--ratio', `${stage.w} / ${stage.h}`);
        host.append(el);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        handle.at = (t) => stage.draw(ctx, t);
        // a background tab gets no animation frames: the scene ends on time anyway
        setTimeout(close, stage.ms + T.fade + 400);
        const start = performance.now();
        const tick = (now) => {
            if (over) return;
            const t = now - start;
            stage.draw(ctx, t);
            if (t >= stage.ms) {
                el.classList.add('out');
                setTimeout(close, T.fade);
                return;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    return handle;
}

// ------------------------------------------------------------------ combat

/** One panel: its background, soldiers (or guns), Moore, and what happens to them. */
function panel(imgs, side, units, { attacker, artilleryFire, location, moore }) {
    const right = side === 'british';
    const artillery = units.length === 1 && units[0].id === 'artilleria';
    const bg = location ? BG[location] : artillery ? BG.artilleria : BG[side];
    const [top, bottom] = ground(bg);
    const blocks = units.reduce((n, u) => n + u.blocks, 0);
    const lost = units.reduce((n, u) => n + u.lost, 0);
    const morale = units.reduce((n, u) => n + u.morale, 0);
    const p = { side, right, bg, sprites: [], effects: [], fires: !artilleryFire || attacker, artillery };
    const color = COLOR[side];
    // panel coordinates are drawn facing right (towards the enemy) and mirrored for the British
    const X = (x) => (right ? PW - x : x);

    if (artillery) {
        const n = Math.min(3, blocks);
        p.guns = Array.from({ length: n }, (_, i) => {
            const y = bottom - 4 - i * Math.min(18, (bottom - top) / 3);
            const s = new Sprite(X(8 + i * 10), y, { flip: right, ax: 0 });
            s.rest = [imgs.gun, SHEETS.gun, 0];
            return s;
        });
        p.sprites.push(...p.guns);
        p.dying = shuffle(p.guns).slice(0, Math.min(n, lost));
        p.fleeing = [];
    } else {
        const n = blocks ? Math.min(MAX_SOLDIERS, blocks * PER_BLOCK) : 0;
        const deaths = blocks ? Math.min(n, Math.round((lost * n) / blocks)) : 0;
        const rows = Math.max(1, Math.min(3, Math.ceil(n / 5)));
        const perRow = Math.ceil(n / rows);
        const rowGap = Math.min(16, (bottom - top) / rows);
        p.soldiers = Array.from({ length: n }, (_, i) => {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const x = 22 + (col + 0.5) * (66 / perRow) + (row % 2 ? 5 : 0) + rnd(-2, 2);
            const y = bottom - 2 - row * rowGap + rnd(-2, 2);
            const s = new Sprite(X(x - 60), y, { flip: right });
            s.post = X(x);
            s.delay = rnd(0, 250);
            s.crouched = row === 0 && Math.random() < 0.35;
            s.play(imgs[`${color}:walk`], SHEETS.walk, 0, null);
            return s;
        });
        p.sprites.push(...p.soldiers);
        const order = shuffle(p.soldiers);
        p.dying = order.slice(0, deaths);
        p.fleeing = order.slice(deaths, deaths + Math.min(n - deaths, morale * 2));
    }
    if (moore && side === 'british') p.sprites.push(new Sprite(X(14), top + 22, { flip: right }).play(imgs.horse, SHEETS.horse, 0, null));
    p.sprites.sort((a, b) => a.y - b.y);
    return p;
}

function combatStage(imgs, scene) {
    const att = scene.attacker;
    const sides = { [scene.side]: [att], [scene.side === 'french' ? 'british' : 'french']: scene.defenders };
    const artilleryFire = att.id === 'artilleria';
    const panels = ['french', 'british'].map((side) => panel(imgs, side, sides[side], {
        attacker: side === scene.side, artilleryFire, location: side !== scene.side ? scene.location : null, moore: scene.moore,
    }));
    const [fr, gb] = panels;
    const enemyOf = (p) => (p === fr ? gb : fr);
    const label = (side) => {
        const units = sides[side].map((u) => nameOf(u.id)).join(' · ');
        return side !== scene.side && scene.location ? `${nameOf(scene.location)}: ${units}` : units;
    };
    const head = h('div.cs-heads', null, ['french', 'british'].map((s) => h(`span.${s === 'french' ? 'fr' : 'gb'}`, null, label(s), s === scene.side ? ' ⚔' : '')));

    // what happens and when (each event once)
    const events = [];
    for (const p of panels) {
        const enemy = enemyOf(p);
        for (const s of p.dying) events.push({ t: rnd(...T.deaths), run: (t) => die(p, s, t, enemy.artillery) });
        for (const s of p.fleeing) events.push({ t: rnd(...T.flee), run: (t) => flee(p, s, t) });
        if (!p.fires) continue;
        for (const s of p.soldiers ?? p.guns) {
            for (let t = T.fire + rnd(0, 450); t < T.ceasefire; t += p.artillery ? rnd(900, 1400) : rnd(550, 1050)) {
                events.push({ t, run: (now) => fire(p, s, now, enemy) });
            }
        }
    }
    events.sort((a, b) => a.t - b.t);

    function fire(p, s, t, enemy) {
        if (s.dead || s.gone || !s.ready) return;
        if (p.artillery) {
            s.play(imgs.gun, SHEETS.gun, t);
            // the shot lands among the enemy
            const target = shuffle(enemy.sprites.filter((x) => !x.dead))[0];
            const [x, y] = target ? [target.x, target.y] : [rnd(30, 100), rnd(100, 150)];
            enemy.effects.push(new Sprite(x + rnd(-14, 14), y + 12).play(imgs.blast, SHEETS.blast, t + 280, null));
            return;
        }
        s.play(imgs[`${COLOR[p.side]}:${s.crouched ? 'crouching_fire' : 'fire'}`], s.crouched ? SHEETS.crouching_fire : SHEETS.fire, t);
        // smoke at the muzzle
        p.effects.push(new Sprite(s.x + (p.right ? -26 : 26), s.y - (s.crouched ? 16 : 24) + 8, { flip: p.right }).play(imgs.smoke, SHEETS.smoke, t + 120, null));
    }

    function die(p, s, t, byCannon) {
        if (s.dead) return;
        s.dead = true;
        const [img, sheet] = p.artillery ? [imgs.gunDeath, SHEETS.gunDeath]
            : [imgs[`${COLOR[p.side]}:death_by_${byCannon ? 'cannon' : 'gunfire'}`], byCannon ? SHEETS.death_by_cannon : SHEETS.death_by_gunfire];
        s.play(img, sheet, t, [img, sheet, sheet.n - 1]); // stays where he fell
    }

    function flee(p, s, t) {
        if (s.dead) return;
        s.gone = true;
        s.play(imgs[`${COLOR[p.side]}:run`], SHEETS.run, t);
        s.flip = !p.right; // away from the enemy
        s.flight = { t, x: s.x, vx: p.right ? 0.075 : -0.075 }; // px per ms
    }

    let next = 0;
    return {
        w: PW * 2 + GAP, h: PH, head, ms: T.end,
        draw(ctx, t) {
            while (next < events.length && events[next].t <= t) events[next++].run(t);
            ctx.clearRect(0, 0, PW * 2 + GAP, PH);
            panels.forEach((p, i) => {
                const ox = i * (PW + GAP);
                ctx.save();
                ctx.beginPath();
                ctx.rect(ox, 0, PW, PH);
                ctx.clip();
                ctx.drawImage(imgs[`bg${p.bg}`], ox, 0);
                for (const s of p.sprites) {
                    // walking in to their posts, then standing (or crouched) until they fire
                    if (s.post !== undefined && !s.ready) {
                        const k = Math.min(1, Math.max(0, (t - s.delay) / T.walk));
                        s.x = s.post + (p.right ? 60 : -60) * (1 - k);
                        if (k >= 1) {
                            s.ready = true;
                            const color = COLOR[p.side];
                            const crouch = [imgs[`${color}:crouch`], SHEETS.crouch];
                            if (s.crouched) s.play(...crouch, t, [...crouch, SHEETS.crouch.n - 1]);
                            else s.play(imgs[`${color}:fire`], SHEETS.fire, -1e9, [imgs[`${color}:walk`], SHEETS.walk, 0]);
                        }
                    }
                    if (s.post === undefined) s.ready = true;
                    if (s.flight) s.x = s.flight.x + s.flight.vx * (t - s.flight.t);
                    const pose = s.pose(t);
                    if (pose) drawSprite(ctx, s, pose, ox);
                }
                for (const e of p.effects) {
                    const pose = e.pose(t);
                    if (pose) drawSprite(ctx, e, pose, ox);
                }
                ctx.restore();
            });
        },
    };
}

/** Draws a pose of a sprite with its feet (bottom, at `ax` of its width) on its point of the panel. */
function drawSprite(ctx, s, [img, sheet, frame], ox) {
    const { fw, fh } = sheet;
    const ax = s.flip ? 1 - s.ax : s.ax;
    const x = Math.round(ox + s.x - ax * fw);
    const y = Math.round(s.y - fh);
    if (!s.flip) {
        ctx.drawImage(img, frame * fw, 0, fw, fh, x, y, fw, fh);
        return;
    }
    ctx.save();
    ctx.translate(x + fw, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, frame * fw, 0, fw, fh, 0, 0, fw, fh);
    ctx.restore();
}

// ------------------------------------------------------------------ a place changes hands

/** Mast of place_captured (W1815 art.ts PLACE_MAST): the flag hangs to its right. */
const MAST = { x: 84, top: 4, hidden: 95 };

function captureStage(imgs, location, by) {
    const from = by === 'french' ? 'british' : 'french';
    const place = imgs.place;
    const wave = (t) => Math.floor((t / 1000) * SHEETS.flag.fps) % SHEETS.flag.n;
    const head = h('div.cs-heads.one', null, h(`span.${by === 'french' ? 'fr' : 'gb'}`, null, `¡${nameOf(location)} pasa a manos del ${by === 'french' ? 'francés' : 'británico'}!`));
    const ease = (k) => (k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k));
    return {
        w: place.width, h: place.height, head, ms: CAPTURE_MS, cls: 'capture',
        draw(ctx, t) {
            ctx.clearRect(0, 0, place.width, place.height);
            // the old flag comes down, the new one goes up (behind the palisade)
            const down = ease(t / 900);
            const up = ease((t - 1000) / 1100);
            const yOf = (k) => MAST.top + (MAST.hidden - MAST.top) * k;
            const { fw, fh } = SHEETS.flag;
            const draw = (side, y) => ctx.drawImage(imgs[`flag:${side}`], wave(t) * fw, 0, fw, fh, MAST.x, Math.round(y), fw, fh);
            if (down < 1) draw(from, yOf(down));
            if (up > 0) draw(by, yOf(1 - up));
            ctx.drawImage(place, 0, 0);
        },
    };
}
