import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { SideBet as SideBetContract } from "../../generated/SideBet/SideBet"
import { SideBet, SideBetConfig, SideBetGlobalConfig } from "../../generated/schema"
import { bigintToBytes } from "./bigintToBytes"
import { getOrCreateUser, updateUserLastActive } from "./user"
import { recordUserMarketSideBetStake } from "./user-market-stats"
import { getMarketById, requireMarket } from "./market"

const BPS_DENOMINATOR = BigInt.fromI32(10000)

const SIDE_BET_CONFIG_KEY = Bytes.fromUTF8("config")

/**
 * Singleton accessor for the SideBet pricing band (MultiplierBandUpdated).
 * Bounds default to 0 until the first band event fires (lazy init).
 */
export function getOrCreateSideBetGlobalConfig(timestamp: BigInt): SideBetGlobalConfig {
  let cfg = SideBetGlobalConfig.load(SIDE_BET_CONFIG_KEY)
  if (cfg != null) {
    return cfg
  }
  cfg = new SideBetGlobalConfig(SIDE_BET_CONFIG_KEY)
  cfg.minMultiplierBps = 0
  cfg.maxMultiplierBps = 0
  cfg.lastUpdatedAt = timestamp
  cfg.save()
  return cfg
}

export function sideBetIdFromBetId(betId: BigInt): Bytes {
  return bigintToBytes(betId)
}

export function sideBetTypeFromI32(value: i32): string {
  if (value == 0) return "COLOR_COUNT"
  if (value == 1) return "NUMBER_HIT"
  if (value == 2) return "CONSECUTIVE_STREAK"
  if (value == 3) return "RED_RATIO"
  if (value == 4) return "LIGHTNING_DOUBLE"
  if (value == 5) return "PERFECT_ALTERNATION"
  if (value == 6) return "DOZEN_HIT"
  if (value == 7) return "COLUMN_HIT"
  if (value == 8) return "JACKPOT_IN_WINDOW"
  log.warning("Unknown SideBetType value {}", [value.toString()])
  return "COLOR_COUNT"
}

export function sideBetColorFromI32(value: i32): string {
  if (value == 0) return "RED"
  if (value == 1) return "BLACK"
  return ""
}

export function sideBetStatusFromI32(value: i32): string {
  if (value == 0) return "ACTIVE"
  if (value == 1) return "WON"
  if (value == 2) return "LOST"
  if (value == 3) return "EXPIRED"
  if (value == 4) return "CANCELLED"
  log.warning("Unknown SideBetStatus value {}", [value.toString()])
  return "ACTIVE"
}

export function syncSideBetConfig(
  contract: SideBetContract,
  configId: BigInt,
  timestamp: BigInt
): SideBetConfig | null {
  const cfgResult = contract.try_getConfig(configId)
  if (cfgResult.reverted) {
    log.warning("getConfig({}) reverted", [configId.toString()])
    return null
  }
  const cfg = cfgResult.value
  const marketId = cfg.marketId.toI32()
  if (marketId == 0) {
    const existing = SideBetConfig.load(configId.toString())
    if (existing != null) {
      existing.active = false
      existing.lastUpdatedAt = timestamp
      existing.save()
    }
    return null
  }

  const market = requireMarket(marketId)
  let entity = SideBetConfig.load(configId.toString())
  if (entity == null) {
    entity = new SideBetConfig(configId.toString())
    entity.createdAt = timestamp
    entity.minStake = BigInt.zero()
    entity.maxStake = BigInt.zero()
  }
  entity.market = market.id
  entity.betType = sideBetTypeFromI32(cfg.betType)
  const cfgColor = sideBetColorFromI32(cfg.color)
  if (cfgColor != "") {
    entity.color = cfgColor
  }
  entity.targetNumber = cfg.targetNumber
  entity.targetCount = cfg.targetCount
  entity.redRatioBps = cfg.redRatioBps
  entity.windowSpins = cfg.windowSpins
  entity.multiplierBps = cfg.multiplierBps.toI32()
  entity.minStake = cfg.minStake
  entity.maxStake = cfg.maxStake
  entity.active = true
  entity.lastUpdatedAt = timestamp
  entity.save()
  return entity
}

export function createSideBetFromChain(
  contract: SideBetContract,
  betId: BigInt,
  configId: BigInt,
  timestamp: BigInt
): SideBet | null {
  const betResult = contract.try_getBet(betId)
  if (betResult.reverted) {
    log.warning("getBet({}) reverted", [betId.toString()])
    return null
  }
  const onChain = betResult.value
  const marketId = onChain.marketId.toI32()
  const market = getMarketById(marketId)
  if (market == null) {
    log.warning("SideBet {}: market {} not registered", [betId.toString(), marketId.toString()])
    return null
  }

  const id = sideBetIdFromBetId(betId)
  let bet = SideBet.load(id)
  if (bet != null) {
    return bet
  }

  bet = new SideBet(id)
  bet.configId = configId
  bet.player = getOrCreateUser(onChain.player).id
  bet.market = market.id
  bet.bank = market.bank
  bet.betType = sideBetTypeFromI32(onChain.betType)
  const betColor = sideBetColorFromI32(onChain.color)
  if (betColor != "") {
    bet.color = betColor
  }
  bet.targetNumber = onChain.targetNumber
  bet.targetCount = onChain.targetCount
  bet.redRatioBps = onChain.redRatioBps
  bet.startGlobalRound = onChain.startGlobalRound
  bet.windowSpins = onChain.windowSpins
  bet.spinsResolved = 0
  if (onChain.stake.gt(BigInt.zero())) {
    bet.multiplierBps = onChain.payout.times(BPS_DENOMINATOR).div(onChain.stake).toI32()
  } else {
    bet.multiplierBps = 0
  }
  bet.stake = onChain.stake
  bet.potentialPayout = onChain.payout
  bet.actualPayout = BigInt.zero()
  bet.status = sideBetStatusFromI32(onChain.status)
  bet.placedAt = onChain.placedAt
  bet.spinsObserved = []
  bet.save()

  recordUserMarketSideBetStake(onChain.player, market, onChain.stake, timestamp)
  updateUserLastActive(onChain.player, timestamp)
  return bet
}
