import { BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { RoundResolved } from '../generated/RouletteEngine/Game';
import { handleRoundResolved } from '../src/mappings/roulette';
import { ZERO_ADDRESS } from '../src/helpers/constant';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_ENGINE,
  createRoundForTests,
  emitBetRecorded,
  emitBrbTransfer,
  emitDeposit,
  setupTestMarket,
} from './helpers';

const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';

function createRoundResolvedEvent(roundId: i32, timestamp: i32 = 1_000_300): RoundResolved {
  const ev = changetype<RoundResolved>(newMockEvent());
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId)))
  );
  ev.address = TEST_ENGINE;
  ev.logIndex = BigInt.fromI32(0);
  ev.block.timestamp = BigInt.fromI32(timestamp);
  ev.block.number = BigInt.fromI32(timestamp / 100);
  return ev;
}

describe('GlobalState lifetime analytics', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('only one GlobalState entity exists', () => {
    assert.entityCount('GlobalState', 1);
    assert.entityCount('ProtocolStats', 0);
  });

  test('bet increments totalWagered, totalBets, and totalPlayers', () => {
    createRoundForTests(1, 1_000_000);
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalWagered', '10000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalBets', '1');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPlayers', '1');
  });

  test('second unique player increments totalPlayers once', () => {
    createRoundForTests(1, 1_000_000);
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 0);
    emitBetRecorded(USER_ADDRESS_2, '5000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_100, 1);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalWagered', '15000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalBets', '2');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPlayers', '2');
  });

  test('round resolved increments totalRounds', () => {
    createRoundForTests(1, 1_000_000);
    handleRoundResolved(createRoundResolvedEvent(1));

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalRounds', '1');
  });

  test('BRB mint increments brbTotalSupply', () => {
    emitBrbTransfer(ZERO_ADDRESS, DEFAULT_USER, '1000000000000000000', 1_000_000, 0, false);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'brbTotalSupply', '1000000000000000000');
  });

  test('BRB burn increments totalBurned and decrements brbTotalSupply', () => {
    emitBrbTransfer(ZERO_ADDRESS, DEFAULT_USER, '2000000000000000000', 1_000_000, 0, false);
    emitBrbTransfer(DEFAULT_USER, ZERO_ADDRESS, '500000000000000000', 1_000_100, 1, false);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalBurned', '500000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'brbTotalSupply', '1500000000000000000');
  });

  test('vault deposit increments totalDeposited', () => {
    emitDeposit(DEFAULT_USER, '3000000000000000000', '3000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalDeposited', '3000000000000000000');
  });
});
