import { log } from "@graphprotocol/graph-ts"

import {
  FundFromMarketSkipped,
  FundedFromMarket,
  SlippageBpsUpdated,
  SwapAssetBpsUpdated,
  TreasuryBrbSplitUpdated
} from "../../generated/BRBJackpotFunder/BRBJackpotFunder"
import { JackpotBuy, JackpotFundingSkip } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateJackpotFunderConfig } from "../helpers/jackpot-funder"
import { getMarketById } from "../helpers/market"

// NOTE: BrbRatioUpdated handler is intentionally omitted. The event is per-market
// (marketId + ratioPerAssetUnit) but Bastien's `Market` entity (origin/master)
// does not carry a `brbRatio` field. A follow-up PR can either:
//   (a) add `brbRatio: BigInt` to Market in schema.graphql + wire the handler, or
//   (b) introduce a new MarketBrbRatio entity if per-market history is needed.

export function handleFundedFromMarket(event: FundedFromMarket): void {
  const marketIdInt32 = event.params.marketId.toI32()
  const market = getMarketById(marketIdInt32)
  if (market == null) {
    log.warning("FundedFromMarket: Market {} not found", [marketIdInt32.toString()])
    return
  }
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const buy = new JackpotBuy(id)
  buy.market = market.id
  buy.asset = event.params.asset
  buy.assetSwapped = event.params.assetSwapped
  buy.brbOut = event.params.brbOut
  buy.brbToTreasury = event.params.brbToTreasury
  buy.brbBurned = event.params.brbBurned
  buy.timestamp = event.block.timestamp
  buy.blockNumber = event.block.number
  buy.transactionHash = event.transaction.hash
  buy.save()
}

export function handleFundFromMarketSkipped(event: FundFromMarketSkipped): void {
  const marketIdInt32 = event.params.marketId.toI32()
  const market = getMarketById(marketIdInt32)
  if (market == null) {
    log.warning("FundFromMarketSkipped: Market {} not found", [marketIdInt32.toString()])
    return
  }
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const skip = new JackpotFundingSkip(id)
  skip.market = market.id
  skip.asset = event.params.asset
  skip.reason = event.params.reason
  skip.timestamp = event.block.timestamp
  skip.save()
}

export function handleSwapAssetBpsUpdated(event: SwapAssetBpsUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp)
  cfg.swapAssetTotalBps = event.params.totalBps
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleTreasuryBrbSplitUpdated(event: TreasuryBrbSplitUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp)
  cfg.treasuryBrbNumerator = event.params.numerator
  cfg.treasuryBrbDenominator = event.params.denominator
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleSlippageBpsUpdated(event: SlippageBpsUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp)
  cfg.slippageBps = event.params.slippageBps
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}
