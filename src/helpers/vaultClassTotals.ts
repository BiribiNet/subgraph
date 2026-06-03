import { BigInt } from "@graphprotocol/graph-ts"
import { Market, GlobalState } from "../../generated/schema"
import { ZERO } from "./number"

const ASSET_CLASS_BRB = "BRB"

function clampSubtract(value: BigInt, delta: BigInt): BigInt {
  if (value.ge(delta)) {
    return value.minus(delta)
  }
  return ZERO
}

export function addVaultDepositTotals(market: Market, globalState: GlobalState, assets: BigInt): void {
  if (market.assetClass == ASSET_CLASS_BRB) {
    globalState.brbVaultTotalDeposits = globalState.brbVaultTotalDeposits.plus(assets)
    globalState.brbVaultTotalAssets = globalState.brbVaultTotalAssets.plus(assets)
  } else {
    globalState.stableVaultTotalDeposits = globalState.stableVaultTotalDeposits.plus(assets)
    globalState.stableVaultTotalAssets = globalState.stableVaultTotalAssets.plus(assets)
  }
}

export function subtractVaultAssetsTotals(market: Market, globalState: GlobalState, grossAssets: BigInt): void {
  if (market.assetClass == ASSET_CLASS_BRB) {
    globalState.brbVaultTotalAssets = clampSubtract(globalState.brbVaultTotalAssets, grossAssets)
  } else {
    globalState.stableVaultTotalAssets = clampSubtract(globalState.stableVaultTotalAssets, grossAssets)
  }
}
