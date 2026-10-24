// Live games (WebRTC, no server of our own): the two browsers connect directly
// and each answer travels at once, numbered, over a data channel. The setup is
// by hand, like the correspondence links: one sends an invitation (a link with
// the game and its WebRTC offer), the other sends back a reply code that is
// pasted into a box. Google's public STUN server only tells each browser its
// public address; no game data goes through it. Behind it all is the
// correspondence game (mail.js): same id, same saved copies, so if the
// connection cannot be made or drops, the game goes on by links.
//
// LiveSync keeps the two copies in step and has no DOM (tests/live.test.js);
// LiveLink is the connection.

import { receive, isPrefix } from './mail.js';

export const INVITE = 'E18L.';
export const REPLY = 'E18R.';
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const GATHER_MS = 5000;
const CONNECT_MS = 30000;

/**
 * The two copies of a live game in step. Each side applies its own answers and sends them
 * numbered ({ t: 'answer', n, a }); the other applies them in order. On connecting (and
 * whenever a number does not fit), both say how far they are ({ t: 'hello', answers }): the
 * one behind catches up; if the copies parted, the inviter's wins.
 */
export class LiveSync {
    /**
     * @param {{ inviter: boolean, answers: () => any[], adopt: (answers: any[], from: number) => void, send: (msg: any) => void }} o
     * adopt: take these answers as the game, replaying from `from` (what is new)
     */
    constructor({ inviter, answers, adopt, send }) {
        Object.assign(this, { inviter, answers, adopt, send });
    }

    hello() {
        this.send({ t: 'hello', answers: this.answers() });
    }

    /** One of ours was just given: answer number `n`. */
    local(n, a) {
        this.send({ t: 'answer', n, a });
    }

    message(msg) {
        const ours = this.answers();
        if (msg.t === 'answer') {
            if (msg.n === ours.length) this.adopt([...ours, msg.a], ours.length);
            else if (msg.n > ours.length || JSON.stringify(ours[msg.n]) !== JSON.stringify(msg.a)) this.hello(); // a gap or a clash
            return;
        }
        if (msg.t !== 'hello') return;
        const theirs = msg.answers;
        if (isPrefix(theirs, ours)) {
            if (ours.length > theirs.length) this.hello(); // they are behind: they catch up with ours
            return;
        }
        const got = receive(ours, theirs);
        if (got.diverged && this.inviter) return void this.hello(); // the inviter's copy wins
        this.adopt(got.answers, got.from);
    }
}

/** Waits until the browser has gathered its addresses (no trickle: they all go in one code). */
function gathered(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((ok) => {
        const done = () => pc.iceGatheringState === 'complete' && ok();
        pc.addEventListener('icegatheringstatechange', done);
        setTimeout(ok, GATHER_MS);
    });
}

/**
 * The connection. state: 'idle' → 'inviting' (offer made, waiting for the reply) or
 * 'replying' (reply made, waiting for the inviter) → 'connecting' → 'open'; or 'failed', 'closed'.
 */
export class LiveLink {
    /** @param {{ onMessage: (msg: any) => void, onState: (state: string) => void }} o */
    constructor({ onMessage, onState }) {
        Object.assign(this, { onMessage, onState, state: 'idle', pc: null, channel: null, timer: null });
    }

    #set(state) {
        this.state = state;
        if (state === 'open' || state === 'failed' || state === 'closed') clearTimeout(this.timer);
        this.onState(state);
    }

    #peer() {
        this.close(true);
        const pc = new RTCPeerConnection({ iceServers: ICE });
        pc.addEventListener('connectionstatechange', () => {
            if (pc !== this.pc) return;
            if (pc.connectionState === 'failed') this.#set('failed');
            if (pc.connectionState === 'disconnected' && this.state === 'open') this.#set('closed');
        });
        this.pc = pc;
        return pc;
    }

    #wire(channel) {
        this.channel = channel;
        channel.addEventListener('open', () => this.#set('open'));
        channel.addEventListener('close', () => this.state === 'open' && this.#set('closed'));
        channel.addEventListener('message', (e) => {
            try {
                this.onMessage(JSON.parse(e.data));
            } catch (err) {
                console.warn('Mensaje en directo no válido:', err);
            }
        });
    }

    /** The inviter: makes the offer (its SDP, to put in the invitation). */
    async invite() {
        const pc = this.#peer();
        this.#wire(pc.createDataChannel('e18', { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        this.#set('inviting');
        return pc.localDescription.sdp;
    }

    /** The invited: takes the offer and makes the reply (its SDP, for the reply code). */
    async reply(offer) {
        const pc = this.#peer();
        pc.addEventListener('datachannel', (e) => this.#wire(e.channel));
        await pc.setRemoteDescription({ type: 'offer', sdp: offer });
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        this.#set('replying'); // no deadline: the inviter may take minutes to paste it; a failed connection says so
        return pc.localDescription.sdp;
    }

    /** The inviter: takes the reply pasted in the box; the channel opens a moment later. */
    async complete(answer) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
        this.#set('connecting');
        this.#deadline();
    }

    #deadline() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.state !== 'open' && this.#set('failed'), CONNECT_MS);
    }

    send(msg) {
        if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(msg));
    }

    close(quiet = false) {
        clearTimeout(this.timer);
        this.channel?.close();
        this.pc?.close();
        this.channel = null;
        this.pc = null;
        if (!quiet && this.state !== 'idle') this.#set('closed');
    }
}
