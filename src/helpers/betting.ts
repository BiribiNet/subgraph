import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { RouletteRound, RouletteBet, Market } from "../../generated/schema"
import { DecodedBetData } from "./bet-data"
import { ZERO } from "./number"
import { BetPlaced } from "../../generated/templates/BankVault/BankVault4626"
import {
  BET_STRAIGHT, BET_SPLIT, BET_STREET, BET_CORNER, BET_LINE,
  BET_COLUMN, BET_DOZEN, BET_RED, BET_BLACK, BET_ODD, BET_EVEN,
  BET_LOW, BET_HIGH, BET_TRIO_012, BET_TRIO_023, BET_MASK,
  BET_TYPE_STRAIGHT, BET_TYPE_SPLIT, BET_TYPE_STREET, BET_TYPE_CORNER,
  BET_TYPE_LINE, BET_TYPE_COLUMN, BET_TYPE_DOZEN, BET_TYPE_RED,
  BET_TYPE_BLACK, BET_TYPE_ODD, BET_TYPE_EVEN, BET_TYPE_LOW,
  BET_TYPE_HIGH, BET_TYPE_TRIO_012, BET_TYPE_TRIO_023, BET_TYPE_MASK, BET_TYPE_UNKNOWN
} from "./constant"
import { addMaskLiability } from "./mask-bet"

/** Sentinel for a uint256 that does not fit an i32; matches no bet type and no slot. */
const OUT_OF_I32_RANGE: i32 = -1

/**
 * `toI32()` asserts — aborting the handler and halting indexing — on any value outside the i32
 * range, and `betType`/`number` come straight from unvalidated betData (a mask leg number is up to
 * 2^53). Returns OUT_OF_I32_RANGE instead.
 */
function toI32OrSentinel(value: BigInt): i32 {
  return value.isI32() ? value.toI32() : OUT_OF_I32_RANGE
}

function getBetTypeFromNumber(betTypeNumber: BigInt): string {
  const betTypeInt = toI32OrSentinel(betTypeNumber)
  switch (betTypeInt) {
    case BET_STRAIGHT:
      return BET_TYPE_STRAIGHT
    case BET_SPLIT:
      return BET_TYPE_SPLIT
    case BET_STREET:
      return BET_TYPE_STREET
    case BET_CORNER:
      return BET_TYPE_CORNER
    case BET_LINE:
      return BET_TYPE_LINE
    case BET_COLUMN:
      return BET_TYPE_COLUMN
    case BET_DOZEN:
      return BET_TYPE_DOZEN
    case BET_RED:
      return BET_TYPE_RED
    case BET_BLACK:
      return BET_TYPE_BLACK
    case BET_ODD:
      return BET_TYPE_ODD
    case BET_EVEN:
      return BET_TYPE_EVEN
    case BET_LOW:
      return BET_TYPE_LOW
    case BET_HIGH:
      return BET_TYPE_HIGH
    case BET_TRIO_012:
      return BET_TYPE_TRIO_012
    case BET_TRIO_023:
      return BET_TYPE_TRIO_023
    case BET_MASK:
      return BET_TYPE_MASK
    default:
      // Folding an unknown id onto STRAIGHT used to rewrite history silently (a mask would have read
      // as a straight bet). UNKNOWN keeps the leg, its amount and raw number visible and queryable.
      log.warning("Unknown bet type: {}", [betTypeNumber.toString()])
      return BET_TYPE_UNKNOWN
  }
}

function max3(a: BigInt, b: BigInt, c: BigInt): BigInt {
  let m = a
  if (b.gt(m)) m = b
  if (c.gt(m)) m = c
  return m
}

// Fixed-array sizes for the per-number payout buckets (see createNewRouletteRound in rouletteRound.ts).
// `number` originates from unvalidated on-chain betData, so an out-of-range index into these fixed
// arrays would trap the WASM mapping and permanently halt indexing (freezing the DAO voting oracle).
const STRAIGHT_STREET_SLOTS = 37 // valid straight/street numbers 0..36
const DOZEN_COLUMN_SLOTS = 4 // valid dozen/column groups 1..3 (slot 0 unused)

function isNumberSlotInRange(numI32: i32, slots: i32, betTypeInt: i32, rawNumber: BigInt): boolean {
  if (numI32 >= 0 && numI32 < slots) {
    return true
  }
  log.warning("Skipping out-of-range bet number {} for betType {} (max slots {})", [
    rawNumber.toString(),
    betTypeInt.toString(),
    slots.toString(),
  ])
  return false
}

export function updateRoundMaxPayoutComponents(round: RouletteRound, amount: BigInt, betType: BigInt, number: BigInt): void {
  const betTypeInt = toI32OrSentinel(betType)
  if (betTypeInt == BET_MASK) {
    // Decoded as BigInt: the raw value carries the 37-bit mask plus presetId/guard bits.
    addMaskLiability(round, amount, number)
    return
  }
  const numI32 = toI32OrSentinel(number)

  if (betTypeInt == BET_STRAIGHT) {
    if (!isNumberSlotInRange(numI32, STRAIGHT_STREET_SLOTS, betTypeInt, number)) return
    const totals = round.straightBetsTotals
    const next = totals[numI32].plus(amount)
    totals[numI32] = next
    round.straightBetsTotals = totals
    if (next.gt(round.maxStraightBet)) {
      round.maxStraightBet = next
    }
  } else if (betTypeInt == BET_STREET) {
    if (!isNumberSlotInRange(numI32, STRAIGHT_STREET_SLOTS, betTypeInt, number)) return
    const totals = round.streetBetsTotals
    const next = totals[numI32].plus(amount)
    totals[numI32] = next
    round.streetBetsTotals = totals
    if (next.gt(round.maxStreetBet)) {
      round.maxStreetBet = next
    }
  } else if (betTypeInt == BET_RED) {
    round.redBetsSum = round.redBetsSum.plus(amount)
  } else if (betTypeInt == BET_BLACK) {
    round.blackBetsSum = round.blackBetsSum.plus(amount)
  } else if (betTypeInt == BET_ODD) {
    round.oddBetsSum = round.oddBetsSum.plus(amount)
  } else if (betTypeInt == BET_EVEN) {
    round.evenBetsSum = round.evenBetsSum.plus(amount)
  } else if (betTypeInt == BET_LOW) {
    round.lowBetsSum = round.lowBetsSum.plus(amount)
  } else if (betTypeInt == BET_HIGH) {
    round.highBetsSum = round.highBetsSum.plus(amount)
  } else if (betTypeInt == BET_DOZEN) {
    if (!isNumberSlotInRange(numI32, DOZEN_COLUMN_SLOTS, betTypeInt, number)) return
    const sums = round.dozenBetsSum
    const next = sums[numI32].plus(amount)
    sums[numI32] = next
    round.dozenBetsSum = sums
  } else if (betTypeInt == BET_COLUMN) {
    if (!isNumberSlotInRange(numI32, DOZEN_COLUMN_SLOTS, betTypeInt, number)) return
    const sums = round.columnBetsSum
    const next = sums[numI32].plus(amount)
    sums[numI32] = next
    round.columnBetsSum = sums
  } else if (betTypeInt == BET_SPLIT) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(18)))
  } else if (betTypeInt == BET_CORNER) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(9)))
  } else if (betTypeInt == BET_LINE) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(6)))
  } else if (betTypeInt == BET_TRIO_012 || betTypeInt == BET_TRIO_023) {
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(12)))
  }
}

export function calculateMaxPayoutFromRoundComponents(round: RouletteRound): BigInt {
  const straightComponent = round.maxStraightBet.times(BigInt.fromI32(36)).plus(round.maxStreetBet.times(BigInt.fromI32(12)))

  const redBlackComponent = (round.redBetsSum.gt(round.blackBetsSum) ? round.redBetsSum : round.blackBetsSum).times(BigInt.fromI32(2))
  const oddEvenComponent = (round.oddBetsSum.gt(round.evenBetsSum) ? round.oddBetsSum : round.evenBetsSum).times(BigInt.fromI32(2))
  const lowHighComponent = (round.lowBetsSum.gt(round.highBetsSum) ? round.lowBetsSum : round.highBetsSum).times(BigInt.fromI32(2))
  const pairComponent = redBlackComponent.plus(oddEvenComponent).plus(lowHighComponent)

  const dozenSums = round.dozenBetsSum
  const dozenMax = max3(dozenSums[1], dozenSums[2], dozenSums[3])
  const dozenComponent = dozenMax.times(BigInt.fromI32(3))

  const columnSums = round.columnBetsSum
  const columnMax = max3(columnSums[1], columnSums[2], columnSums[3])
  const columnComponent = columnMax.times(BigInt.fromI32(3))

  const otherComponent = round.otherBetsPayout
  const maskComponent = round.maskBetsPayout

  const raw = straightComponent
    .plus(pairComponent)
    .plus(dozenComponent)
    .plus(columnComponent)
    .plus(otherComponent)
    .plus(maskComponent)

  // SAFETY_BUFFER_BPS = 11000 (110%) with floor division by 10000
  return raw.times(BigInt.fromI32(11000)).div(BigInt.fromI32(10000))
}

/** One BetRecorded tx; decodes and stores every leg from betData (engine multi-bet payload). */
export function recordRouletteBetFromPayload(
  user: Bytes,
  payload: DecodedBetData,
  totalAmount: BigInt,
  round: RouletteRound,
  market: Market,
  blockNumber: BigInt,
  timestamp: BigInt,
  transactionHash: Bytes
): RouletteBet {
  const betId = user.concat(round.id)
  let bet = RouletteBet.load(betId)

  if (bet == null) {
    bet = new RouletteBet(betId)
    bet.user = user
    bet.market = market.id
    bet.round = round.id
    bet.amounts = new Array<BigInt>(0)
    bet.betTypes = new Array<string>(0)
    bet.numbers = new Array<BigInt>(0)
    bet.totalAmount = ZERO
    bet.betCount = ZERO
    bet.firstBetBlockNumber = blockNumber
    bet.firstBetTimestamp = timestamp
    bet.won = false
    bet.actualPayout = ZERO
  }

  const legCount = payload.types.length
  if (legCount == 0) {
    const amounts = bet.amounts
    const types = bet.betTypes
    const numbers = bet.numbers
    amounts.push(totalAmount)
    types.push(getBetTypeFromNumber(ZERO))
    numbers.push(ZERO)
    bet.amounts = amounts
    bet.betTypes = types
    bet.numbers = numbers
  } else {
    for (let i = 0; i < legCount; i++) {
      const amounts = bet.amounts
      const types = bet.betTypes
      const numbers = bet.numbers
      amounts.push(payload.amounts[i])
      types.push(getBetTypeFromNumber(payload.types[i]))
      numbers.push(payload.numbers[i])
      bet.amounts = amounts
      bet.betTypes = types
      bet.numbers = numbers
    }
  }

  bet.totalAmount = bet.totalAmount.plus(totalAmount)
  bet.betCount = bet.betCount.plus(BigInt.fromI32(1))
  bet.latestBetBlockNumber = blockNumber
  bet.latestBetTimestamp = timestamp
  bet.latestTransactionHash = transactionHash
  bet.save()

  round.totalBets = round.totalBets.plus(totalAmount)
  return bet
}

export function recordRouletteBetEntry(
  user: Bytes,
  amount: BigInt,
  betType: BigInt,
  number: BigInt,
  round: RouletteRound,
  market: Market,
  blockNumber: BigInt,
  timestamp: BigInt,
  transactionHash: Bytes
): RouletteBet {
  const payload = new DecodedBetData()
  payload.types.push(betType)
  payload.numbers.push(number)
  payload.amounts.push(amount)
  const bet = recordRouletteBetFromPayload(
    user,
    payload,
    amount,
    round,
    market,
    blockNumber,
    timestamp,
    transactionHash
  )
  updateRoundMaxPayoutComponents(round, amount, betType, number)
  return bet
}

export function processRouletteBet(
  user: Bytes,
  amount: BigInt,
  betType: BigInt,
  number: BigInt,
  round: RouletteRound,
  market: Market,
  event: BetPlaced
): void {
  recordRouletteBetEntry(
    user,
    amount,
    betType,
    number,
    round,
    market,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash
  )
}
