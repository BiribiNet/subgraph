import { log } from "@graphprotocol/graph-ts"

import {
  ColdSlippageBpsUpdated,
  FundFromMarketSkipped,
  FundedFromMarket,
  PairObservationUpdated,
  SlippageBpsUpdated,
  SwapAssetBpsUpdated,
  TreasuryBrbSplitUpdated,
  TwapWindowUpdated,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
} from "../../generated/BRBJackpotFunder/BRBJackpotFunder"
import { JackpotBuy, JackpotFundingSkip } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateJackpotFunderConfig } from "../helpers/jackpot-funder"
import { getMarketById } from "../helpers/market"
import {
  ROLE_CONTRACT_JACKPOT_FUNDER,
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
} from "../helpers/access-control"

// NOTE: BrbRatioUpdated was removed from the funder in the Uniswap V2 TWAP rework
// (the per-market fixed ratio setter is gone — BRB price now derives from the
// on-chain TWAP), so no handler is wired for it. The TWAP config setters below
// keep the JackpotFunderConfig singleton in sync with the on-chain pricing
// parameters (cold slippage + TWAP window).

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

export function handleColdSlippageBpsUpdated(event: ColdSlippageBpsUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp)
  cfg.coldSlippageBps = event.params.coldSlippageBps
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleTwapWindowUpdated(event: TwapWindowUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp)
  cfg.twapWindowSeconds = event.params.twapWindowSeconds
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

// PairObservationUpdated fires whenever the funder refreshes its TWAP observation
// for a BRB/<asset> pair. We only bump lastUpdatedAt on the config singleton — the
// raw observation history is not needed by any consumer yet.
export function handlePairObservationUpdated(event: PairObservationUpdated): void {
  const cfg = getOrCreateJackpotFunderConfig(event.block.timestamp)
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_JACKPOT_FUNDER,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleRevoked(event: RoleRevoked): void {
  revokeRoleHolder(
    event.address,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleAdminChanged(event: RoleAdminChanged): void {
  updateRoleAdmin(
    event.address,
    ROLE_CONTRACT_JACKPOT_FUNDER,
    event.params.role,
    event.params.newAdminRole
  )
}
