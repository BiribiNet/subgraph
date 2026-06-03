import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { Transfer } from '../generated/BRBReferral/BRBReferral';
import { ReferralSet } from '../generated/RouletteEngine/Game';
import { handleTransfer } from '../src/mappings/referral';
import { handleReferralSet } from '../src/mappings/roulette';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  emitBetRecorded,
  createRoundForTests,
  TEST_ENGINE,
} from './helpers';

const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';
const REFERRAL_TOKEN = Address.fromString('0xb6a6a7c9fc32e30fb5af12ad9d6a5cd2a283ad94');
const ZERO = '0x0000000000000000000000000000000000000000';

function emitReferralTransfer(from: string, to: string, value: string, timestamp: i32 = 1_000_000): void {
  const ev = changetype<Transfer>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(from))));
  ev.parameters.push(new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(to))));
  ev.parameters.push(new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value))));
  ev.address = REFERRAL_TOKEN;
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  handleTransfer(ev);
}

describe('totalLost derived calculation', () => {
  beforeEach(() => {
    clearStore();
  });

  test('After bet placement, totalLost equals totalRouletteBets (no wins yet)', () => {
    createRoundForTests(1, 1_000_000);
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', '10000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalLost', '10000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalWon', '0');
  });

  test('Multiple bets without wins: totalLost accumulates correctly', () => {
    createRoundForTests(1, 1_000_000);
    emitBetRecorded(DEFAULT_USER, '5000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(DEFAULT_USER, '3000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', '8000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalLost', '8000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalWon', '0');
  });
});

describe('BRBR earnings tracking on User', () => {
  beforeEach(() => {
    clearStore();
  });

  test('ReferralSet + bet increments referrer totalBrbrEarned', () => {
    createRoundForTests(1, 1_000_000);
    const bind = changetype<ReferralSet>(newMockEvent());
    bind.address = TEST_ENGINE;
    bind.parameters = new Array<ethereum.EventParam>();
    bind.parameters.push(
      new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    bind.parameters.push(
      new ethereum.EventParam('referrer', ethereum.Value.fromAddress(Address.fromString(USER_ADDRESS_2)))
    );
    bind.block.timestamp = BigInt.fromI32(1_000_000);
    handleReferralSet(bind);
    emitBetRecorded(DEFAULT_USER, '100000000000000000000', CORNER_BET_DATA, 1);

    assert.fieldEquals('User', USER_ADDRESS_2, 'totalBrbrEarned', '100000000000000000000');
    assert.fieldEquals('User', USER_ADDRESS_2, 'totalBrbrSpent', '0');
  });

  test('BRBR burn increments totalBrbrSpent', () => {
    emitReferralTransfer(ZERO, DEFAULT_USER, '100000000000000000000');
    emitReferralTransfer(DEFAULT_USER, ZERO, '30000000000000000000', 1_000_100);

    assert.fieldEquals('User', DEFAULT_USER, 'totalBrbrEarned', '0');
    assert.fieldEquals('User', DEFAULT_USER, 'totalBrbrSpent', '30000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'brbReferalBalance', '70000000000000000000');
  });
});
