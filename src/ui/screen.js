// Phones: the game is played in landscape, with a compact layout of its own
// (main.css, «phone in landscape»: map on the left, a column with tabs on the
// right, the top bar on one line with the rest in ☰). Held upright, a notice
// asks to turn the phone. A web page cannot turn the screen by itself: only in
// fullscreen can it lock landscape (Android); iPhone Safari allows neither, so
// there the button is not shown.

import { h } from './dom.js';

/** Same media query as main.css («phone in landscape»). */
export const PHONE = '(orientation: landscape) and (max-height: 520px)';
export const phone = matchMedia(PHONE);

const iPhone = () => /iPhone|iPod/.test(navigator.userAgent);
export const canFullscreen = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !iPhone();
export const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

export async function toggleFullscreen() {
    try {
        if (isFullscreen()) {
            await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
            return;
        }
        const el = document.documentElement;
        await (el.requestFullscreen ?? el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        // Android: in fullscreen the page may lock landscape, and the phone turns by itself
        await screen.orientation?.lock?.('landscape').catch(() => {});
    } catch (err) {
        console.warn('Pantalla completa:', err);
    }
}

/** ⛶ in the top bar and the menu (none where fullscreen is not possible). */
export function fullscreenButton(cls = '.small') {
    if (!canFullscreen()) return null;
    const on = isFullscreen();
    return h(`button${cls}.fs`, { onclick: toggleFullscreen, title: on ? 'Salir de pantalla completa' : 'Pantalla completa (en el móvil, también en horizontal)' }, on ? '⤡' : '⛶');
}

/** Held upright on a phone: turn it (main.css shows this only then, over everything). */
export function rotateNotice() {
    return h(
        'div.rotate', { role: 'alert' },
        h('div.rotate-icon', { 'aria-hidden': 'true' }, '📱'),
        h('p.rotate-title', null, 'Gira el móvil'),
        h('p.hint', null, 'Elviña 1809 se juega en horizontal.'),
        canFullscreen() && h('button.primary', { onclick: toggleFullscreen }, '⛶ Pantalla completa en horizontal'),
    );
}
