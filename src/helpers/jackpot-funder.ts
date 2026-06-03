import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { JackpotFunderConfig } from "../../generated/schema"
import { ZERO } from "./number"

const CONFIG_KEY = Bytes.fromUTF8("config")

/**
 * Singleton accessor for BRBJackpotFunder configuration. All fields default to
 * ZERO until the corresponding setter event fires (lazy init). The funder
 * contract emits config events on every state-changing setter, so the singleton
 * converges to the on-chain values without a manual bootstrap call.
 */
export function getOrCreateJackpotFunderConfig(timestamp: BigInt): JackpotFunderConfig {
  let cfg = JackpotFunderConfig.load(CONFIG_KEY)
  if (cfg != null) {
    return cfg
  }
  cfg = new JackpotFunderConfig(CONFIG_KEY)
  cfg.swapAssetTotalBps = ZERO
  cfg.treasuryBrbNumerator = ZERO
  cfg.treasuryBrbDenominator = ZERO
  cfg.slippageBps = ZERO
  cfg.coldSlippageBps = ZERO
  cfg.twapWindowSeconds = ZERO
  cfg.lastUpdatedAt = timestamp
  cfg.save()
  return cfg
}
