import { BigInt } from "@graphprotocol/graph-ts"
import { Market } from "../../generated/schema"
import { calculateSharePrice } from "./globalState"
import { ZERO } from "./number"

export function syncMarketTotalAssets(market: Market): void {
  if (market.grossVaultBalance.ge(market.lockedBetLiquidity)) {
    market.totalAssets = market.grossVaultBalance.minus(market.lockedBetLiquidity)
  } else {
    market.totalAssets = ZERO
  }
  market.sharePrice = calculateSharePrice(market.totalAssets, market.totalShares, market.assetDecimals)
}

export function addGrossVaultBalance(market: Market, amount: BigInt): void {
  if (amount.equals(ZERO)) {
    return
  }
  market.grossVaultBalance = market.grossVaultBalance.plus(amount)
  syncMarketTotalAssets(market)
}

export function subtractGrossVaultBalance(market: Market, amount: BigInt): void {
  if (amount.equals(ZERO)) {
    return
  }
  if (market.grossVaultBalance.ge(amount)) {
    market.grossVaultBalance = market.grossVaultBalance.minus(amount)
  } else {
    market.grossVaultBalance = ZERO
  }
  syncMarketTotalAssets(market)
}

export function setLockedBetLiquidity(market: Market, newLockedTotal: BigInt): void {
  market.lockedBetLiquidity = newLockedTotal
  syncMarketTotalAssets(market)
}

export function addLockedBetLiquidity(market: Market, amount: BigInt): void {
  if (amount.equals(ZERO)) {
    return
  }
  market.lockedBetLiquidity = market.lockedBetLiquidity.plus(amount)
  syncMarketTotalAssets(market)
}
