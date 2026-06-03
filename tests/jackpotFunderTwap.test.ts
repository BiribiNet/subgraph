import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import {
  ColdSlippageBpsUpdated,
  TwapWindowUpdated,
} from '../generated/BRBJackpotFunder/BRBJackpotFunder';
import {
  handleColdSlippageBpsUpdated,
  handleTwapWindowUpdated,
} from '../src/mappings/jackpot-funder';

const CONFIG_KEY = Bytes.fromUTF8('config').toHexString();

function emitTwapWindowUpdated(seconds: i32): void {
  const event = changetype<TwapWindowUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'twapWindowSeconds',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(seconds))
    )
  );
  event.block.timestamp = BigInt.fromI32(2_000_000);
  event.block.number = BigInt.fromI32(20_000);
  handleTwapWindowUpdated(event);
}

function emitColdSlippageBpsUpdated(bps: i32): void {
  const event = changetype<ColdSlippageBpsUpdated>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'coldSlippageBps',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(bps))
    )
  );
  event.block.timestamp = BigInt.fromI32(2_000_100);
  event.block.number = BigInt.fromI32(20_001);
  handleColdSlippageBpsUpdated(event);
}

describe('BRBJackpotFunder TWAP config', () => {
  beforeEach(() => {
    clearStore();
  });

  test('TwapWindowUpdated updates the funder config singleton', () => {
    emitTwapWindowUpdated(1800);

    assert.entityCount('JackpotFunderConfig', 1);
    assert.fieldEquals(
      'JackpotFunderConfig',
      CONFIG_KEY,
      'twapWindowSeconds',
      '1800'
    );
  });

  test('ColdSlippageBpsUpdated updates the funder config singleton', () => {
    emitColdSlippageBpsUpdated(250);

    assert.fieldEquals(
      'JackpotFunderConfig',
      CONFIG_KEY,
      'coldSlippageBps',
      '250'
    );
  });
});
