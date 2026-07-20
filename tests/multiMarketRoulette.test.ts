import { BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { PayoutProgress, VrfRequested, RoundCountdownStarted } from '../generated/RouletteEngine/Game';
import { handlePayoutProgress, handleVrfRequested, handleRoundCountdownStarted } from '../src/mappings/roulette';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_ENGINE,
  createRoundForTests,
  emitBetRecorded,
  globalRoundIdHex,
  setupTestMarket,
  testRoundId,
} from './helpers';
import { ROUND_STATUS_BETTING, ROUND_STATUS_NO_MORE_BETS, ROUND_STATUS_VRF, ROUND_STATUS_PAYOUT } from '../src/helpers/constant';

function emitRoundCountdownStarted(roundId: i32, lockAt: i32, timestamp: i32): void {
  const ev = changetype<RoundCountdownStarted>(newMockEvent());
  ev.address = TEST_ENGINE;
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId)))
  );
  ev.parameters.push(new ethereum.EventParam('triggerMarketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  ev.parameters.push(
    new ethereum.EventParam('lockAt', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(lockAt)))
  );
  ev.block.timestamp = BigInt.fromI32(timestamp);
  handleRoundCountdownStarted(ev);
}

describe('Multi-market roulette lifecycle', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket(1);
  });

  test('RoundCountdownStarted sets lockAt but keeps BETTING status', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    emitRoundCountdownStarted(1, 1_000_360, 1_000_000);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'lockAt', '1000360');
  });

  test('RoundCountdownStarted creates the GlobalRound when it precedes BetRecorded in the tx', () => {
    // Real on-chain log order: RoundCountdownStarted is logIndex 0 of the
    // first-bet tx, BEFORE BetRecorded — the entity must be created here, not
    // dropped (the old load + early-return left lockAt unset on every round).
    emitRoundCountdownStarted(1, 1_000_360, 1_000_000);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'lockAt', '1000360');
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'firstBetAt', '1000000');

    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'lockAt', '1000360');
  });

  test('RoundCountdownStarted self-heals GlobalState.roundDuration from lockAt', () => {
    // The engine never emits RoundDurationUpdated for its initialize() value,
    // so roundDuration would otherwise stay at its seeded 0 forever.
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundDuration', '0');

    emitRoundCountdownStarted(1, 1_000_360, 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundDuration', '360');
  });

  test('RoundCountdownStarted leaves roundDuration unchanged when lockAt is not after the block timestamp', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
    emitRoundCountdownStarted(1, 1_000_000, 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundDuration', '0');
  });

  test('BetRecorded creates GlobalRound on first bet', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.entityCount('GlobalRound', 1);
    assert.fieldEquals('Market', '1', 'pendingBets', '10000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '1');
    assert.fieldEquals('DailyStat', '11', 'volume', '10000000000000000000');
    assert.fieldEquals('DailyStat', '11', 'betCount', '1');
  });

  test('VrfRequested locks market rounds and moves GlobalRound to VRF (no separate RoundLocked event)', () => {
    // The engine's TriggerVrf job locks the round and requests VRF in one tx,
    // so VrfRequested is now the lock signal for market rounds.
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    const ev = changetype<VrfRequested>(newMockEvent());
    ev.address = TEST_ENGINE;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(new ethereum.EventParam('newRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.parameters.push(new ethereum.EventParam('requestId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(777))));
    ev.parameters.push(new ethereum.EventParam('timestamp', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1_000_200))));
    ev.block.timestamp = BigInt.fromI32(1_000_200);
    handleVrfRequested(ev);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'status', ROUND_STATUS_VRF);
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'requestId', '777');
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'endedAt', '1000200');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'status', ROUND_STATUS_NO_MORE_BETS);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'roundTransitionInProgress', 'true');
  });

  test('PayoutProgress updates round payout totals and status', () => {
    createRoundForTests(1, 1_000_000);
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    const ev = changetype<PayoutProgress>(newMockEvent());
    ev.address = TEST_ENGINE;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(
      new ethereum.EventParam('globalRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    ev.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.parameters.push(new ethereum.EventParam('fromCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
    ev.parameters.push(new ethereum.EventParam('toCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.parameters.push(
      new ethereum.EventParam('paidAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('5000000000000000000')))
    );
    ev.block.timestamp = BigInt.fromI32(1_000_300);
    handlePayoutProgress(ev);

    assert.fieldEquals('RouletteRound', testRoundId(1), 'status', ROUND_STATUS_PAYOUT);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalPayouts', '5000000000000000000');
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'status', ROUND_STATUS_PAYOUT);
  });
});
