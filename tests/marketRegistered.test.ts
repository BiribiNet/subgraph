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

import { MarketRegistered } from '../generated/RouletteEngine/Game';
import { handleMarketRegistered } from '../src/mappings/roulette';

const ENGINE = Address.fromString('0x15dc1be843c63317e87865e1df14afa782fae171');
const ASSET = Address.fromString('0xaaaa000000000000000000000000000000000001');
const BANK = Address.fromString('0xbbbb000000000000000000000000000000000001');

function mockTokenMetadata(): void {
  createMockedFunction(ASSET, 'symbol', 'symbol():(string)').returns([
    ethereum.Value.fromString('USDC'),
  ]);
  createMockedFunction(ASSET, 'decimals', 'decimals():(uint8)').returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(6)),
  ]);
  createMockedFunction(BANK, 'name', 'name():(string)').returns([
    ethereum.Value.fromString('Biribi USDC Vault'),
  ]);
  createMockedFunction(BANK, 'symbol', 'symbol():(string)').returns([
    ethereum.Value.fromString('bvUSDC'),
  ]);
}

function registerMarket(): void {
  const event = changetype<MarketRegistered>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET)));
  event.parameters.push(new ethereum.EventParam('bank', ethereum.Value.fromAddress(BANK)));
  event.address = ENGINE;
  event.logIndex = BigInt.fromI32(0);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10000);
  handleMarketRegistered(event);
}

describe('MarketRegistered tests', () => {
  beforeEach(() => {
    clearStore();
  });

  test('populates token metadata from on-chain reads', () => {
    mockTokenMetadata();
    registerMarket();

    assert.entityCount('Market', 1);
    assert.fieldEquals('Market', '1', 'assetSymbol', 'USDC');
    assert.fieldEquals('Market', '1', 'assetDecimals', '6');
    assert.fieldEquals('Market', '1', 'shareName', 'Biribi USDC Vault');
    assert.fieldEquals('Market', '1', 'shareSymbol', 'bvUSDC');
    assert.fieldEquals('Market', '1', 'asset', ASSET.toHexString());
    assert.fieldEquals('Market', '1', 'bank', BANK.toHexString());
  });

  test('falls back to defaults when metadata calls revert', () => {
    createMockedFunction(ASSET, 'symbol', 'symbol():(string)').reverts();
    createMockedFunction(ASSET, 'decimals', 'decimals():(uint8)').reverts();
    createMockedFunction(BANK, 'name', 'name():(string)').reverts();
    createMockedFunction(BANK, 'symbol', 'symbol():(string)').reverts();
    registerMarket();

    assert.entityCount('Market', 1);
    assert.fieldEquals('Market', '1', 'assetSymbol', '');
    assert.fieldEquals('Market', '1', 'assetDecimals', '0');
    assert.fieldEquals('Market', '1', 'shareName', '');
    assert.fieldEquals('Market', '1', 'shareSymbol', '');
  });
});
