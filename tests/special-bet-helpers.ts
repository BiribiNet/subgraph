import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { newMockEvent } from 'matchstick-as';

import { BetRecorded, VRFResult } from '../generated/RouletteEngine/Game';
import { Market } from '../generated/schema';
import { handleBetRecorded, handleVRFResult } from '../src/mappings/roulette';
import { DEFAULT_USER, TEST_ENGINE, encodeBetLegs, setupTestMarket } from './helpers';

// Outils communs aux tests des paris spéciaux (stats par preset, défis du jour).

export const MASK_TYPE = BigInt.fromI32(16);
export const TEN_TOKENS = '10000000000000000000';
export const FIVE_TOKENS = '5000000000000000000';
export const ONE_TOKEN = '1000000000000000000';
export const DAY_SECONDS: i32 = 86400;
// 1_000_000 s = jour 11 → slots (33, 34, 35) mod 8 → défis 2, 3, 4.
export const BET_TIMESTAMP: i32 = 1_000_000;

export function maskOf(numbers: i32[]): BigInt {
  let mask = BigInt.zero();
  for (let index = 0; index < numbers.length; index++) {
    mask = mask.bitOr(BigInt.fromI32(1).leftShift(u8(numbers[index])));
  }
  return mask;
}

/** numbers[i] = mask | presetId << 37 | guard << 46 | expectedPrev << 47. */
export function encodeMask(mask: BigInt, presetId: i32, guard: boolean, expectedPrev: i32): BigInt {
  let raw = mask.bitOr(BigInt.fromI32(presetId).leftShift(37));
  if (guard) raw = raw.bitOr(BigInt.fromI32(1).leftShift(46));
  return raw.bitOr(BigInt.fromI32(expectedPrev).leftShift(47));
}

/** One-leg BetRecorded; tx hash = 0xd0 ‖ round ‖ logIndex so leg ids are predictable. */
export function emitMaskBet(raw: BigInt, amount: string, round: i32, logIndex: i32, timestamp: i32 = BET_TIMESTAMP): void {
  const event = changetype<BetRecorded>(newMockEvent());
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))));
  event.parameters.push(new ethereum.EventParam('localRound', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(round))));
  event.parameters.push(new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER))));
  event.parameters.push(new ethereum.EventParam('totalAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))));
  event.parameters.push(
    new ethereum.EventParam('betData', ethereum.Value.fromBytes(encodeBetLegs([MASK_TYPE], [raw], [BigInt.fromString(amount)])))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.transaction.hash = Bytes.fromHexString('0xd0').concatI32(round).concatI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(10_000 + round);
  handleBetRecorded(event);
}

export function maskLegIdOf(round: i32, logIndex: i32): string {
  return Bytes.fromHexString('0xd0').concatI32(round).concatI32(logIndex).concatI32(logIndex).concatI32(0).toHexString();
}

export function emitVrf(round: i32, winningNumber: i32): void {
  const event = changetype<VRFResult>(newMockEvent());
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(round))));
  event.parameters.push(new ethereum.EventParam('winningNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(winningNumber))));
  event.parameters.push(new ethereum.EventParam('jackpotNumber', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))));
  event.block.timestamp = BigInt.fromI32(BET_TIMESTAMP + 200 * round);
  event.block.number = BigInt.fromI32(20_000 + round);
  handleVRFResult(event);
}

/** Test market 1 with a 5-token minimum bet. */
export function setupMarketWithMinBet(): void {
  setupTestMarket();
  const market = Market.load('1')!;
  market.minBet = BigInt.fromString(FIVE_TOKENS);
  market.save();
}

export function userBytes(): Bytes {
  return Bytes.fromHexString(DEFAULT_USER);
}

export function statsId(presetId: i32): string {
  return userBytes().concatI32(1).concatI32(presetId).toHexString();
}
