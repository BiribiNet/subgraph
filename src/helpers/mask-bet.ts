import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { Market, RouletteBet, RouletteMaskLeg, RouletteRound } from "../../generated/schema"
import { DecodedBetData } from "./bet-data"
import { BET_MASK } from "./constant"
import { ONE, ZERO } from "./number"
import { canonicalPresetId } from "./special-bet-presets"
import { recordSpecialBetStats } from "./special-bet-stats"
import { recordChallengeLeg } from "./daily-challenges"

// Mask leg encoding (spec mask-bets v1, §1.3 / D7):
//   numbers[i] = mask | (presetId << 37) | (guard << 46) | (expectedPrev << 47), always < 2^53.
// Every field is extracted with BigInt shifts and masks. Never call `toI32()` on the raw value:
// graph-ts asserts (aborts the handler, halting indexing) as soon as a BigInt leaves the i32
// range, and any mask covering a number >= 31 already does. Only the bounded fields extracted
// below (<= 9 bits) are converted to native integers.
const MASK_BITS: u8 = 37
const PRESET_ID_SHIFT: u8 = 37
const PRESET_ID_BITS: u8 = 9
const GUARD_SHIFT: u8 = 46
const EXPECTED_PREV_SHIFT: u8 = 47
const EXPECTED_PREV_BITS: u8 = 6
const ENCODING_BITS: u8 = 53

// Plafond porté de 24 à 35 numéros (décision du 08/11/2026) : doit rester aligné sur le moteur.
const MIN_MASK_SIZE: i32 = 2
const MAX_MASK_SIZE: i32 = 35
const MAX_ROULETTE_NUMBER: i32 = 36
/** Mask payout = floor(amount * 36 / |S|), stake included (spec §2.2, D2). */
const MASK_PAYOUT_NUMERATOR = BigInt.fromI32(36)

function lowBits(bits: u8): BigInt {
  return ONE.leftShift(bits).minus(ONE)
}

/** All fields of one mask leg; produced by `decodeMaskNumber`, which never traps. */
export class DecodedMaskLeg {
  rawNumber: BigInt
  mask: BigInt
  size: i32
  presetId: i32
  guard: boolean
  expectedPrev: i32

  constructor(rawNumber: BigInt) {
    this.rawNumber = rawNumber
    this.mask = ZERO
    this.size = 0
    this.presetId = 0
    this.guard = false
    this.expectedPrev = 0
  }
}

/**
 * Splits a raw `numbers[i]` into its mask fields without any validation. Safe for any uint256:
 * the 37-bit mask fits a u64 (popcount), the other fields are at most 9 bits wide.
 */
export function decodeMaskNumber(rawNumber: BigInt): DecodedMaskLeg {
  const decoded = new DecodedMaskLeg(rawNumber)
  decoded.mask = rawNumber.bitAnd(lowBits(MASK_BITS))
  decoded.size = i32(popcnt<u64>(decoded.mask.toU64()))
  decoded.presetId = rawNumber.rightShift(PRESET_ID_SHIFT).bitAnd(lowBits(PRESET_ID_BITS)).toI32()
  decoded.guard = rawNumber.rightShift(GUARD_SHIFT).bitAnd(ONE).equals(ONE)
  decoded.expectedPrev = rawNumber
    .rightShift(EXPECTED_PREV_SHIFT)
    .bitAnd(lowBits(EXPECTED_PREV_BITS))
    .toI32()
  return decoded
}

/** Mirrors the engine's validation rules 1, 2 and 5 (spec §1.3); the engine reverts otherwise. */
export function isValidMaskLeg(decoded: DecodedMaskLeg): boolean {
  if (!decoded.rawNumber.rightShift(ENCODING_BITS).isZero()) return false
  if (decoded.size < MIN_MASK_SIZE || decoded.size > MAX_MASK_SIZE) return false
  if (decoded.expectedPrev > MAX_ROULETTE_NUMBER) return false
  if (!decoded.guard && decoded.expectedPrev != 0) return false
  return true
}

/**
 * Decoded leg, or null (with a warning) when the value could not have been accepted by the
 * engine. A null leg contributes no liability and no RouletteMaskLeg, but stays in the ticket
 * arrays as a MASK leg with its raw number, so the wager itself is never lost.
 */
export function decodeValidMaskNumber(rawNumber: BigInt): DecodedMaskLeg | null {
  const decoded = decodeMaskNumber(rawNumber)
  if (!isValidMaskLeg(decoded)) {
    log.warning("Skipping invalid mask leg number {} (size {})", [
      rawNumber.toString(),
      decoded.size.toString(),
    ])
    return null
  }
  return decoded
}

/** floor(amount * 36 / size) — one integer division, as the engine pays it. Caller ensures size >= 2. */
export function maskPayout(amount: BigInt, size: i32): BigInt {
  return amount.times(MASK_PAYOUT_NUMERATOR).div(BigInt.fromI32(size))
}

/** True iff bit `winningNumber` of `mask` is set. */
export function maskCoversNumber(mask: BigInt, winningNumber: i32): boolean {
  if (winningNumber < 0 || winningNumber > MAX_ROULETTE_NUMBER) return false
  return mask.rightShift(u8(winningNumber)).bitAnd(ONE).equals(ONE)
}

/** Prudent mirror of the engine's roundMaskWeightedPayout (option (a), D9). */
export function addMaskLiability(round: RouletteRound, amount: BigInt, rawNumber: BigInt): void {
  const decoded = decodeValidMaskNumber(rawNumber)
  if (decoded == null) return
  round.maskBetsPayout = round.maskBetsPayout.plus(maskPayout(amount, decoded.size))
}

function maskLegId(transactionHash: Bytes, logIndex: BigInt, legIndex: i32): Bytes {
  return transactionHash.concatI32(logIndex.toI32()).concatI32(legIndex)
}

/** Stores one RouletteMaskLeg per valid BET_MASK leg of a BetRecorded payload. */
export function recordMaskLegs(
  payload: DecodedBetData,
  bet: RouletteBet,
  round: RouletteRound,
  market: Market,
  transactionHash: Bytes,
  logIndex: BigInt,
  blockNumber: BigInt,
  timestamp: BigInt
): void {
  const maskType = BigInt.fromI32(BET_MASK)
  for (let legIndex = 0; legIndex < payload.types.length; legIndex++) {
    if (!payload.types[legIndex].equals(maskType)) continue
    const decoded = decodeValidMaskNumber(payload.numbers[legIndex])
    if (decoded == null) continue
    const amount = payload.amounts[legIndex]

    const leg = new RouletteMaskLeg(maskLegId(transactionHash, logIndex, legIndex))
    leg.bet = bet.id
    leg.round = round.id
    leg.market = market.id
    leg.user = bet.user
    leg.legIndex = legIndex
    leg.amount = amount
    leg.rawNumber = decoded.rawNumber
    leg.mask = decoded.mask
    leg.maskSize = decoded.size
    leg.presetId = decoded.presetId
    if (decoded.guard) {
      leg.previousGuard = decoded.expectedPrev
    }
    leg.potentialPayout = maskPayout(amount, decoded.size)
    leg.canonicalPresetId = canonicalPresetId(
      decoded.mask,
      decoded.presetId,
      decoded.guard,
      decoded.expectedPrev,
      decoded.size
    )
    // Mise minimale du marché au moment du pari : seule une jambe qui l'atteint compte pour les défis.
    leg.meetsMinBet = amount.ge(market.minBet)
    leg.blockNumber = blockNumber
    leg.timestamp = timestamp
    leg.transactionHash = transactionHash
    leg.save()
  }
}

/**
 * Applies the winning number to every mask leg of a market round: a mask wins iff its bit is set,
 * and then pays potentialPayout. Never a jackpot win — jackpot receipts are attributed from the
 * treasury's BRB transfers only, and the engine restricts them to straight bets.
 * A leg settled for the first time also feeds the per-preset stats and the daily challenges; a
 * replayed VRFResult (already settled leg) never counts twice.
 */
export function settleMaskLegsOfRound(
  round: RouletteRound,
  winningNumber: i32,
  timestamp: BigInt,
  blockNumber: BigInt
): void {
  const legs = round.maskLegs.load()
  if (legs.length == 0) return
  let winningPayout = ZERO
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index]
    const firstSettlement = leg.payout === null
    const won = maskCoversNumber(leg.mask, winningNumber)
    leg.winningNumber = winningNumber
    leg.won = won
    leg.payout = won ? leg.potentialPayout : ZERO
    if (won) {
      winningPayout = winningPayout.plus(leg.potentialPayout)
    }
    leg.save()
    if (firstSettlement) {
      recordSpecialBetStats(leg, timestamp)
      recordChallengeLeg(leg, round.roundNumber, timestamp, blockNumber)
    }
  }
  round.maskWinningPayout = winningPayout
  round.save()
}
