import { BigInt } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { bigintToBytes } from '../src/helpers/bigintToBytes';
import {
  GLOBAL_STATE_ID,
  DEFAULT_USER,
  emitDeposit,
  emitWithdrawalRequested,
  emitWithdrawalProcessed,
} from './helpers';

const HUNDRED_ASSETS = '100000000000000000000';
const FIFTY_ASSETS = '50000000000000000000';
const EIGHTY_ASSETS = '80000000000000000000';
const TWENTY_ASSETS = '20000000000000000000';

const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';

/** Deterministic request id: mock tx hash + the request event's logIndex. */
function requestIdForLogIndex(logIndex: i32): string {
  return newMockEvent()
    .transaction.hash.concat(bigintToBytes(BigInt.fromI32(logIndex)))
    .toHexString();
}

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

  test('WithdrawalProcessed clears open request and decrements pending by the request amount', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 10000, DEFAULT_USER, 1_000_050, 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', HUNDRED_ASSETS);

    // assetsPaid (80) deliberately differs from the estimate added at request
    // time (100): the aggregate must subtract the estimate, not assetsPaid,
    // or it drifts permanently.
    emitWithdrawalProcessed(
      DEFAULT_USER,
      10000,
      DEFAULT_USER,
      EIGHTY_ASSETS,
      EIGHTY_ASSETS,
      1_000_100,
      2
    );

    const requestId = requestIdForLogIndex(1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
    assert.fieldEquals('LargeWithdrawalRequest', requestId, 'isCancelled', 'false');
    assert.fieldEquals('LargeWithdrawalRequest', requestId, 'processedAt', '1000100');
    assert.fieldEquals('User', DEFAULT_USER, 'openWithdrawalRequestId', 'null');
    assert.entityCount('VaultWithdrawal', 1);
    assert.entityCount('WithdrawTransaction', 1);
    assert.fieldEquals('Market', '1', 'totalAssets', TWENTY_ASSETS);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', TWENTY_ASSETS);
  });

  test('WithdrawalProcessed with zero amounts marks the request cancelled and decrements pending', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 5000, DEFAULT_USER, 1_000_050, 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', FIFTY_ASSETS);

    // cancelWithdrawal() emits WithdrawalProcessed(owner, bps, receiver, 0, 0).
    emitWithdrawalProcessed(DEFAULT_USER, 5000, DEFAULT_USER, '0', '0', 1_000_100, 2);

    const requestId = requestIdForLogIndex(1);
    assert.fieldEquals('LargeWithdrawalRequest', requestId, 'isCancelled', 'true');
    assert.fieldEquals('LargeWithdrawalRequest', requestId, 'processedAt', '1000100');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
    assert.fieldEquals('User', DEFAULT_USER, 'openWithdrawalRequestId', 'null');
    // A cancellation pays nothing out: no withdrawal entities, vault untouched.
    assert.entityCount('VaultWithdrawal', 0);
    assert.entityCount('WithdrawTransaction', 0);
    assert.fieldEquals('Market', '1', 'totalAssets', HUNDRED_ASSETS);
  });

  test('WithdrawalProcessed without an open request falls back to clamped assetsPaid', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');

    emitWithdrawalProcessed(
      DEFAULT_USER,
      10000,
      DEFAULT_USER,
      EIGHTY_ASSETS,
      EIGHTY_ASSETS,
      1_000_100,
      2
    );

    // No request row to subtract from — the clamp keeps the aggregate at zero.
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
    assert.entityCount('VaultWithdrawal', 1);
  });

  test('Processing more than estimated pending still zeroes the total', () => {
    emitDeposit(DEFAULT_USER, HUNDRED_ASSETS, HUNDRED_ASSETS, 1_000_000);
    emitWithdrawalRequested(DEFAULT_USER, 5000, DEFAULT_USER, 1_000_050, 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', FIFTY_ASSETS);

    // The aggregate subtracts the request's own estimate (50), so paying out
    // more than estimated (100) cannot push it negative.
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
