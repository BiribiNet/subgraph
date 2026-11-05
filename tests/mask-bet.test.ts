import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { BetRecorded, VRFResult } from '../generated/RouletteEngine/Game';
import { Market, RouletteMaskLeg } from '../generated/schema';
import { handleBetRecorded, handleVRFResult } from '../src/mappings/roulette';
import {
  decodeMaskNumber,
  decodeValidMaskNumber,
  maskCoversNumber,
  maskPayout,
} from '../src/helpers/mask-bet';
import {
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_ENGINE,
  emitBetRecorded,
  encodeBetLegs,
  setupTestMarket,
  testRoundId,
} from './helpers';

const MASK_TYPE = BigInt.fromI32(16);
const STRAIGHT_TYPE = BigInt.fromI32(1);
const TEN_TOKENS = '10000000000000000000';
const BET_TX_HASH = Bytes.fromHexString(
  '0xa16a2ebd8e2a6e8c6d6e6b3c0e1d2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e'
);

function bitsOf(numbers: i32[]): BigInt {
  let mask = BigInt.zero();
  for (let index = 0; index < numbers.length; index++) {
    mask = mask.bitOr(BigInt.fromI32(1).leftShift(u8(numbers[index])));
  }
  return mask;
}

/** numbers[i] = mask | presetId << 37 | guard << 46 | expectedPrev << 47 (spec §1.3). */
function encodeMask(mask: BigInt, presetId: i32, guard: boolean, expectedPrev: i32): BigInt {
  let raw = mask.bitOr(BigInt.fromI32(presetId).leftShift(37));
  if (guard) raw = raw.bitOr(BigInt.fromI32(1).leftShift(46));
  return raw.bitOr(BigInt.fromI32(expectedPrev).leftShift(47));
}

// {0, 31, 32, 36}: four numbers, raw value well above 2^31.
const MASK_A = bitsOf([0, 31, 32, 36]);
const RAW_A = encodeMask(MASK_A, 7, true, 17);
// 24 numbers 13..36 (maximum size), presetId 511, guard on 36: largest field values, < 2^53.
const RAW_MAX = encodeMask(bitsOf([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]), 511, true, 36);

function maskLegId(logIndex: i32, legIndex: i32): string {
  return BET_TX_HASH.concatI32(logIndex).concatI32(legIndex).toHexString();
}

/** BetRecorded with a fixed tx hash so RouletteMaskLeg ids are predictable. */
function emitBetRecordedTx(totalAmount: string, betData: Bytes, localRound: i32, logIndex: i32 = 0): void {
  const event = changetype<BetRecorded>(newMockEvent());
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam('localRound', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(localRound))));
  event.parameters.push(new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER))));
  event.parameters.push(new ethereum.EventParam('totalAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(totalAmount))));
  event.parameters.push(new ethereum.EventParam('betData', ethereum.Value.fromBytes(betData)));
  event.logIndex = BigInt.fromI32(logIndex);
  event.transaction.hash = BET_TX_HASH;
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  handleBetRecorded(event);
}

function emitVRFResult(roundId: i32, winningNumber: i32, jackpotNumber: i32): void {
  const event = changetype<VRFResult>(newMockEvent());
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(roundId))));
  event.parameters.push(new ethereum.EventParam('winningNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(winningNumber))));
  event.parameters.push(new ethereum.EventParam('jackpotNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(jackpotNumber))));
  event.block.timestamp = BigInt.fromI32(1_000_200);
  event.block.number = BigInt.fromI32(10_002);
  handleVRFResult(event);
}

function singleMaskLeg(raw: BigInt, amount: string): Bytes {
  return encodeBetLegs([MASK_TYPE], [raw], [BigInt.fromString(amount)]);
}

describe('Mask leg decoding (BigInt only)', () => {
  test('should decode a plain two-number mask with no preset and no guard', () => {
    const decoded = decodeMaskNumber(bitsOf([1, 2]));
    assert.stringEquals(decoded.mask.toString(), '6');
    assert.i32Equals(decoded.size, 2);
    assert.i32Equals(decoded.presetId, 0);
    assert.booleanEquals(decoded.guard, false);
    assert.i32Equals(decoded.expectedPrev, 0);
  });

  test('should decode presetId 511 and a guard without touching the mask', () => {
    const decoded = decodeMaskNumber(encodeMask(bitsOf([3, 4, 5]), 511, true, 0));
    assert.stringEquals(decoded.mask.toString(), bitsOf([3, 4, 5]).toString());
    assert.i32Equals(decoded.size, 3);
    assert.i32Equals(decoded.presetId, 511);
    assert.booleanEquals(decoded.guard, true);
    assert.i32Equals(decoded.expectedPrev, 0);
  });

  test('should decode a value above 2^31 without trapping', () => {
    assert.assertTrue(RAW_A.gt(BigInt.fromString('2147483648')));
    const decoded = decodeValidMaskNumber(RAW_A);
    assert.assertNotNull(decoded);
    assert.stringEquals(decoded!.mask.toString(), '75161927681');
    assert.i32Equals(decoded!.size, 4);
    assert.i32Equals(decoded!.presetId, 7);
    assert.booleanEquals(decoded!.guard, true);
    assert.i32Equals(decoded!.expectedPrev, 17);
  });

  test('should decode the largest field values just below 2^53', () => {
    assert.stringEquals(RAW_MAX.toString(), '5207287069138944');
    assert.assertTrue(RAW_MAX.lt(BigInt.fromString('9007199254740992')));
    const decoded = decodeValidMaskNumber(RAW_MAX);
    assert.assertNotNull(decoded);
    assert.i32Equals(decoded!.size, 24);
    assert.i32Equals(decoded!.presetId, 511);
    assert.i32Equals(decoded!.expectedPrev, 36);
  });

  test('should reject legs the engine cannot accept', () => {
    // bit 53 set
    assert.assertNull(decodeValidMaskNumber(bitsOf([1, 2]).bitOr(BigInt.fromI32(1).leftShift(53))));
    // |S| = 1 and |S| = 25
    assert.assertNull(decodeValidMaskNumber(bitsOf([5])));
    assert.assertNull(decodeValidMaskNumber(bitsOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])));
    // expectedPrev without guard, expectedPrev > 36 with guard
    assert.assertNull(decodeValidMaskNumber(encodeMask(bitsOf([1, 2]), 0, false, 5)));
    assert.assertNull(decodeValidMaskNumber(encodeMask(bitsOf([1, 2]), 0, true, 37)));
    // a uint256 far beyond 2^53 still decodes without trapping
    assert.assertNull(decodeValidMaskNumber(BigInt.fromI32(6).leftShift(200)));
  });

  test('should pay floor(amount * 36 / size) and test the winning bit', () => {
    assert.stringEquals(maskPayout(BigInt.fromI32(1_000_000), 11).toString(), '3272727');
    assert.stringEquals(maskPayout(BigInt.fromString(TEN_TOKENS), 2).toString(), '180000000000000000000');
    assert.assertTrue(maskCoversNumber(MASK_A, 36));
    assert.assertTrue(maskCoversNumber(MASK_A, 0));
    assert.assertTrue(!maskCoversNumber(MASK_A, 17));
    assert.assertTrue(!maskCoversNumber(MASK_A, 37));
  });

  // Locks the graph-ts 0.38 behaviour the spec asked about: toI32() on a value above the i32 range
  // asserts (aborts the handler, which halts indexing in production) — it does not truncate.
  test('should abort when toI32 is called on a raw mask value above 2^31', () => {
    RAW_A.toI32();
  }, true);
});

describe('Mask leg indexing on BetRecorded', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('should record type MASK, the decoded leg and the prudent mask liability', () => {
    const betData = encodeBetLegs(
      [MASK_TYPE, STRAIGHT_TYPE],
      [RAW_A, BigInt.fromI32(7)],
      [BigInt.fromString(TEN_TOKENS), BigInt.fromString(TEN_TOKENS)]
    );
    emitBetRecordedTx('20000000000000000000', betData, 1);

    const betId = Bytes.fromHexString(DEFAULT_USER).concat(Bytes.fromHexString(testRoundId(1))).toHexString();
    assert.fieldEquals('RouletteBet', betId, 'betTypes', '[MASK, STRAIGHT]');
    assert.fieldEquals('RouletteBet', betId, 'numbers', '[' + RAW_A.toString() + ', 7]');

    const legId = maskLegId(0, 0);
    assert.entityCount('RouletteMaskLeg', 1);
    assert.fieldEquals('RouletteMaskLeg', legId, 'bet', betId);
    assert.fieldEquals('RouletteMaskLeg', legId, 'legIndex', '0');
    assert.fieldEquals('RouletteMaskLeg', legId, 'mask', '75161927681');
    assert.fieldEquals('RouletteMaskLeg', legId, 'maskSize', '4');
    assert.fieldEquals('RouletteMaskLeg', legId, 'presetId', '7');
    assert.fieldEquals('RouletteMaskLeg', legId, 'previousGuard', '17');
    assert.fieldEquals('RouletteMaskLeg', legId, 'potentialPayout', '90000000000000000000');

    // option (a): 10 * 36 / 4 = 90; buffer (straight 10*36 + mask 90) * 1.1 = 495
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskBetsPayout', '90000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxStraightBet', TEN_TOKENS);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxBetAmount', '495000000000000000000');
  });

  test('should leave previousGuard null when the guard bit is not set', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(encodeMask(bitsOf([7, 8, 9]), 3, false, 0), TEN_TOKENS), 1);
    const leg = RouletteMaskLeg.load(Bytes.fromHexString(maskLegId(0, 0)))!;
    assert.assertTrue(leg.previousGuard === null);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'presetId', '3');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'potentialPayout', '120000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskBetsPayout', '120000000000000000000');
  });

  test('should index a 24-number mask near 2^53 without trapping', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(RAW_MAX, TEN_TOKENS), 1);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'maskSize', '24');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'presetId', '511');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'previousGuard', '36');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskBetsPayout', '15000000000000000000');
  });

  test('should keep an invalid mask leg as MASK without liability or decoded leg', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(bitsOf([5]), TEN_TOKENS), 1);
    assert.entityCount('RouletteMaskLeg', 0);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskBetsPayout', '0');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', TEN_TOKENS);
  });

  test('should count mask wagers in user volume and BRBpoints like any other bet (D21)', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(RAW_A, TEN_TOKENS), 1);
    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', TEN_TOKENS);
    assert.fieldEquals('User', DEFAULT_USER, 'brbpPoints', '30');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalWagered', TEN_TOKENS);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalBets', '1');
  });

  test('should normalize a mask wager on a 6-decimal market to 18 decimals', () => {
    const market = Market.load('1')!;
    market.assetDecimals = 6;
    market.save();
    emitBetRecordedTx('10000000', singleMaskLeg(RAW_A, '10000000'), 1);
    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', TEN_TOKENS);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'potentialPayout', '90000000');
  });
});

describe('Mask leg settlement on VRFResult', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('should mark a mask covering the winning number as won with its payout', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(RAW_A, TEN_TOKENS), 1);
    emitVRFResult(1, 32, 5);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'winningNumber', '32');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'won', 'true');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'payout', '90000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskWinningPayout', '90000000000000000000');
  });

  test('should mark a mask missing the winning number as lost', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(RAW_A, TEN_TOKENS), 1);
    emitVRFResult(1, 17, 5);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'won', 'false');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'payout', '0');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskWinningPayout', '0');
  });

  test('should settle overlapping mask legs independently and sum the winners', () => {
    const betData = encodeBetLegs(
      [MASK_TYPE, MASK_TYPE, STRAIGHT_TYPE],
      [RAW_A, encodeMask(bitsOf([32, 33]), 0, false, 0), BigInt.fromI32(32)],
      [BigInt.fromString(TEN_TOKENS), BigInt.fromString(TEN_TOKENS), BigInt.fromString(TEN_TOKENS)]
    );
    emitBetRecordedTx('30000000000000000000', betData, 1);
    // liability: 90 + 180 (masks) + 360 (straight) = 630, buffered 693
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskBetsPayout', '270000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxBetAmount', '693000000000000000000');
    emitVRFResult(1, 32, 5);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'won', 'true');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 1), 'won', 'true');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 1), 'payout', '180000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maskWinningPayout', '270000000000000000000');
  });

  test('should never count a mask as a jackpot win even when the jackpot number is drawn', () => {
    emitBetRecordedTx(TEN_TOKENS, singleMaskLeg(RAW_A, TEN_TOKENS), 1);
    emitVRFResult(1, 36, 36);
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'won', 'true');
    assert.fieldEquals('RouletteMaskLeg', maskLegId(0, 0), 'payout', '90000000000000000000');
    assert.entityCount('JackpotPayout', 0);
    const betId = Bytes.fromHexString(DEFAULT_USER).concat(Bytes.fromHexString(testRoundId(1))).toHexString();
    assert.fieldEquals('RouletteBet', betId, 'won', 'false');
    assert.fieldEquals('RouletteBet', betId, 'actualPayout', '0');
  });
});

describe('Unknown bet types', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('should record type 17 as UNKNOWN, never as STRAIGHT', () => {
    emitBetRecorded(DEFAULT_USER, TEN_TOKENS, encodeBetLegs([BigInt.fromI32(17)], [BigInt.fromI32(7)], [BigInt.fromString(TEN_TOKENS)]), 1);
    const betId = Bytes.fromHexString(DEFAULT_USER).concat(Bytes.fromHexString(testRoundId(1))).toHexString();
    assert.fieldEquals('RouletteBet', betId, 'betTypes', '[UNKNOWN]');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxStraightBet', '0');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxBetAmount', '0');
    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', TEN_TOKENS);
  });

  test('should not trap on a bet type far outside the i32 range', () => {
    emitBetRecorded(DEFAULT_USER, TEN_TOKENS, encodeBetLegs([BigInt.fromI32(1).leftShift(200)], [RAW_A], [BigInt.fromString(TEN_TOKENS)]), 1);
    const betId = Bytes.fromHexString(DEFAULT_USER).concat(Bytes.fromHexString(testRoundId(1))).toHexString();
    assert.fieldEquals('RouletteBet', betId, 'betTypes', '[UNKNOWN]');
    assert.entityCount('RouletteMaskLeg', 0);
  });

  test('should not trap on a straight leg whose number exceeds the i32 range', () => {
    emitBetRecorded(DEFAULT_USER, TEN_TOKENS, encodeBetLegs([STRAIGHT_TYPE], [RAW_A], [BigInt.fromString(TEN_TOKENS)]), 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxStraightBet', '0');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', TEN_TOKENS);
  });
});
