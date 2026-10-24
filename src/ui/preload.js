// Loads every asset before the menu, with a progress bar: the card and map
// images, the pixel art and sounds of the combat scenes and the 3D dice
// modules. Images stay referenced (loadImage in dom.js), so the page keeps them
// decoded and the scenes draw them at once; a file that fails is reported and
// skipped (the game works without it).

import { h, loadImage } from './dom.js';
import { UNITS, COMMANDERS, ACTIONS, ACTION_BACKS, TACTICS, BOARD } from '../engine/index.js';
import { COMBAT_IMAGES } from './combatScene.js';
import { SOUND_FILES, loadSound } from './audio.js';

/** Every `assets/…` path in the game data (cards, backs, map). */
function dataImages() {
    const out = new Set(['assets/cover.webp', 'assets/icons/horse.webp']);
    const walk = (x) => {
        if (typeof x === 'string') {
            if (x.startsWith('assets/')) out.add(x);
        } else if (x && typeof x === 'object') {
            Object.values(x).forEach(walk);
        }
    };
    [UNITS, COMMANDERS, ACTIONS, ACTION_BACKS, TACTICS, BOARD].forEach(walk);
    return [...out];
}

/** Shows a progress bar in `root` while everything loads; resolves when done. */
export async function preloadAll(root) {
    const jobs = [
        ...[...dataImages(), ...COMBAT_IMAGES].map((url) => () => loadImage(url)),
        ...SOUND_FILES.map((url) => () => loadSound(url)),
        () => import(new URL('src/ui/dice3d.js', document.baseURI).href), // three.js and cannon-es
    ];
    const bar = h('i');
    const label = h('span', null, 'Cargando…');
    root.replaceChildren(h('div.preload', null, h('p.kicker', null, 'Elviña 1809'), h('div.preload-bar', null, bar), label));
    let done = 0;
    const failed = [];
    await Promise.all(jobs.map((job) => job()
        .catch((err) => failed.push(err))
        .finally(() => {
            done++;
            bar.style.width = `${Math.round((done / jobs.length) * 100)}%`;
            label.textContent = `Cargando… ${done} de ${jobs.length}`;
        })));
    if (failed.length) console.warn(`No se cargaron ${failed.length} recursos:`, failed);
}
