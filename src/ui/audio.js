// Battle sounds of the combat scenes (combatScene.js), from 34_W1815_Advance_Wars
// (its pools and volumes, ui/audio.ts): one at random from each pool, with a
// throttle so a volley does not stack a hundred shots, and a little detune so it
// does not sound in phase. Web Audio: the buffers are decoded while the app loads
// (preload.js) and the context starts on the first click or key, as browsers
// require. The sounds of a scene fade out when it ends: some files ring on for
// seconds (cannon echoes, battle cries).

const BASE = 'assets/sounds/';

/** Pools: file names without `.mp3`. */
export const SFX = {
    rifle: ['rifle_01', 'rifle_02', 'rifle_03', 'rifle_04', 'rifle_05', 'rifle_06', 'rifle_07', 'rifle_08'],
    cannon: ['cannon_01', 'cannon_02', 'cannon_03'],
    cry: ['battle_cry_01', 'battle_cry_02', 'battle_cry_03'],
    cheerFrench: ['viv_le_france'],
    cheerBritish: ['for_king_and_country'],
};

export const SOUND_FILES = [...new Set(Object.values(SFX).flat())].map((n) => `${BASE}${n}.mp3`);

let ctx = null;
let master = null;
const buffers = new Map(); // name → AudioBuffer
const playing = new Set(); // { src, gain } still sounding
const last = new Map(); // throttle key → time of the last sound
let enabled = true;

function context() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    // browsers keep the context suspended until a gesture
    const resume = () => ctx.state === 'suspended' && ctx.resume();
    for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, resume, { capture: true, passive: true });
    return ctx;
}

/** Fetches and decodes one sound (preload.js calls it for every file). */
export async function loadSound(url) {
    const name = url.slice(BASE.length, -4);
    if (buffers.has(name)) return;
    const ac = context();
    if (!ac) return;
    const data = await (await fetch(url)).arrayBuffer();
    buffers.set(name, await ac.decodeAudioData(data));
}

export function setSound(on) {
    enabled = on;
    if (!on) fadeAll(0.1);
}

/**
 * One sound of a pool. throttle: [key, ms] skips it if another of that key sounded
 * less than ms ago. Does nothing while muted, before the first gesture or if not loaded.
 */
export function sfx(pool, { volume = 1, detune = false, throttle = null } = {}) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = performance.now();
    if (throttle) {
        if (now - (last.get(throttle[0]) ?? -Infinity) < throttle[1]) return;
        last.set(throttle[0], now);
    }
    const buffer = buffers.get(pool[Math.floor(Math.random() * pool.length)]);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (detune) src.playbackRate.value = 2 ** ((Math.random() * 2 - 1) * 200 / 1200); // ±200 cents
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(master);
    const entry = { src, gain };
    playing.add(entry);
    src.onended = () => playing.delete(entry);
    src.start();
}

/** Fades out everything still sounding (a scene ends or is skipped). */
export function fadeAll(seconds = 0.8) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const { src, gain } of playing) {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + seconds);
        src.stop(t + seconds + 0.05);
    }
    playing.clear();
}
