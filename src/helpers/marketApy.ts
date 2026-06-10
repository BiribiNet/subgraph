import { BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { Market, MarketAPYSnapshot } from "../../generated/schema"
import { ZERO } from "./number"
import { calculateSharePrice } from "./globalState"

const SECONDS_PER_DAY = BigInt.fromI32(86400)

function marketSnapshotId(marketId: string, timestamp: BigInt): string {
  const day = timestamp.div(SECONDS_PER_DAY)
  return marketId + "-" + day.toString()
}

function createMarketSnapshotIfNeeded(
  market: Market,
  timestamp: BigInt,
  blockNumber: BigInt
): void {
  const id = marketSnapshotId(market.id, timestamp)
  let snapshot = MarketAPYSnapshot.load(id)
  if (snapshot != null) {
    return
  }

  snapshot = new MarketAPYSnapshot(id)
  snapshot.market = market.id
  snapshot.totalAssets = market.totalAssets
  snapshot.totalShares = market.totalShares
  snapshot.timestamp = timestamp
  snapshot.blockNumber = blockNumber
  snapshot.sharePrice = calculateSharePrice(market.totalAssets, market.totalShares, market.assetDecimals)
  snapshot.stakerCount = market.stakerCount
  snapshot.apy7Day = market.apy7Day
  snapshot.apy30Day = market.apy30Day
  snapshot.apyLifetime = market.apyLifetime
  snapshot.save()
}

// Days without vault events have no snapshot, so the exact target day can be
// missing — scan a few days further back. Annualization stays correct because
// calculateAPYInternal uses the actual snapshot timestamp.
const MAX_SNAPSHOT_LOOKBACK_DAYS: i32 = 6

function getMarketSnapshotFromDaysAgo(
  marketId: string,
  currentTimestamp: BigInt,
  daysAgo: BigInt
): MarketAPYSnapshot | null {
  const targetDay = currentTimestamp.div(SECONDS_PER_DAY).minus(daysAgo)
  for (let lookback: i32 = 0; lookback <= MAX_SNAPSHOT_LOOKBACK_DAYS; lookback++) {
    const day = targetDay.minus(BigInt.fromI32(lookback))
    if (day.lt(ZERO)) {
      break
    }
    const snapshot = MarketAPYSnapshot.load(marketId + "-" + day.toString())
    if (snapshot != null && snapshot.totalShares.gt(ZERO) && snapshot.totalAssets.gt(ZERO)) {
      return snapshot
    }
  }
  return null
}

function calculateAPYInternal(
  currentTotalAssets: BigInt,
  currentTotalShares: BigInt,
  baselineTotalAssets: BigInt,
  baselineTotalShares: BigInt,
  currentTimestamp: BigInt,
  baselineTimestamp: BigInt
): BigDecimal {
  if (currentTotalShares.equals(ZERO) || currentTotalAssets.equals(ZERO)) {
    return BigDecimal.fromString("0")
  }
  if (baselineTimestamp.equals(ZERO)) {
    return BigDecimal.fromString("0")
  }
  if (baselineTotalShares.equals(ZERO) || baselineTotalAssets.equals(ZERO)) {
    return BigDecimal.fromString("0")
  }

  const timeElapsed = currentTimestamp.minus(baselineTimestamp)
  if (timeElapsed.le(ZERO)) {
    return BigDecimal.fromString("0")
  }

  const PRECISION = BigInt.fromI32(10).pow(18)
  const currentShareValue = currentTotalAssets.times(PRECISION).div(currentTotalShares)
  const baselineShareValue = baselineTotalAssets.times(PRECISION).div(baselineTotalShares)

  const growthRate = currentShareValue
    .toBigDecimal()
    .div(baselineShareValue.toBigDecimal())
    .minus(BigDecimal.fromString("1"))

  const SECONDS_PER_YEAR = BigDecimal.fromString("31536000")
  const annualizationFactor = SECONDS_PER_YEAR.div(timeElapsed.toBigDecimal())
  return growthRate.times(annualizationFactor).times(BigDecimal.fromString("100"))
}

/**
 * Per-market APY using daily snapshots — never mixes asset units across markets.
 */
export function calculateMarketAPYs(
  market: Market,
  currentTimestamp: BigInt,
  blockNumber: BigInt
): void {
  if (
    !market.lastApySnapshotTimestamp.equals(ZERO) &&
    currentTimestamp.lt(market.lastApySnapshotTimestamp)
  ) {
    return
  }

  // Donations or bet events can fire before the first staker deposit; baselining
  // here would freeze the lifetime baseline at totalShares = 0 forever.
  if (market.totalShares.equals(ZERO) && market.apyLifetimeBaselineTimestamp.equals(ZERO)) {
    return
  }

  // Compare UTC day ids (not a 24h delta) so the first event of each new day
  // produces that day's snapshot even when <24h elapsed since the previous one.
  const currentDay = currentTimestamp.div(SECONDS_PER_DAY)
  const lastSnapshotDay = market.lastApySnapshotTimestamp.div(SECONDS_PER_DAY)
  if (market.lastApySnapshotTimestamp.equals(ZERO) || currentDay.gt(lastSnapshotDay)) {
    createMarketSnapshotIfNeeded(market, currentTimestamp, blockNumber)
    market.lastApySnapshotTimestamp = currentTimestamp
  }

  if (market.apyLifetimeBaselineTimestamp.equals(ZERO)) {
    market.apyLifetimeBaselineTimestamp = currentTimestamp
    market.apyLifetimeBaselineTotalAssets = market.totalAssets
    market.apyLifetimeBaselineTotalShares = market.totalShares
  }

  const snapshot7DaysAgo = getMarketSnapshotFromDaysAgo(market.id, currentTimestamp, BigInt.fromI32(7))
  if (snapshot7DaysAgo) {
    market.apy7Day = calculateAPYInternal(
      market.totalAssets,
      market.totalShares,
      snapshot7DaysAgo.totalAssets,
      snapshot7DaysAgo.totalShares,
      currentTimestamp,
      snapshot7DaysAgo.timestamp
    )
  } else {
    market.apy7Day = calculateAPYInternal(
      market.totalAssets,
      market.totalShares,
      market.apyLifetimeBaselineTotalAssets,
      market.apyLifetimeBaselineTotalShares,
      currentTimestamp,
      market.apyLifetimeBaselineTimestamp
    )
  }

  const snapshot30DaysAgo = getMarketSnapshotFromDaysAgo(market.id, currentTimestamp, BigInt.fromI32(30))
  if (snapshot30DaysAgo) {
    market.apy30Day = calculateAPYInternal(
      market.totalAssets,
      market.totalShares,
      snapshot30DaysAgo.totalAssets,
      snapshot30DaysAgo.totalShares,
      currentTimestamp,
      snapshot30DaysAgo.timestamp
    )
  } else {
    market.apy30Day = calculateAPYInternal(
      market.totalAssets,
      market.totalShares,
      market.apyLifetimeBaselineTotalAssets,
      market.apyLifetimeBaselineTotalShares,
      currentTimestamp,
      market.apyLifetimeBaselineTimestamp
    )
  }

  const snapshot365DaysAgo = getMarketSnapshotFromDaysAgo(market.id, currentTimestamp, BigInt.fromI32(365))
  if (snapshot365DaysAgo) {
    market.apy365Day = calculateAPYInternal(
      market.totalAssets,
      market.totalShares,
      snapshot365DaysAgo.totalAssets,
      snapshot365DaysAgo.totalShares,
      currentTimestamp,
      snapshot365DaysAgo.timestamp
    )
  } else {
    market.apy365Day = calculateAPYInternal(
      market.totalAssets,
      market.totalShares,
      market.apyLifetimeBaselineTotalAssets,
      market.apyLifetimeBaselineTotalShares,
      currentTimestamp,
      market.apyLifetimeBaselineTimestamp
    )
  }

  market.apyLifetime = calculateAPYInternal(
    market.totalAssets,
    market.totalShares,
    market.apyLifetimeBaselineTotalAssets,
    market.apyLifetimeBaselineTotalShares,
    currentTimestamp,
    market.apyLifetimeBaselineTimestamp
  )

  market.sharePrice = calculateSharePrice(market.totalAssets, market.totalShares, market.assetDecimals)
}
