import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
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
import { getOrCreateJackpotFunderConfig } from '../src/helpers/jackpot-funder';
import { JackpotFunderConfig } from '../generated/schema';

const FUNDER = Address.fromString('0xd990413247611013161a7287d262664df8da7309');
const CONFIG_KEY = FUNDER.toHexString();

function emitTwapWindowUpdated(seconds: i32): void {
  const event = changetype<TwapWindowUpdated>(newMockEvent());
  event.address = FUNDER;
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
  event.address = FUNDER;
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
    createMockedFunction(FUNDER, "swapAssetTotalBps", "swapAssetTotalBps():(uint256)").reverts();
    createMockedFunction(FUNDER, "treasuryBrbNumerator", "treasuryBrbNumerator():(uint256)").reverts();
    createMockedFunction(FUNDER, "treasuryBrbDenominator", "treasuryBrbDenominator():(uint256)").reverts();
    createMockedFunction(FUNDER, "slippageBps", "slippageBps():(uint256)").reverts();
    createMockedFunction(FUNDER, "coldSlippageBps", "coldSlippageBps():(uint256)").reverts();
    createMockedFunction(FUNDER, "twapWindowSeconds", "twapWindowSeconds():(uint32)").reverts();
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

  test('bootstraps constructor parameters from getters and keeps reverted values unknown', () => {
    createMockedFunction(FUNDER, 'swapAssetTotalBps', 'swapAssetTotalBps():(uint256)')
      .returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(300))]);
    getOrCreateJackpotFunderConfig(BigInt.fromI32(1000), FUNDER);
    const cfg = JackpotFunderConfig.load(FUNDER)!;
    assert.fieldEquals('JackpotFunderConfig', CONFIG_KEY, 'swapAssetTotalBps', '300');
    assert.booleanEquals(cfg.get('treasuryBrbDenominator') === null, true);
    const other = Address.fromString('0x1111111111111111111111111111111111111111');
    const names = ['swapAssetTotalBps', 'treasuryBrbNumerator', 'treasuryBrbDenominator', 'slippageBps', 'coldSlippageBps'];
    for (let i = 0; i < names.length; i++) {
      createMockedFunction(other, names[i], names[i] + '():(uint256)').reverts();
    }
    createMockedFunction(other, 'twapWindowSeconds', 'twapWindowSeconds():(uint32)').reverts();
    getOrCreateJackpotFunderConfig(BigInt.fromI32(1001), other);
    assert.entityCount('JackpotFunderConfig', 2);
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
