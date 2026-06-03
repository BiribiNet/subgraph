import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import {
  GLOBAL_STATE_ID,
  DEFAULT_USER,
  emitDeposit,
  emitWithdrawalRequested,
  emitWithdrawalProcessed,
} from './helpers';

const HUNDRED_ASSETS = '100000000000000000000';

const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';

describe('Withdrawal Queue Lifecycle', () => {
  beforeEach(() => {
    clearStore();
  });

  test('WithdrawalRequested creates LargeWithdrawalRequest and increments queue counter', () => {
    emitWithdrawalRequested(DEFAULT_USER, 5000, DEFAULT_USER, 1_000_000);

    assert.entityCount('LargeWithdrawalRequest', 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'withdrawalQueueCounter', '1');
    assert.entityCount('User', 1);
  });

  test('Multiple requests increment queue position monotonically', () => {
    emitWithdrawalRequested(DEFAULT_USER, 3000, DEFAULT_USER, 1_000_000, 0);
    emitWithdrawalRequested(USER_ADDRESS_2, 2000, USER_ADDRESS_2, 1_000_050, 1);

    assert.entityCount('LargeWithdrawalRequest', 2);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'withdrawalQueueCounter', '2');
  });

  test('WithdrawalProcessed clears open request and decrements pending by assetsPaid', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 10000, DEFAULT_USER, 1_000_050, 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', HUNDRED_ASSETS);

    emitWithdrawalProcessed(
      DEFAULT_USER,
      10000,
      DEFAULT_USER,
      HUNDRED_ASSETS,
      HUNDRED_ASSETS,
      1_000_100,
      2
    );

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
    assert.fieldEquals('User', DEFAULT_USER, 'openWithdrawalRequestId', 'null');
    assert.entityCount('VaultWithdrawal', 1);
    assert.entityCount('WithdrawTransaction', 1);
    assert.fieldEquals('Market', '1', 'totalAssets', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '0');
  });

  test('Processing more than estimated pending clamps total to zero', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 5000, DEFAULT_USER, 1_000_050, 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '50000000000000000000');

    emitWithdrawalProcessed(
      DEFAULT_USER,
      10000,
      DEFAULT_USER,
      HUNDRED_ASSETS,
      HUNDRED_ASSETS,
      1_000_100,
      2
    );

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
  });
});
