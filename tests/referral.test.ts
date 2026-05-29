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
import { handleTransfer } from '../src/mappings/referral';
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

describe('BRBReferral Transfer handler', () => {
  beforeEach(() => {
    clearStore();
  });

  test('credits the referrer (mint) and records a credit transfer', () => {
    const id = emitTransfer(ZERO_ADDRESS, REFERRER, ONE_BRB, 0);

    assert.entityCount('BRBReferalTransfer', 1);
    assert.fieldEquals('BRBReferalTransfer', id, 'isCredit', 'true');
    assert.fieldEquals('BRBReferalTransfer', id, 'user', REFERRER);
    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', ONE_BRB);
    assert.fieldEquals('User', REFERRER, 'brbReferalBalance', ONE_BRB);
  });

  test('recomputes BRBpoints (x2 weight) and tier on credit', () => {
    emitTransfer(ZERO_ADDRESS, REFERRER, ONE_BRB, 0);

    // points = (0*3 + 0*1 + 1e18*2) / 1e18 = 2
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

  test('accumulates BRBr across multiple credits to the same referrer', () => {
    emitTransfer(REFEREE, REFERRER, ONE_BRB, 0);
    emitTransfer(REFEREE, REFERRER, ONE_BRB, 1);

    assert.entityCount('BRBReferalTransfer', 2);
    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', '2000000000000000000');
    assert.fieldEquals('User', REFERRER, 'brbReferalBalance', '2000000000000000000');
    // points = (0*3 + 0*1 + 2e18*2) / 1e18 = 4
    assert.fieldEquals('User', REFERRER, 'brbpPoints', '4');
  });

  test('tracks two referrers independently', () => {
    const other = '0xddddddddc53842141be8f70df9efe4d08538a777';
    emitTransfer(REFEREE, REFERRER, ONE_BRB, 0);
    emitTransfer(REFEREE, other, '3000000000000000000', 1);

    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', ONE_BRB);
    assert.fieldEquals('User', other, 'totalBrbrEarned', '3000000000000000000');
  });

  test('records the credit transfer value and recipient', () => {
    const id = emitTransfer(REFEREE, REFERRER, ONE_BRB, 0);

    assert.fieldEquals('BRBReferalTransfer', id, 'value', ONE_BRB);
    assert.fieldEquals('BRBReferalTransfer', id, 'to', REFERRER);
    assert.fieldEquals('BRBReferalTransfer', id, 'user', REFERRER);
  });
});
