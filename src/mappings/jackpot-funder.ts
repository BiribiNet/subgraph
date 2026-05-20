import { log } from "@graphprotocol/graph-ts"

import {
  BrbRatioUpdated,
  FundedFromMarket,
  FundFromMarketSkipped,
  SlippageBpsUpdated,
  SwapAssetBpsUpdated,
  TreasuryBrbSplitUpdated
} from "../../generated/BRBJackpotFunder/BRBJackpotFunder"
import { JackpotBuy, JackpotFundingSkip, Market } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateJackpotFunderConfig } from "../helpers/jackpot-funder"

export function handleFundedFromMarket(event: FundedFromMarket): void {
  // uint32 marketId comes through as BigInt in the generated bindings (Phase 1C learning).
  const marketIdBig = event.params.marketId
  const market = Market.load(bigintToBytes(marketIdBig))
  if (market == null) {
    log.warning("FundedFromMarket: Market {} not found", [marketIdBig.toString()])
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
  const marketIdBig = event.params.marketId
  const market = Market.load(bigintToBytes(marketIdBig))
  if (market == null) {
    log.warning("FundFromMarketSkipped: Market {} not found", [marketIdBig.toString()])
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

export function handleBrbRatioUpdated(event: BrbRatioUpdated): void {
  // Per-market event — stored on Market.brbRatio rather than the global config.
  const marketIdBig = event.params.marketId
  const market = Market.load(bigintToBytes(marketIdBig))
  if (market == null) {
    log.warning("BrbRatioUpdated: Market {} not found", [marketIdBig.toString()])
    return
  }
  market.brbRatio = event.params.ratioPerAssetUnit
  market.save()
}
