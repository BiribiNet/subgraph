import { BigInt } from "@graphprotocol/graph-ts"
import { GlobalRound, RouletteRound } from "../../generated/schema"
import {
  ROUND_STATUS_CLEAN,
  ROUND_STATUS_NO_MORE_BETS,
} from "./constant"
import { globalRoundIdBytes } from "./globalRound"
import { marketRoundId, requireMarket } from "./market"
import { clearMarketPendingBets } from "./vault-liquidity"
import { updateRoundRevenueAggregates } from "./aggregation"
import { settleMaskLegsOfRound } from "./mask-bet"
import { settleDualLegsOfRound } from "./dual-bet"

const MAX_MARKET_SCAN: i32 = 32

export function syncAllMarketRoundsForGlobalRound(
  globalRoundId: BigInt,
  status: string
): void {
  for (let marketId = 1; marketId <= MAX_MARKET_SCAN; marketId++) {
    const round = RouletteRound.load(marketRoundId(globalRoundId, marketId))
    if (round == null || round.betCount.equals(BigInt.fromI32(0))) {
      continue
    }
    round.status = status
    round.save()
  }
}

export function finalizeMarketRoundsOnResolve(globalRoundId: BigInt, timestamp: BigInt, blockNumber: BigInt = BigInt.zero()): void {
  syncAllMarketRoundsForGlobalRound(globalRoundId, ROUND_STATUS_CLEAN)
  for (let marketId = 1; marketId <= MAX_MARKET_SCAN; marketId++) {
    const round = RouletteRound.load(marketRoundId(globalRoundId, marketId))
    if (round == null) {
      continue
    }
    const market = requireMarket(marketId)
    clearMarketPendingBets(market)
    updateRoundRevenueAggregates(round, timestamp, blockNumber)
    market.maxBetAmount = BigInt.fromI32(0)
    market.save()
  }
}

/** Applies the published VRF draw to special legs across the market slices. */
export function settleSpecialLegsForGlobalRound(
  globalRound: GlobalRound,
  winningNumber: i32,
  jackpotNumber: i32,
  timestamp: BigInt,
  blockNumber: BigInt
): void {
  const rounds = globalRound.marketRounds.load()
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index]
    if (!round.maskBetsPayout.isZero()) settleMaskLegsOfRound(round, winningNumber, timestamp, blockNumber)
    settleDualLegsOfRound(round, winningNumber, jackpotNumber)
  }
}

export function lockAllParticipatingMarketRounds(globalRoundId: BigInt): void {
  syncAllMarketRoundsForGlobalRound(globalRoundId, ROUND_STATUS_NO_MORE_BETS)
}

export function findBurnRoundForGlobalRound(globalRoundId: BigInt): RouletteRound | null {
  for (let marketId = 1; marketId <= MAX_MARKET_SCAN; marketId++) {
    const round = RouletteRound.load(marketRoundId(globalRoundId, marketId))
    if (round != null && round.jackpotRevenue.gt(BigInt.fromI32(0))) {
      return round
    }
  }
  for (let marketId = 1; marketId <= MAX_MARKET_SCAN; marketId++) {
    const round = RouletteRound.load(marketRoundId(globalRoundId, marketId))
    if (round != null && round.betCount.gt(BigInt.fromI32(0))) {
      return round
    }
  }
  return null
}

export function loadGlobalRoundOrNull(globalRoundId: BigInt): GlobalRound | null {
  return GlobalRound.load(globalRoundIdBytes(globalRoundId))
}
