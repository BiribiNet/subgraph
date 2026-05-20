import { BigInt } from "@graphprotocol/graph-ts"
import { RouletteRound, Market, GlobalRound } from "../../generated/schema"
import { ROUND_STATUS_BETTING } from "./constant"
import { marketRoundId } from "./market"
import { ZERO } from "./number"

function zerosArray(length: i32): Array<BigInt> {
  const arr = new Array<BigInt>(length)
  for (let i = 0; i < length; i++) {
    arr[i] = BigInt.fromI32(0)
  }
  return arr
}

/** New per-market round slice; caller must `.save()` after any extra mutations. */
export function createNewRouletteRound(
  globalRound: GlobalRound,
  market: Market,
  startedAt: BigInt
): RouletteRound {
  const roundId = marketRoundId(globalRound.roundNumber, market.marketId)
  const round = new RouletteRound(roundId)
  round.globalRound = globalRound.id
  round.market = market.id
  round.roundNumber = globalRound.roundNumber
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
  round.stakersRevenue = ZERO
  round.jackpotRevenue = ZERO
  round.roundBurnAmount = ZERO
  round.infraRevenue = ZERO
  round.firstBetAt = ZERO
  round.startedAt = startedAt
  return round
}

/** Per-market projection of a global round. Idempotent: returns the existing entity if already created. */
export function createOrLoadMarketRound(
  market: Market,
  localRoundId: BigInt,
  globalRoundId: BigInt,
  round: RouletteRound,
  timestamp: BigInt
): MarketRound {
  const id = marketRoundKey(market.marketId, globalRoundId)
  let mr = MarketRound.load(id)
  if (mr != null) {
    return mr
  }
  mr = new MarketRound(id)
  mr.market = market.id
  mr.localRoundId = localRoundId
  mr.globalRoundId = globalRoundId
  mr.status = ROUND_STATUS_BETTING
  mr.totalBets = ZERO
  mr.betCount = ZERO
  mr.totalPayouts = ZERO
  mr.jackpotFunded = ZERO
  mr.infraFee = ZERO
  mr.startedAt = timestamp
  mr.globalRound = round.id
  return mr
}
