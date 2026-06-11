import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import { ZERO_ADDRESS } from '../src/helpers/constant';

import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  TEST_BANK_2,
  createRoundForTests,
  emitBetRecorded,
  emitDeposit,
  emitVaultShareTransfer,
  setupSecondTestMarket,
  setupTestMarket,
} from './helpers';

const STATS_ID = DEFAULT_USER.toLowerCase() + '-1';
const SECOND_USER = '0xccccccdc53842141be8f70df9efe4d08538a5555';

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

describe('Market stakerCount', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('share mint counts a new staker once per market', () => {
    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '1000000000000000000000000', 1_000_000);
    assert.fieldEquals('Market', '1', 'stakerCount', '1');

    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '500000000000000000000000', 1_000_100, 1);
    assert.fieldEquals('Market', '1', 'stakerCount', '1');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'sbrbShares', '1500000000000000000000000');
  });

  test('full exit (share burn) decrements stakerCount back to zero', () => {
    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '1000000000000000000000000', 1_000_000);
    emitVaultShareTransfer(DEFAULT_USER, ZERO_ADDRESS, '1000000000000000000000000', 1_000_200, 1);

    assert.fieldEquals('Market', '1', 'stakerCount', '0');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'sbrbShares', '0');
  });

  test('same user staking in two vaults is counted in both markets', () => {
    setupSecondTestMarket();

    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '1000000000000000000000000', 1_000_000);
    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '2000000000000000000000000', 1_000_100, 1, TEST_BANK_2);

    // The old global-balance logic left market 2 at 0 here.
    assert.fieldEquals('Market', '1', 'stakerCount', '1');
    assert.fieldEquals('Market', '2', 'stakerCount', '1');
  });

  test('share transfer between users keeps stakerCount at one', () => {
    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '1000000000000000000000000', 1_000_000);
    emitVaultShareTransfer(DEFAULT_USER, SECOND_USER, '1000000000000000000000000', 1_000_200, 1);

    assert.fieldEquals('Market', '1', 'stakerCount', '1');
    assert.fieldEquals('UserMarketStats', STATS_ID, 'sbrbShares', '0');
    assert.fieldEquals('UserMarketStats', SECOND_USER + '-1', 'sbrbShares', '1000000000000000000000000');
  });

  test('mint does not create UserMarketStats for the zero address', () => {
    emitVaultShareTransfer(ZERO_ADDRESS, DEFAULT_USER, '1000000000000000000000000', 1_000_000);
    assert.entityCount('UserMarketStats', 1);
  });
});
