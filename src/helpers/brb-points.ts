import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { BRBPointsConfig, User } from "../../generated/schema"
import { ZERO } from "./number"

const CONFIG_KEY = Bytes.fromUTF8("config")

const DEFAULT_WAGERED_WEIGHT = BigInt.fromI32(3)
const DEFAULT_STAKED_WEIGHT = BigInt.fromI32(1)
const DEFAULT_REFERRAL_WEIGHT = BigInt.fromI32(2)
// 1e18 — so 1 BRB wagered with weight 3 contributes 3 raw points.
const DEFAULT_DIVISOR = BigInt.fromI32(10).pow(18)

// Tier thresholds. MUST stay in sync with frontend BRBP_TIERS
// (frontend/hooks/use-biribi-points.ts). Subgraph is the source of truth
// for `user.tier`; the frontend reads it directly via the GET_USER_PROFILE query.
const TIER_SILVER = BigInt.fromI32(500)
const TIER_GOLD = BigInt.fromI32(2000)
const TIER_PLATINUM = BigInt.fromI32(5000)
const TIER_DIAMOND = BigInt.fromI32(15000)
const TIER_LEGEND = BigInt.fromI32(50000)

export function getOrCreateBrbPointsConfig(timestamp: BigInt): BRBPointsConfig {
  let cfg = BRBPointsConfig.load(CONFIG_KEY)
  if (cfg != null) {
    return cfg
  }
  cfg = new BRBPointsConfig(CONFIG_KEY)
  cfg.wageredWeight = DEFAULT_WAGERED_WEIGHT
  cfg.stakedWeight = DEFAULT_STAKED_WEIGHT
  cfg.referralWeight = DEFAULT_REFERRAL_WEIGHT
  cfg.divisor = DEFAULT_DIVISOR
  cfg.lastUpdatedAt = timestamp
  cfg.save()
  return cfg
}

export function computeBrbPoints(user: User, cfg: BRBPointsConfig): BigInt {
  if (cfg.divisor.le(ZERO)) {
    return ZERO
  }
  const wagered = user.totalRouletteBets.times(cfg.wageredWeight)
  const staked = user.totalStaked.times(cfg.stakedWeight)
  const referral = user.totalBrbrEarned.times(cfg.referralWeight)
  const weighted = wagered.plus(staked).plus(referral)
  return weighted.div(cfg.divisor)
}

export function computeTier(points: BigInt): string {
  if (points.ge(TIER_LEGEND)) return "LEGEND"
  if (points.ge(TIER_DIAMOND)) return "DIAMOND"
  if (points.ge(TIER_PLATINUM)) return "PLATINUM"
  if (points.ge(TIER_GOLD)) return "GOLD"
  if (points.ge(TIER_SILVER)) return "SILVER"
  return "BRONZE"
}

export function recomputeAndSaveUserPoints(user: User, timestamp: BigInt): void {
  const cfg = getOrCreateBrbPointsConfig(timestamp)
  const points = computeBrbPoints(user, cfg)
  user.brbpPoints = points
  user.tier = computeTier(points)
  user.save()
}
