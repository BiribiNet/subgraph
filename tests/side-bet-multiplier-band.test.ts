import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { MultiplierBandUpdated } from '../generated/SideBet/SideBet';
import { handleMultiplierBandUpdated } from '../src/mappings/side-bet';

const CONFIG_ID = Bytes.fromUTF8('config').toHexString();

function emitMultiplierBandUpdated(minBps: i32, maxBps: i32): void {
  const event = changetype<MultiplierBandUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('minMultiplierBps', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(minBps)))
  );
  event.parameters.push(
    new ethereum.EventParam('maxMultiplierBps', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(maxBps)))
  );
  event.block.timestamp = BigInt.fromI32(1_000_000);
  handleMultiplierBandUpdated(event);
}

describe('SideBet MultiplierBandUpdated', () => {
  beforeEach(() => {
    clearStore();
  });

  test('creates the SideBetGlobalConfig singleton with the band bounds', () => {
    emitMultiplierBandUpdated(20000, 5000000);
    assert.entityCount('SideBetGlobalConfig', 1);
    assert.fieldEquals('SideBetGlobalConfig', CONFIG_ID, 'minMultiplierBps', '20000');
    assert.fieldEquals('SideBetGlobalConfig', CONFIG_ID, 'maxMultiplierBps', '5000000');
  });

  test('updates the existing singleton on a later band change', () => {
    emitMultiplierBandUpdated(20000, 5000000);
    emitMultiplierBandUpdated(10000, 6000000);
    assert.entityCount('SideBetGlobalConfig', 1);
    assert.fieldEquals('SideBetGlobalConfig', CONFIG_ID, 'minMultiplierBps', '10000');
    assert.fieldEquals('SideBetGlobalConfig', CONFIG_ID, 'maxMultiplierBps', '6000000');
  });
});
