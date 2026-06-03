import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  createRoundForTests,
  emitBetRecorded,
  emitDeposit,
  setupTestMarket,
} from './helpers';

const STATS_ID = DEFAULT_USER.toLowerCase() + '-1';

describe('UserMarketStats', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('bet and deposit accumulate on the same market stats row', () => {
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', CORNER_BET_DATA, 1);
    emitDeposit(DEFAULT_USER, '500000000000000000', '500000000000000000', 1_000_100);

    assert.entityCount('UserMarketStats', 1);
    assert.fieldEquals('UserMarketStats', STATS_ID, 'totalWagered', '1000000000000000000');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'totalStaked', '500000000000000000');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'betCount', '1');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'totalLost', '1000000000000000000');
  });

  test('repeat bets in same round increment wagered but not betCount', () => {
    emitBetRecorded(DEFAULT_USER, '1000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(DEFAULT_USER, '500000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    assert.fieldEquals('UserMarketStats', STATS_ID, 'totalWagered', '1500000000000000000');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'betCount', '1');
  });
});
