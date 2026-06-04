import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
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
  SideBetPlaced,
  SideBetSettled,
  SideBetJackpotFunded,
  SideBetInfrastructureFeePaid,
} from '../generated/SideBet/SideBet';
import {
  handleSideBetPlaced,
  handleSideBetSettled,
  handleSideBetJackpotFunded,
  handleSideBetInfrastructureFeePaid,
} from '../src/mappings/side-bet';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import { handleMarketRegistered } from '../src/mappings/roulette';
import { MarketRegistered } from '../generated/RouletteEngine/Game';

const SIDEBET = Address.fromString('0x1ccc659dcee5af5c42263d1c9a9768d13025a020');
const PLAYER = Address.fromString('0xaaaa000000000000000000000000000000000001');
const ASSET = Address.fromString('0xbbbb000000000000000000000000000000000001');
const BANK = Address.fromString('0xcccc000000000000000000000000000000000001');
const ENGINE = Address.fromString('0x2f6bbd7df2e997788a6a3759edcd7282028d40bd');

function registerMarket(): void {
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
  createMockedFunction(BANK, 'minBet', 'minBet():(uint256)').returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromString('5000000')),
  ]);

  const event = changetype<MarketRegistered>(newMockEvent());
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET)));
  event.parameters.push(new ethereum.EventParam('bank', ethereum.Value.fromAddress(BANK)));
  event.address = ENGINE;
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10000);
  handleMarketRegistered(event);
}

function mockGetBet(betId: string): void {
  createMockedFunction(
    SIDEBET,
    'getBet',
    'getBet(uint256):((address,uint32,uint256,uint256,uint64,uint16,uint8,uint8,uint8,uint16,uint16,uint8,uint64,uint64))'
  ).withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromString(betId))]).returns([
    ethereum.Value.fromTuple(changetype<ethereum.Tuple>([
      ethereum.Value.fromAddress(PLAYER),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000')),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString('2000000')),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1_000_000)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
    ])),
  ]);
}

function mockGetConfig(configId: string): void {
  createMockedFunction(
    SIDEBET,
    'getConfig',
    'getConfig(uint256):((uint32,uint8,uint8,uint8,uint16,uint16,uint16,uint32,uint256,uint256))'
  ).withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromString(configId))]).returns([
    ethereum.Value.fromTuple(changetype<ethereum.Tuple>([
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(20000)),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000')),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString('10000000')),
    ])),
  ]);
}

function placeBet(betId: string, configId: string, logIndex: i32): void {
  mockGetBet(betId);
  mockGetConfig(configId);

  const event = changetype<SideBetPlaced>(newMockEvent());
  event.address = SIDEBET;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(1_000_100);
  event.block.number = BigInt.fromI32(10001);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('betId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(betId))));
  event.parameters.push(new ethereum.EventParam('player', ethereum.Value.fromAddress(PLAYER)));
  event.parameters.push(new ethereum.EventParam('configId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(configId))));
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam('stake', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000'))));
  event.parameters.push(new ethereum.EventParam('payout', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('2000000'))));
  event.parameters.push(new ethereum.EventParam('startGlobalRound', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10))));
  event.parameters.push(new ethereum.EventParam('windowSpins', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5))));
  handleSideBetPlaced(event);
}

describe('SideBet indexing', () => {
  beforeEach(() => {
    clearStore();
    registerMarket();
  });

  test('SideBetPlaced creates SideBet and SideBetConfig', () => {
    placeBet('0', '0', 0);

    assert.entityCount('SideBet', 1);
    assert.fieldEquals('SideBet', '0x00', 'betType', 'NUMBER_HIT');
    assert.fieldEquals('SideBet', '0x00', 'stake', '1000000');
    assert.fieldEquals('SideBet', '0x00', 'potentialPayout', '2000000');
    assert.fieldEquals('SideBet', '0x00', 'status', 'ACTIVE');
    assert.entityCount('SideBetConfig', 1);
    assert.fieldEquals('SideBetConfig', '0', 'windowSpins', '5');
  });

  test('SideBetSettled updates status and creates settlement', () => {
    placeBet('1', '0', 0);

    const settle = changetype<SideBetSettled>(newMockEvent());
    settle.address = SIDEBET;
    settle.logIndex = BigInt.fromI32(1);
    settle.block.timestamp = BigInt.fromI32(1_000_200);
    settle.block.number = BigInt.fromI32(10002);
    settle.parameters = new Array<ethereum.EventParam>();
    settle.parameters.push(new ethereum.EventParam('betId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    settle.parameters.push(new ethereum.EventParam('player', ethereum.Value.fromAddress(PLAYER)));
    settle.parameters.push(new ethereum.EventParam('outcome', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    settle.parameters.push(new ethereum.EventParam('payout', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('2000000'))));
    handleSideBetSettled(settle);

    const settlementId = settle.transaction.hash.concat(bigintToBytes(settle.logIndex)).toHexString();
    assert.fieldEquals('SideBet', '0x01', 'status', 'WON');
    assert.fieldEquals('SideBet', '0x01', 'actualPayout', '2000000');
    assert.entityCount('SideBetSettlement', 1);
    assert.fieldEquals('SideBetSettlement', settlementId, 'outcome', 'WON');
  });

  test('SideBetJackpotFunded and InfrastructureFeePaid accrue on Market', () => {
    registerMarket();

    const jackpot = changetype<SideBetJackpotFunded>(newMockEvent());
    jackpot.address = SIDEBET;
    jackpot.parameters = new Array<ethereum.EventParam>();
    jackpot.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    jackpot.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000')))
    );
    handleSideBetJackpotFunded(jackpot);

    const infra = changetype<SideBetInfrastructureFeePaid>(newMockEvent());
    infra.address = SIDEBET;
    infra.parameters = new Array<ethereum.EventParam>();
    infra.parameters.push(
      new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    infra.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('500000')))
    );
    handleSideBetInfrastructureFeePaid(infra);

    assert.fieldEquals('Market', '1', 'sideBetJackpotFees', '1000000');
    assert.fieldEquals('Market', '1', 'sideBetInfraFees', '500000');
  });
});
