// Recorded games (tests/games/*.e18) replay whole and end in the same state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { decodeRecord, replayRecord } from '../src/engine/index.js';

const DIR = new URL('./games/', import.meta.url);

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.e18'))) {
    test(`recorded game ${file} replays identically`, async () => {
        const record = await decodeRecord(readFileSync(new URL(file, DIR), 'utf8'));
        const { failedAt, error, matches, session } = replayRecord(record);
        assert.equal(failedAt, null, `stops at decision ${failedAt + 1}: ${error}`);
        assert.ok(matches, 'the final state differs from the recording');
        assert.ok(session.state.result, 'the game did not end');
    });
}
