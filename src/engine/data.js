// Game catalogs (src/data/*.json), indexed by id.
import unitsJson from '../data/units.json' with { type: 'json' };
import actionsJson from '../data/actions.json' with { type: 'json' };
import tacticsJson from '../data/tactics.json' with { type: 'json' };
import boardJson from '../data/board.json' with { type: 'json' };

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

export const SIDES = ['french', 'british'];
export const UNITS = byId(unitsJson.units);
export const COMMANDERS = byId(unitsJson.commanders);
export const ACTIONS = byId(actionsJson.cards);
export const TACTICS = byId(tacticsJson.cards);
export const BOARD = boardJson;
export const LOCATIONS = boardJson.locations;

/** Unit ids of a side, in card order. */
export const unitsOf = (side) => unitsJson.units.filter((u) => u.side === side).map((u) => u.id);

/** Action card ids of a side (its 15-card deck). */
export const deckOf = (side) => actionsJson.cards.filter((c) => c.side === side).map((c) => c.id);

/** Divisions whose elimination counts for victory (docs/01 [D-27]): every unit but the Reserve. */
export const countsForVictory = (unitId) => UNITS[unitId].type !== 'reserve';

export const enemyOf = (side) => (side === 'french' ? 'british' : 'french');
