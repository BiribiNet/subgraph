import { BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { Market, MarketAPYSnapshot, MarketReturnObservation } from "../../generated/schema"
import { ZERO } from "./number"

/** Simple annualized share-price change; zero NAV is a loss, not zero performance. */
export function observedApr(assets: BigInt, shares: BigInt, baselineAssets: BigInt,
  baselineShares: BigInt, from: BigInt, to: BigInt): BigDecimal | null {
  if (shares.le(ZERO) || baselineShares.le(ZERO) || baselineAssets.le(ZERO) || to.le(from)) return null
  const ratio = assets.times(baselineShares).toBigDecimal().div(shares.times(baselineAssets).toBigDecimal())
  return ratio.minus(BigDecimal.fromString("1")).times(BigDecimal.fromString("3153600000"))
    .div(to.minus(from).toBigDecimal())
}

function baseline(market: string, timestamp: BigInt, days: i32): MarketAPYSnapshot | null {
  const day = timestamp.div(BigInt.fromI32(86400)).minus(BigInt.fromI32(days))
  for (let offset = 0; offset <= 6; offset++) {
    const candidate = day.minus(BigInt.fromI32(offset))
    if (candidate.lt(ZERO)) break
    const snapshot = MarketAPYSnapshot.load(market + "-" + candidate.toString())
    if (snapshot != null && snapshot.totalAssets.gt(ZERO) && snapshot.totalShares.gt(ZERO) && snapshot.timestamp.le(timestamp.minus(BigInt.fromI32(days).times(BigInt.fromI32(86400))))) return snapshot
  }
  return null
}

export function recordMarketReturns(market: Market, timestamp: BigInt, block: BigInt): void {
  const row = new MarketReturnObservation(market.id)
  row.market = market.id
  row.calculationVersion = 2
  row.methodology = "SIMPLE_ANNUALIZED_SHARE_PRICE_CHANGE"
  row.observedAt = timestamp
  row.observedBlock = block
  const s7 = baseline(market.id, timestamp, 7)
  const s30 = baseline(market.id, timestamp, 30)
  const s365 = baseline(market.id, timestamp, 365)
  if (s7 != null) {
    row.apr7Day = observedApr(market.totalAssets, market.totalShares, s7.totalAssets, s7.totalShares, s7.timestamp, timestamp)
    row.from7Day = s7.timestamp
  }
  if (s30 != null) {
    row.apr30Day = observedApr(market.totalAssets, market.totalShares, s30.totalAssets, s30.totalShares, s30.timestamp, timestamp)
    row.from30Day = s30.timestamp
  }
  if (s365 != null) {
    row.apr365Day = observedApr(market.totalAssets, market.totalShares, s365.totalAssets, s365.totalShares, s365.timestamp, timestamp)
    row.from365Day = s365.timestamp
  }
  if (market.apyLifetimeBaselineTimestamp.gt(ZERO)) {
    row.aprLifetime = observedApr(market.totalAssets, market.totalShares, market.apyLifetimeBaselineTotalAssets,
      market.apyLifetimeBaselineTotalShares, market.apyLifetimeBaselineTimestamp, timestamp)
    row.fromLifetime = market.apyLifetimeBaselineTimestamp
  }
  row.save()
}
