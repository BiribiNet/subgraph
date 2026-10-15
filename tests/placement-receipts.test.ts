import { assert, beforeEach, clearStore, test } from 'matchstick-as';
import { DEFAULT_USER, CORNER_BET_DATA, emitBetRecorded } from './helpers';
beforeEach(() => clearStore());

test('two placements in the same transaction remain two receipts for one ticket', () => {
  emitBetRecorded(DEFAULT_USER, '1000000000000000000', CORNER_BET_DATA, 1, 1, 1000000, 1);
  emitBetRecorded(DEFAULT_USER, '1000000000000000000', CORNER_BET_DATA, 1, 1, 1000000, 2);
  assert.entityCount('RoulettePlacement', 2);
  assert.entityCount('RouletteBet', 1);
});
