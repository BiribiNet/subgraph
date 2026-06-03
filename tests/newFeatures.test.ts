import { BigInt } from '@graphprotocol/graph-ts';
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
  GLOBAL_STATE_ID,
  createRoundForTests,
  emitBetRecorded,
  emitDeposit,
  emitWithdrawalRequested,
  emitWithdrawalProcessed,
  setupBrbTestMarket,
  testRoundId,
} from './helpers';

function marketSnapshotId(timestamp: i32): string {
  const day = BigInt.fromI32(timestamp).div(BigInt.fromI32(86400));
  return '1-' + day.toString();
}

const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';

describe('Staking Statistics Tests', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, 1_000_000);
  });

  test('deposit updates vault totals on Market and stable class aggregate', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'totalAssets', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'totalShares', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'sharePrice', '1');
    assert.fieldEquals('Market', '1', 'assetClass', 'STABLE');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '1000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'brbVaultTotalAssets', '0');
    assert.fieldEquals('User', DEFAULT_USER, 'firstSeenAt', '1000000');
    assert.fieldEquals('User', DEFAULT_USER, 'lastActiveAt', '1000000');
  });

  test('multiple deposits accumulate vault assets per market and class', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);
    emitDeposit(USER_ADDRESS_2, '2000000000000000000', '2000000000000000000', 1_000_100);

    assert.fieldEquals('Market', '1', 'totalAssets', '3000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '3000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'brbVaultTotalAssets', '0');
  });

  test('BRB market deposits accrue to brbVault totals not stable', () => {
    setupBrbTestMarket();
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'assetClass', 'BRB');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'brbVaultTotalAssets', '1000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '0');
  });

  test('withdraw reduces vault assets via WithdrawalProcessed', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 10000, DEFAULT_USER, 1_000_050, 1);
    emitWithdrawalProcessed(
      DEFAULT_USER,
      10000,
      DEFAULT_USER,
      '1000000000000000000',
      '1000000000000000000',
      1_000_100,
      2
    );

    assert.fieldEquals('Market', '1', 'totalAssets', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '0');
    assert.entityCount('VaultWithdrawal', 1);
  });
});

describe('Betting Statistics Tests', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, 1_000_000);
  });

  test('first bet updates user wagered stats and daily volume', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', '10000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'winCount', '0');
    assert.fieldEquals('Market', '1', 'pendingBets', '10000000000000000000');
    const dayNumber = (1_000_000 / 86400).toString();
    assert.fieldEquals('DailyStat', dayNumber, 'volume', '10000000000000000000');
    assert.fieldEquals('DailyStat', dayNumber, 'betCount', '1');
  });

  test('second player creates DailyPlayer row', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(USER_ADDRESS_2, '5000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    const dayNumber = (1_000_000 / 86400).toString();
    assert.fieldEquals('DailyStat', dayNumber, 'volume', '15000000000000000000');
    assert.fieldEquals('DailyStat', dayNumber, 'betCount', '2');
    assert.entityCount('DailyPlayer', 2);
  });

  test('repeat bets from same user in same round increment volume only once for betCount per event', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(DEFAULT_USER, '5000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    const dayNumber = (1_000_000 / 86400).toString();
    assert.fieldEquals('DailyStat', dayNumber, 'volume', '15000000000000000000');
    assert.fieldEquals('DailyStat', dayNumber, 'betCount', '2');
    assert.fieldEquals('User', DEFAULT_USER, 'betCount', '1');
  });
});

describe('Max Bet Amount Tests', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, 1_000_000);
  });

  test('maxBetAmount initializes to 0', () => {
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxBetAmount', '0');
  });

  test('maxBetAmount updates on first CORNER bet', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxBetAmount', '99000000000000000000');
  });

  test('maxBetAmount accumulates on second bet', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(USER_ADDRESS_2, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', '20000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxBetAmount', '198000000000000000000');
    assert.fieldEquals('Market', '1', 'maxBetAmount', '198000000000000000000');
  });
});

describe('APY Snapshot Tests', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, 1_000_000);
  });

  test('First deposit creates APY baseline on Market', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTimestamp', '1000000');
    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTotalAssets', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTotalShares', '1000000000000000000');
  });

  test('Daily snapshot is created on first deposit', () => {
    const timestamp = 1_000_000;
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', timestamp);

    const snapshotId = marketSnapshotId(timestamp);
    assert.entityCount('MarketAPYSnapshot', 1);
    assert.fieldEquals('MarketAPYSnapshot', snapshotId, 'totalAssets', '1000000000000000000');
    assert.fieldEquals('MarketAPYSnapshot', snapshotId, 'totalShares', '1000000000000000000');
  });

  test('Snapshot not created twice on same day', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);
    emitDeposit(USER_ADDRESS_2, '2000000000000000000', '2000000000000000000', 1_010_000);

    assert.entityCount('MarketAPYSnapshot', 1);
  });

  test('New snapshot created on different day', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);
    emitDeposit(USER_ADDRESS_2, '2000000000000000000', '2000000000000000000', 1_090_000);

    assert.entityCount('MarketAPYSnapshot', 2);
  });

  test('APY remains 0 when no time has passed', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'apy7Day', '0');
    assert.fieldEquals('Market', '1', 'apy30Day', '0');
    assert.fieldEquals('Market', '1', 'apy365Day', '0');
    assert.fieldEquals('Market', '1', 'apyLifetime', '0');
  });
});

describe('Integration Tests', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, 1_000_000);
  });

  test('Complete workflow: deposits, bets, withdrawals', () => {
    const t1 = 1_000_000;
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', t1);
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, t1 + 100, 0);
    emitBetRecorded(USER_ADDRESS_2, '10000000000000000000', CORNER_BET_DATA, 1, 1, t1 + 200, 1);
    emitWithdrawalRequested(DEFAULT_USER, 5000, DEFAULT_USER, t1 + 250, 2);
    emitWithdrawalProcessed(
      DEFAULT_USER,
      5000,
      DEFAULT_USER,
      '500000000000000000',
      '500000000000000000',
      t1 + 300,
      3
    );

    assert.fieldEquals('Market', '1', 'totalAssets', '500000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '500000000000000000');
    assert.fieldEquals('Market', '1', 'pendingBets', '20000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', '10000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS_2, 'totalRouletteBets', '10000000000000000000');
  });
});
