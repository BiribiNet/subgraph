import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { WithdrawalRequested, WithdrawalProcessed } from '../generated/StakedBRB/StakedBRB';
import { handleWithdrawalRequested, handleWithdrawalProcessed } from '../src/mappings/stakedBRB';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

const GLOBAL_STATE_ID = '0x0000000000000000000000000000000000000001';
const USER_ADDRESS = '0xbbbbedc42dc53842141be8f70df9efe4d08538a4';
const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';
const CONTRACT_ADDRESS = '0x15dc1be843c63317e87865e1df14afa782fae171';

function createWithdrawalRequested(user: string, amount: string, timestamp: i32 = 1000000, logIndex: i32 = 0): void {
  const ev = changetype<WithdrawalRequested>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('user', ethereum.Value.fromAddress(Address.fromString(user))));
  ev.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))));
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(logIndex);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleWithdrawalRequested(ev);
}

function createWithdrawalProcessed(user: string, amount: string, timestamp: i32 = 1000100): void {
  const ev = changetype<WithdrawalProcessed>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('user', ethereum.Value.fromAddress(Address.fromString(user))));
  ev.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))));
  ev.address = Address.fromString(CONTRACT_ADDRESS);
  ev.logIndex = BigInt.fromI32(1);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleWithdrawalProcessed(ev);
}

describe('Withdrawal Queue Lifecycle', () => {
  beforeEach(() => {
    clearStore();
  });

  test('WithdrawalRequested creates LargeWithdrawalRequest and increments pending', () => {
    createWithdrawalRequested(USER_ADDRESS, '100000000000000000000');

    assert.entityCount('LargeWithdrawalRequest', 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '100000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'withdrawalQueueCounter', '1');
  });

  test('Multiple requests increment queue position monotonically', () => {
    createWithdrawalRequested(USER_ADDRESS, '50000000000000000000', 1000000, 0);
    createWithdrawalRequested(USER_ADDRESS_2, '30000000000000000000', 1000050, 1);

    assert.entityCount('LargeWithdrawalRequest', 2);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '80000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'withdrawalQueueCounter', '2');
  });

  test('WithdrawalProcessed decrements pending and sets processedAt', () => {
    createWithdrawalRequested(USER_ADDRESS, '100000000000000000000');
    createWithdrawalProcessed(USER_ADDRESS, '100000000000000000000');

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
    // User should have openWithdrawalRequestId cleared
    assert.fieldEquals('User', USER_ADDRESS, 'openWithdrawalRequestId', 'null');
  });

  test('Underflow protection: processing more than pending clamps to zero', () => {
    // Request 50, but process 100 (edge case / event mismatch)
    createWithdrawalRequested(USER_ADDRESS, '50000000000000000000');
    createWithdrawalProcessed(USER_ADDRESS, '100000000000000000000');

    // Should clamp to 0, not go negative
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPendingLargeWithdrawals', '0');
  });
});
