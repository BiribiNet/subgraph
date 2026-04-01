import { BigInt } from "@graphprotocol/graph-ts"
import { RouletteRound } from "../../generated/schema"
import { ROUND_STATUS_BETTING } from "./constant"
import { bigintToBytes } from "./bigintToBytes"

function zerosArray(length: i32): Array<BigInt> {
  const arr = new Array<BigInt>(length)
  for (let i = 0; i < length; i++) {
    arr[i] = BigInt.fromI32(0)
  }
  return arr
}

/** New betting round entity; caller must `.save()` after any extra mutations. */
export function createNewRouletteRound(roundNumber: BigInt, startedAt: BigInt): RouletteRound {
  const roundId = bigintToBytes(roundNumber)
  const round = new RouletteRound(roundId)
  round.roundNumber = roundNumber
  round.status = ROUND_STATUS_BETTING
  round.totalBets = BigInt.fromI32(0)
  round.maxBetAmount = BigInt.fromI32(0)
  round.maxStraightBet = BigInt.fromI32(0)
  round.maxStreetBet = BigInt.fromI32(0)
  round.straightBetsTotals = zerosArray(37)
  round.streetBetsTotals = zerosArray(37)
  round.redBetsSum = BigInt.fromI32(0)
  round.blackBetsSum = BigInt.fromI32(0)
  round.oddBetsSum = BigInt.fromI32(0)
  round.evenBetsSum = BigInt.fromI32(0)
  round.lowBetsSum = BigInt.fromI32(0)
  round.highBetsSum = BigInt.fromI32(0)
  round.dozenBetsSum = zerosArray(4)
  round.columnBetsSum = zerosArray(4)
  round.otherBetsPayout = BigInt.fromI32(0)
  round.currentPayoutsCount = BigInt.fromI32(0)
  round.totalPayouts = BigInt.fromI32(0)
  round.uniqueBettors = BigInt.fromI32(0)
  round.betCount = BigInt.fromI32(0)
  round.failedPayoutBatches = BigInt.fromI32(0)
  round.failedJackpotBatches = BigInt.fromI32(0)
  round.forceResolved = false
  round.stakersRevenue = BigInt.fromI32(0)
  round.jackpotRevenue = BigInt.fromI32(0)
  round.roundBurnAmount = BigInt.fromI32(0)
  round.infraRevenue = BigInt.fromI32(0)
  round.startedAt = startedAt
  return round
}
