import { Address, BigInt } from "@graphprotocol/graph-ts"
import { JackpotFunderConfig } from "../../generated/schema"
import { BRBJackpotFunder } from "../../generated/BRBJackpotFunder/BRBJackpotFunder"

/** Address-scoped snapshot. A reverted getter remains unknown, never a synthetic zero. */
export function getOrCreateJackpotFunderConfig(timestamp: BigInt, address: Address): JackpotFunderConfig {
  let cfg = JackpotFunderConfig.load(address)
  if (cfg != null) return cfg
  cfg = new JackpotFunderConfig(address)
  const funder = BRBJackpotFunder.bind(address)
  const swapAssetTotalBps = funder.try_swapAssetTotalBps()
  if (!swapAssetTotalBps.reverted) cfg.swapAssetTotalBps = swapAssetTotalBps.value
  const treasuryBrbNumerator = funder.try_treasuryBrbNumerator()
  if (!treasuryBrbNumerator.reverted) cfg.treasuryBrbNumerator = treasuryBrbNumerator.value
  const treasuryBrbDenominator = funder.try_treasuryBrbDenominator()
  if (!treasuryBrbDenominator.reverted) cfg.treasuryBrbDenominator = treasuryBrbDenominator.value
  const slippageBps = funder.try_slippageBps()
  if (!slippageBps.reverted) cfg.slippageBps = slippageBps.value
  const coldSlippageBps = funder.try_coldSlippageBps()
  if (!coldSlippageBps.reverted) cfg.coldSlippageBps = coldSlippageBps.value
  const twapWindowSeconds = funder.try_twapWindowSeconds()
  if (!twapWindowSeconds.reverted) cfg.twapWindowSeconds = twapWindowSeconds.value
  cfg.lastUpdatedAt = timestamp
  cfg.save()
  return cfg
}