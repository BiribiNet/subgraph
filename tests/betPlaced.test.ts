import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import { ROUND_STATUS_BETTING } from '../src/helpers/constant';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  createRoundForTests,
  emitBetRecorded,
  testRoundId,
} from './helpers';

describe('BetRecorded / multi-market roulette bets', () => {
  beforeEach(() => {
    clearStore();
  });

  test('BetRecorded creates RouletteBet and updates round totals', () => {
    createRoundForTests(1, 1_000_000);
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.entityCount('RouletteBet', 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', '10000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', '10000000000000000000');
  });

  test('BetRecorded without pre-seeded round creates GlobalRound + market round', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.entityCount('GlobalRound', 1);
    assert.entityCount('RouletteRound', 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'startedAt', '1000000');
  });
});
