// Replay a game code (E18.…) and print what happened.
//
//   node tools/replay.mjs <file with the E18. code | the code itself> [--upto N] [--state] [--decisions]
//
// Prints the game log, whether the replay still matches the recording, and with
// --state the final state; --decisions lists every decision with its answer.

import { readFileSync, existsSync } from 'node:fs';
import { decodeRecord, replayRecord, fingerprint, UNITS, TACTICS, cardLabel, SIDE_NAME } from '../src/engine/index.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--upto');
if (!input) {
    console.error('usage: node tools/replay.mjs <file | E18.code> [--upto N] [--state] [--decisions]');
    process.exit(1);
}

const code = existsSync(input) ? readFileSync(input, 'utf8') : input;
const record = await decodeRecord(code);
const upTo = opt('upto') ? Number(opt('upto')) : record.answers.length;
const { session, failedAt, error, matches } = replayRecord(record, upTo);
const g = session.state;
const s = record.setup;

console.log(`seed ${s.seed}${record.build ? ` · build ${record.build}` : ''} · rules ${JSON.stringify(s.rules)}`);
if (Object.keys(s.scenario ?? {}).length) console.log(`scenario ${JSON.stringify(s.scenario)}`);
console.log(`${failedAt ?? upTo}/${record.answers.length} decisions replayed`);

let turn = -1;
for (const l of g.log) {
    if (l.turn !== turn) {
        turn = l.turn;
        console.log('');
    }
    console.log(`  ${l.text}`);
}

if (flag('decisions')) {
    console.log('\ndecisions:');
    session.trail.forEach((t, i) => console.log(`  ${i + 1}. R${t.round} ${t.side === 'french' ? 'FR' : 'GB'} ${t.prompt} → ${t.answer}`));
}

if (failedAt != null) console.log(`\nREPLAY STOPPED at decision ${failedAt + 1}: ${error} (the engine changed since the recording)`);
else if (upTo === record.answers.length && record.check) {
    console.log(`\nreplay ${matches ? 'matches the recording' : `DIFFERS from the recording (engine changed?)\n  recorded ${record.check}\n  replayed ${fingerprint(g)}`}`);
}
if (g.result) console.log(`result: ${g.result.winner} (${g.result.reason})`);
else if (g.pending) console.log(`pending (${g.pending.side}): ${g.pending.prompt}\n  ${g.pending.options.map((o) => o.label).join('\n  ')}`);

if (flag('state')) {
    console.log(`\nround ${g.roundNo} · turn ${g.turnNo} · Elviña ${g.locations.elvina} · Palavea ${g.locations.palavea} · supply ${g.supply ?? '∞'}`);
    console.log(`Moore #${g.moore.pos} · Senda ${g.moore.track} · ${g.moore.status} · Soult ${g.soult.used ? 'agotado' : 'disponible'}`);
    for (const [id, u] of Object.entries(g.units)) console.log(`  ${UNITS[id].name.padEnd(18)} ${u.status.padEnd(9)} fichas ${u.blocks} · moral ${u.morale ?? '-'}${u.pos ? ` · #${u.pos}` : ''}`);
    for (const side of ['french', 'british']) {
        const p = g.players[side];
        console.log(`${SIDE_NAME[side]}: ${p.cubes} cubos · bajas enemigas ${p.casualties} · racha ${p.streak.slice(-6).join(',')}`);
        console.log(`  mano: ${p.hand.map(cardLabel).join('; ') || '-'}`);
        console.log(`  mazo: ${p.deck.length} · descarte: ${p.discard.length}`);
        console.log(`  tácticas: ${p.tactics.map((t) => TACTICS[t].name).join(', ') || '-'}`);
    }
    console.log(`mercado: ${g.market.row.map((r) => `${TACTICS[r.id].name}${r.cubes ? ` (+${r.cubes})` : ''}`).join(' | ')}`);
}
