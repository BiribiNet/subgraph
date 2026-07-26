import { BigInt, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { PayoutProgress } from '../generated/RouletteEngine/Game';
import { handlePayoutProgress } from '../src/mappings/roulette';
import { JACKPOT_TREASURY_ADDRESS, ZERO_ADDRESS } from '../src/helpers/constant';
import { getOrCreateGlobalState } from '../src/helpers/globalState';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_ENGINE,
  createRoundForTests,
  emitBetRecorded,
  emitBrbTransfer,
} from './helpers';

// Mirrors src/helpers/constant.ts so a protocol redeploy cannot silently desync
// these assertions from the address the mappings actually match on. A stale
// constant here was the original cause of the jackpot pool sitting at 0.
const TREASURY = JACKPOT_TREASURY_ADDRESS.toHexString();
const FUNDER = '0xd990413247611013161a7287d262664df8da7309';

const SECONDS_PER_DAY = 86400;

/** DailyStat ids are the unix day number as a decimal string. */
function dayId(timestamp: i32): string {
  return BigInt.fromI32(timestamp).div(BigInt.fromI32(SECONDS_PER_DAY)).toString();
}

function emitPayoutProgress(globalRoundId: i32, paidAmount: string, timestamp: i32): void {
  const ev = changetype<PayoutProgress>(newMockEvent());
  ev.address = TEST_ENGINE;
  ev.parameters = new Array<ethereum.EventParam>();
  ev.parameters.push(
    new ethereum.EventParam('globalRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(globalRoundId)))
  );
  ev.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  ev.parameters.push(new ethereum.EventParam('fromCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
  ev.parameters.push(new ethereum.EventParam('toCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  ev.parameters.push(
    new ethereum.EventParam('paidAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(paidAmount)))
  );
  ev.block.timestamp = BigInt.fromI32(timestamp);
  handlePayoutProgress(ev);
}

/**
 * Puts round 1 into PAYOUT with a bet from DEFAULT_USER and points
 * `lastRoundPaid` at it — the two preconditions `tryRecordMarketPayoutTransfer`
 * needs before it will attribute a treasury transfer to a winner. Only
 * `processRoundResolved` sets `lastRoundPaid` in production, so the test sets it
 * directly rather than driving a full resolve.
 */
function arrangeResolvingRoundWithBet(timestamp: i32): void {
  createRoundForTests(1, timestamp);
  emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
  emitPayoutProgress(1, '5000000000000000000', timestamp + 300);

  const state = getOrCreateGlobalState();
  state.lastRoundPaid = BigInt.fromI32(1);
  state.save();
}

describe('jackpot pool accounting', () => {
  beforeEach(() => {
    clearStore();
  });

  test('BRB transfer to the treasury credits the pool and stamps the daily snapshot', () => {
    emitBrbTransfer(FUNDER, TREASURY, '250000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentJackpot', '250000000000000000000');
    assert.fieldEquals('DailyStat', dayId(1_000_000), 'jackpotFunded', '250000000000000000000');
    assert.fieldEquals('DailyStat', dayId(1_000_000), 'jackpotPool', '250000000000000000000');
  });

  test('successive treasury transfers accumulate', () => {
    emitBrbTransfer(FUNDER, TREASURY, '250000000000000000000', 1_000_000, 0);
    emitBrbTransfer(FUNDER, TREASURY, '100000000000000000000', 1_000_100, 2);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentJackpot', '350000000000000000000');
    assert.fieldEquals('DailyStat', dayId(1_000_100), 'jackpotFunded', '350000000000000000000');
    assert.fieldEquals('DailyStat', dayId(1_000_100), 'jackpotPool', '350000000000000000000');
  });

  test('a mint straight to the treasury credits the pool', () => {
    // Regression: the mint branch used to `return` before the treasury check,
    // dropping the credit entirely.
    emitBrbTransfer(ZERO_ADDRESS, TREASURY, '100000000000000000000', 1_000_000, 0, false);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentJackpot', '100000000000000000000');
    assert.fieldEquals('DailyStat', dayId(1_000_000), 'jackpotPool', '100000000000000000000');
  });

  test('a jackpot payout persists its GlobalState debit and totals', () => {
    // Regression for the write clobber: brb.ts used to save its own GlobalState
    // copy *after* tryRecordMarketPayoutTransfer had saved its one, silently
    // reverting currentJackpot / totalJackpotsPaid / totalPayouts.
    emitBrbTransfer(FUNDER, TREASURY, '500000000000000000000', 1_000_000);
    arrangeResolvingRoundWithBet(1_000_100);

    // autoFundSender=false: minting to the treasury would credit the pool again.
    emitBrbTransfer(TREASURY, DEFAULT_USER, '200000000000000000000', 1_000_500, 5, false);

    assert.entityCount('JackpotPayout', 1);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentJackpot', '300000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalJackpotsPaid', '200000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPayouts', '200000000000000000000');
    assert.fieldEquals('DailyStat', dayId(1_000_500), 'jackpotPool', '300000000000000000000');
  });

  test('a payout larger than the tracked pool clamps at zero', () => {
    // currentJackpot is a counter started at the manifest startBlock, so it can
    // legitimately under-state a treasury that was already funded. BigInt is
    // signed — without the clamp the pool would render negative.
    emitBrbTransfer(FUNDER, TREASURY, '100000000000000000000', 1_000_000);
    arrangeResolvingRoundWithBet(1_000_100);

    emitBrbTransfer(TREASURY, DEFAULT_USER, '200000000000000000000', 1_000_500, 5, false);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'currentJackpot', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalJackpotsPaid', '200000000000000000000');
  });

  test('a quiet day carries the standing pool forward', () => {
    emitBrbTransfer(FUNDER, TREASURY, '250000000000000000000', 1_000_000);

    // A burn on the next day creates that day's bucket without touching the pool.
    const nextDay = 1_000_000 + SECONDS_PER_DAY;
    emitBrbTransfer(FUNDER, ZERO_ADDRESS, '1000000000000000000', nextDay);

    assert.fieldEquals('DailyStat', dayId(nextDay), 'jackpotFunded', '0');
    assert.fieldEquals('DailyStat', dayId(nextDay), 'jackpotPool', '250000000000000000000');
  });
});
