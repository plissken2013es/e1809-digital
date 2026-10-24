// Correspondence games (play by link, no server): the rules of what travels,
// without the DOM, so app.js, view.js and tests/mail.test.js share them.

/** A tactic window with nothing to play (only pass or discard 3): the rival's pass by themselves, so only real decisions travel. */
export const emptyWindow = (p) => p.kind === 'tactic' && p.options.every((o) => o.id === 'pass' || o.id === 'discard3');

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const isPrefix = (short, long) => short.length <= long.length && short.every((x, i) => same(x, long[i]));

/**
 * A received game against this browser's copy (`ours`, null the first time):
 * - stale: the link brings nothing new (an old one); this copy stays as it is
 * - else the link's answers go on, replayed from `from` (where our copy ends; 0 if new or if they part)
 * - diverged: the link does not continue our copy (two copies of the game parted)
 */
export function receive(ours, theirs) {
    if (ours && ours.length >= theirs.length && isPrefix(theirs, ours)) return { stale: true, answers: ours, from: ours.length, diverged: false };
    const diverged = Boolean(ours) && !isPrefix(ours, theirs);
    return { stale: false, answers: theirs, from: ours && !diverged ? ours.length : 0, diverged };
}
