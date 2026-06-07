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
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  TEST_ENGINE,
  emitBetRecorded,
  emitBrbTransfer,
  testRoundId,
} from './helpers';

const SECOND_USER = '0x26450a1cf100f86f56b2228da6f7105907718628';
const ZERO_ADDRESS_STR = '0x0000000000000000000000000000000000000000';

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

describe('RouletteRound extra fields (uniqueBettors / stakersRevenue / roundBurnAmount)', () => {
  beforeEach(() => {
    clearStore();
  });

  test('uniqueBettors counts distinct players, not placements', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'uniqueBettors', '1');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'betCount', '1');

    // Same user bets again in the same round → uniqueBettors stays 1, betCount increments.
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'uniqueBettors', '1');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'betCount', '2');

    // A different user bets → uniqueBettors becomes 2.
    emitBetRecorded(SECOND_USER, '10000000000000000000', CORNER_BET_DATA, 1, 1, 1_000_000, 2);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'uniqueBettors', '2');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'betCount', '3');
  });

  test('stakersRevenue is set to gross revenue on resolve when no jackpot/infra shares', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', '10000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'stakersRevenue', '0');

    handleRoundResolved(createRoundResolvedEvent(1));

    // grossRevenue = totalBets - totalPayouts = 10e18 - 0; jackpot/infra = 0 → stakers take all.
    assert.fieldEquals('RouletteRound', testRoundId(1), 'stakersRevenue', '10000000000000000000');
  });

  test('roundBurnAmount accumulates BRB burns attributed to the paid round', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'roundBurnAmount', '0');

    // RoundResolved sets GlobalState.lastRoundPaid = 1, so the burn is attributed to round 1.
    handleRoundResolved(createRoundResolvedEvent(1));

    emitBrbTransfer(DEFAULT_USER, ZERO_ADDRESS_STR, '50000000000000000', 1_000_400, 5);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'roundBurnAmount', '50000000000000000');
  });

  test('failedPayoutBatches / failedJackpotBatches default to 0', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'failedPayoutBatches', '0');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'failedJackpotBatches', '0');
  });
});
