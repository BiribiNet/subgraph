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
  ConfigAdded,
  ConfigRemoved,
  SideBetPlaced,
  SideBetSettled,
  SideBetJackpotFunded,
  SideBetInfrastructureFeePaid,
} from '../generated/SideBet/SideBet';
import {
  handleConfigAdded,
  handleConfigRemoved,
  handleSideBetPlaced,
  handleSideBetSettled,
  handleSideBetJackpotFunded,
  handleSideBetInfrastructureFeePaid,
} from '../src/mappings/side-bet';
import { bigintToBytes } from '../src/helpers/bigintToBytes';
import { SideBet } from '../generated/schema';
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

/** `getConfig` reverts for a removed config — the contract raises ConfigInactive, not marketId 0. */
function mockGetConfigReverts(configId: string): void {
  createMockedFunction(
    SIDEBET,
    'getConfig',
    'getConfig(uint256):((uint32,uint8,uint8,uint8,uint16,uint16,uint16,uint32,uint256,uint256))'
  )
    .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromString(configId))])
    .reverts();
}

function mockGetBetReverts(betId: string): void {
  createMockedFunction(
    SIDEBET,
    'getBet',
    'getBet(uint256):((address,uint32,uint256,uint256,uint64,uint16,uint8,uint8,uint8,uint16,uint16,uint8,uint64,uint64))'
  )
    .withArgs([ethereum.Value.fromUnsignedBigInt(BigInt.fromString(betId))])
    .reverts();
}

function addConfig(configId: string): void {
  mockGetConfig(configId);
  const event = changetype<ConfigAdded>(newMockEvent());
  event.address = SIDEBET;
  event.block.timestamp = BigInt.fromI32(1_000_050);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('configId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(configId)))
  );
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam('betType', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  handleConfigAdded(event);
}

function removeConfig(configId: string): void {
  const event = changetype<ConfigRemoved>(newMockEvent());
  event.address = SIDEBET;
  event.block.timestamp = BigInt.fromI32(1_000_300);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('configId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(configId)))
  );
  handleConfigRemoved(event);
}

/** Emit `SideBetPlaced` without mocking any read, so the event-only path is what gets exercised. */
function emitSideBetPlaced(betId: string, configId: string, marketId: i32, logIndex: i32): void {
  const event = changetype<SideBetPlaced>(newMockEvent());
  event.address = SIDEBET;
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(1_000_100);
  event.block.number = BigInt.fromI32(10001);
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('betId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(betId))));
  event.parameters.push(new ethereum.EventParam('player', ethereum.Value.fromAddress(PLAYER)));
  event.parameters.push(new ethereum.EventParam('configId', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(configId))));
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(marketId))));
  event.parameters.push(new ethereum.EventParam('stake', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000'))));
  event.parameters.push(new ethereum.EventParam('payout', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('2000000'))));
  event.parameters.push(new ethereum.EventParam('startGlobalRound', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(10))));
  event.parameters.push(new ethereum.EventParam('windowSpins', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(5))));
  handleSideBetPlaced(event);
}

function placeBet(betId: string, configId: string, logIndex: i32): void {
  mockGetBet(betId);
  mockGetConfig(configId);
  emitSideBetPlaced(betId, configId, 1, logIndex);
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

  test('SideBetConfig records a numeric configId so consumers can order by it', () => {
    addConfig('0');

    // `id` is a string, so ordering by it puts config 10 before config 2.
    assert.fieldEquals('SideBetConfig', '0', 'configId', '0');
    assert.fieldEquals('SideBetConfig', '0', 'active', 'true');
  });

  test('ConfigRemoved deactivates the config even though getConfig reverts', () => {
    addConfig('0');
    assert.fieldEquals('SideBetConfig', '0', 'active', 'true');

    // After removal the contract raises ConfigInactive rather than returning marketId 0, so a
    // handler that reads the config to decide would never deactivate anything.
    mockGetConfigReverts('0');
    removeConfig('0');

    assert.fieldEquals('SideBetConfig', '0', 'active', 'false');
  });

  test('SideBetPlaced still indexes the bet when getBet reverts', () => {
    addConfig('0');
    mockGetBetReverts('3');

    emitSideBetPlaced('3', '0', 1, 0);

    // The event alone carries the money fields, so nothing is lost.
    assert.entityCount('SideBet', 1);
    assert.fieldEquals('SideBet', '0x03', 'stake', '1000000');
    assert.fieldEquals('SideBet', '0x03', 'potentialPayout', '2000000');
    assert.fieldEquals('SideBet', '0x03', 'startGlobalRound', '10');
    assert.fieldEquals('SideBet', '0x03', 'windowSpins', '5');
    assert.fieldEquals('SideBet', '0x03', 'status', 'ACTIVE');
    // Bet kind falls back to the indexed config.
    assert.fieldEquals('SideBet', '0x03', 'betType', 'NUMBER_HIT');
    assert.fieldEquals('SideBet', '0x03', 'multiplierBps', '20000');
  });

  test('SideBetPlaced still indexes the bet when neither getBet nor the config is available', () => {
    mockGetBetReverts('4');
    mockGetConfigReverts('9');

    emitSideBetPlaced('4', '9', 1, 0);

    assert.entityCount('SideBet', 1);
    assert.fieldEquals('SideBet', '0x04', 'stake', '1000000');
    assert.fieldEquals('SideBet', '0x04', 'market', '1');
  });

  test('SideBetPlaced still indexes a bet whose market is not registered yet', () => {
    mockGetBet('5');
    mockGetConfig('0');

    // Market 7 was never registered — previously the bet was dropped and never backfilled.
    emitSideBetPlaced('5', '0', 7, 0);

    assert.entityCount('SideBet', 1);
    assert.fieldEquals('SideBet', '0x05', 'market', '7');
    assert.fieldEquals('SideBet', '0x05', 'stake', '1000000');
  });

  test('a bet recovered at settlement leaves configId null rather than a wrong 0', () => {
    mockGetBet('6');

    const settle = changetype<SideBetSettled>(newMockEvent());
    settle.address = SIDEBET;
    settle.logIndex = BigInt.fromI32(0);
    settle.block.timestamp = BigInt.fromI32(1_000_400);
    settle.block.number = BigInt.fromI32(10003);
    settle.parameters = new Array<ethereum.EventParam>();
    settle.parameters.push(new ethereum.EventParam('betId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(6))));
    settle.parameters.push(new ethereum.EventParam('player', ethereum.Value.fromAddress(PLAYER)));
    settle.parameters.push(new ethereum.EventParam('outcome', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))));
    settle.parameters.push(new ethereum.EventParam('payout', ethereum.Value.fromUnsignedBigInt(BigInt.zero())));
    handleSideBetSettled(settle);

    assert.entityCount('SideBet', 1);
    assert.fieldEquals('SideBet', '0x06', 'status', 'LOST');
    // SideBetSettled carries no configId and the on-chain Bet struct does not store one.
    const bet = SideBet.load(bigintToBytes(BigInt.fromI32(6)))!;
    assert.assertTrue(bet.configId === null);
  });
});
