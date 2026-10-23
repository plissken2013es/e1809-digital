// Public API of the rules engine.
export { Session, makeRecord, encodeRecord, decodeRecord, replayRecord, fingerprint } from './session.js';
export { DEFAULT_SETUP, DEFAULT_RULES, normalizeSetup } from './game.js';
export { IllegalAction, validate } from './ask.js';
export { UNITS, COMMANDERS, ACTIONS, ACTION_BACKS, TACTICS, BOARD, LOCATIONS, SIDES, unitsOf, deckOf, enemyOf, countsForVictory } from './data.js';
export { availableOrders, baseDice, eliminatedOf, inPlay, unitName, SIDE_NAME } from './state.js';
export { results, describe, currentResults, diceText } from './combat.js';
export { cardLabel, orderLabel } from './turn.js';
