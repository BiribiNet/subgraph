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
import { CORNER_BET_DATA, emitBetRecorded, setupTestMarket, TEST_ENGINE } from './helpers';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import { ZERO_ADDRESS } from '../src/helpers/constant';

const REFERRER = '0xbbbbedc42dc53842141be8f70df9efe4d08538a4';
const REFEREE = '0xccccccdc53842141be8f70df9efe4d08538a5555';
const ONE_BRB = '1000000000000000000';

// Builds a BRBReferral Transfer event, runs the handler, and returns the
// deterministic id of the BRBReferalTransfer entity it creates.
function emitTransfer(from: string, to: string, value: string, logIndex: i32): string {
  const event = changetype<Transfer>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(
    new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(to)))
  );
  event.parameters.push(
    new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value)))
  );
  event.address = Address.fromString('0x48e85e0f774f0d0d44519b13a959d9faa78e831b');
  event.block.timestamp = BigInt.fromI32(1000000);
  event.block.number = BigInt.fromI32(10000);
  event.logIndex = BigInt.fromI32(logIndex);
  handleTransfer(event);
  return event.transaction.hash.concat(bigintToBytes(event.logIndex)).toHexString();
}

function emitReferralSet(player: string, referrer: string): void {
  const event = changetype<ReferralSet>(newMockEvent());
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(player)))
  );
  event.parameters.push(
    new ethereum.EventParam('referrer', ethereum.Value.fromAddress(Address.fromString(referrer)))
  );
  event.block.timestamp = BigInt.fromI32(1_000_000);
  handleReferralSet(event);
}

describe('BRBReferral Transfer handler', () => {
  beforeEach(() => {
    clearStore();
  });

  test('credits the referrer (mint) and records a credit transfer', () => {
    const id = emitTransfer(ZERO_ADDRESS, REFERRER, ONE_BRB, 0);

    assert.entityCount('BRBReferalTransfer', 1);
    assert.fieldEquals('BRBReferalTransfer', id, 'isCredit', 'true');
    assert.fieldEquals('BRBReferalTransfer', id, 'user', REFERRER);
    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', '0');
    assert.fieldEquals('User', REFERRER, 'brbReferalBalance', ONE_BRB);
  });

  test('recomputes BRBpoints (x2 weight) and tier when bet follows ReferralSet', () => {
    setupTestMarket();
    emitReferralSet(REFEREE, REFERRER);
    emitBetRecorded(REFEREE, ONE_BRB, CORNER_BET_DATA, 1);

    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', ONE_BRB);
    assert.fieldEquals('User', REFERRER, 'brbpPoints', '2');
    assert.fieldEquals('User', REFERRER, 'tier', 'BRONZE');
  });

  test('records the referee address as the transfer `from`', () => {
    const id = emitTransfer(REFEREE, REFERRER, ONE_BRB, 0);

    assert.fieldEquals('BRBReferalTransfer', id, 'from', REFEREE);
    assert.fieldEquals('BRBReferalTransfer', id, 'isCredit', 'true');
  });

  test('burn (to zero) debits the holder and records a non-credit transfer', () => {
    emitTransfer(ZERO_ADDRESS, REFERRER, ONE_BRB, 0);
    const burnId = emitTransfer(REFERRER, ZERO_ADDRESS, ONE_BRB, 1);

    assert.entityCount('BRBReferalTransfer', 2);
    assert.fieldEquals('BRBReferalTransfer', burnId, 'isCredit', 'false');
    assert.fieldEquals('User', REFERRER, 'brbReferalBalance', '0');
    assert.fieldEquals('User', REFERRER, 'totalBrbrSpent', ONE_BRB);
  });

  test('accumulates BRBr across multiple bets for the same referrer', () => {
    setupTestMarket();
    emitReferralSet(REFEREE, REFERRER);
    emitBetRecorded(REFEREE, ONE_BRB, CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(REFEREE, ONE_BRB, CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', '2000000000000000000');
    assert.fieldEquals('User', REFERRER, 'brbpPoints', '4');
  });

  test('tracks two referrers independently', () => {
    setupTestMarket();
    const otherReferee = '0xddddddddc53842141be8f70df9efe4d08538a777';
    const otherReferrer = '0xeeeeeeee53842141be8f70df9efe4d08538a8888';
    emitReferralSet(REFEREE, REFERRER);
    emitReferralSet(otherReferee, otherReferrer);
    emitBetRecorded(REFEREE, ONE_BRB, CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(otherReferee, '3000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', ONE_BRB);
    assert.fieldEquals('User', otherReferrer, 'totalBrbrEarned', '3000000000000000000');
  });

  test('records the credit transfer value and recipient', () => {
    const id = emitTransfer(REFEREE, REFERRER, ONE_BRB, 0);

    assert.fieldEquals('BRBReferalTransfer', id, 'value', ONE_BRB);
    assert.fieldEquals('BRBReferalTransfer', id, 'to', REFERRER);
    assert.fieldEquals('BRBReferalTransfer', id, 'user', REFERRER);
  });
});
