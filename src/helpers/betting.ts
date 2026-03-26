import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { RouletteRound, RouletteBet } from "../../generated/schema"
import { BetPlaced } from "../../generated/StakedBRB/StakedBRB"
import {
  BET_STRAIGHT, BET_SPLIT, BET_STREET, BET_CORNER, BET_LINE,
  BET_COLUMN, BET_DOZEN, BET_RED, BET_BLACK, BET_ODD, BET_EVEN,
  BET_LOW, BET_HIGH, BET_TRIO_012, BET_TRIO_023,
  BET_VOISINS, BET_TIERS, BET_ORPHELINS, BET_JEU_ZERO,
  BET_TYPE_STRAIGHT, BET_TYPE_SPLIT, BET_TYPE_STREET, BET_TYPE_CORNER,
  BET_TYPE_LINE, BET_TYPE_COLUMN, BET_TYPE_DOZEN, BET_TYPE_RED,
  BET_TYPE_BLACK, BET_TYPE_ODD, BET_TYPE_EVEN, BET_TYPE_LOW,
  BET_TYPE_HIGH, BET_TYPE_TRIO_012, BET_TYPE_TRIO_023,
  BET_TYPE_VOISINS, BET_TYPE_TIERS, BET_TYPE_ORPHELINS, BET_TYPE_JEU_ZERO
} from "./constant"

function getBetTypeFromNumber(betTypeNumber: BigInt): string {
  const betTypeInt = betTypeNumber.toI32()
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
    case BET_VOISINS:
      return BET_TYPE_VOISINS
    case BET_TIERS:
      return BET_TYPE_TIERS
    case BET_ORPHELINS:
      return BET_TYPE_ORPHELINS
    case BET_JEU_ZERO:
      return BET_TYPE_JEU_ZERO
    default:
      return BET_TYPE_STRAIGHT
  }
}

function max3(a: BigInt, b: BigInt, c: BigInt): BigInt {
  let m = a
  if (b.gt(m)) m = b
  if (c.gt(m)) m = c
  return m
}

function updateRoundMaxPayoutComponents(round: RouletteRound, amount: BigInt, betType: BigInt, number: BigInt): void {
  const betTypeInt = betType.toI32()
  const numI32 = number.toI32()

  if (betTypeInt == BET_STRAIGHT) {
    const totals = round.straightBetsTotals
    const next = totals[numI32].plus(amount)
    totals[numI32] = next
    round.straightBetsTotals = totals
    if (next.gt(round.maxStraightBet)) {
      round.maxStraightBet = next
    }
  } else if (betTypeInt == BET_STREET) {
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
    const sums = round.dozenBetsSum
    const next = sums[numI32].plus(amount)
    sums[numI32] = next
    round.dozenBetsSum = sums
  } else if (betTypeInt == BET_COLUMN) {
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
  } else if (betTypeInt == BET_VOISINS || betTypeInt == BET_TIERS || betTypeInt == BET_ORPHELINS || betTypeInt == BET_JEU_ZERO) {
    // French announced bets are composite (multiple sub-bets).
    // Conservative max payout: 36x (worst case includes straight sub-bets).
    round.otherBetsPayout = round.otherBetsPayout.plus(amount.times(BigInt.fromI32(36)))
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

  const raw = straightComponent.plus(pairComponent).plus(dozenComponent).plus(columnComponent).plus(otherComponent)

  // SAFETY_BUFFER_BPS = 11000 (110%) with floor division by 10000
  return raw.times(BigInt.fromI32(11000)).div(BigInt.fromI32(10000))
}

export function processRouletteBet(user: Bytes, amount: BigInt, betType: BigInt, number: BigInt, round: RouletteRound, event: BetPlaced): void {
  // Create or update bet entity (user + round ID)
  const betId = user.concat(round.id)
  let bet = RouletteBet.load(betId)

  if (!bet) {
    // Create new bet entity
    bet = new RouletteBet(betId)
    bet.user = user
    bet.round = round.id
    bet.amounts = [amount]
    bet.betTypes = [getBetTypeFromNumber(betType)]
    bet.numbers = [number]
    bet.totalAmount = amount
    bet.betCount = BigInt.fromI32(1)
    bet.firstBetBlockNumber = event.block.number
    bet.firstBetTimestamp = event.block.timestamp
    bet.latestBetBlockNumber = event.block.number
    bet.latestBetTimestamp = event.block.timestamp
    bet.latestTransactionHash = event.transaction.hash
    bet.won = false
    bet.actualPayout = BigInt.fromI32(0)
  } else {
    // Update existing bet entity
    const currentAmounts = bet.amounts
    const currentBetTypes = bet.betTypes
    const currentNumbers = bet.numbers

    currentAmounts.push(amount)
    currentBetTypes.push(getBetTypeFromNumber(betType))
    currentNumbers.push(number)

    bet.amounts = currentAmounts
    bet.betTypes = currentBetTypes
    bet.numbers = currentNumbers
    bet.totalAmount = bet.totalAmount.plus(amount)
    bet.betCount = bet.betCount.plus(BigInt.fromI32(1))
    bet.latestBetBlockNumber = event.block.number
    bet.latestBetTimestamp = event.block.timestamp
    bet.latestTransactionHash = event.transaction.hash
  }

  bet.save()

  // Update round totals
  round.totalBets = round.totalBets.plus(amount)
  updateRoundMaxPayoutComponents(round, amount, betType, number)
}
