import { BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { PayoutProgress, RoundLocked, RoundCountdownStarted } from '../generated/RouletteEngine/Game';
import { handlePayoutProgress, handleRoundLocked, handleRoundCountdownStarted } from '../src/mappings/roulette';
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
import { ROUND_STATUS_BETTING, ROUND_STATUS_NO_MORE_BETS, ROUND_STATUS_PAYOUT } from '../src/helpers/constant';

describe('Multi-market roulette lifecycle', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket(1);
  });

  test('RoundCountdownStarted sets lockAt but keeps BETTING status', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    const ev = changetype<RoundCountdownStarted>(newMockEvent());
    ev.address = TEST_ENGINE;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(
      new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
    );
    ev.parameters.push(new ethereum.EventParam('triggerMarketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.parameters.push(
      new ethereum.EventParam('lockAt', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1_000_360)))
    );
    ev.block.timestamp = BigInt.fromI32(1_000_000);
    handleRoundCountdownStarted(ev);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'status', ROUND_STATUS_BETTING);
    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'lockAt', '1000360');
  });

  test('BetRecorded creates GlobalRound on first bet', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    assert.entityCount('GlobalRound', 1);
    assert.fieldEquals('Market', '1', 'pendingBets', '10000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentRoundNumber', '1');
    assert.fieldEquals('DailyStat', '11', 'volume', '10000000000000000000');
    assert.fieldEquals('DailyStat', '11', 'betCount', '1');
  });

  test('RoundLocked updates GlobalRound status', () => {
    emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);

    const ev = changetype<RoundLocked>(newMockEvent());
    ev.address = TEST_ENGINE;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.parameters.push(new ethereum.EventParam('globalRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
    ev.block.timestamp = BigInt.fromI32(1_000_200);
    handleRoundLocked(ev);

    assert.fieldEquals('GlobalRound', globalRoundIdHex(1), 'status', ROUND_STATUS_NO_MORE_BETS);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'status', ROUND_STATUS_NO_MORE_BETS);
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
