import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { SideBet as SideBetContract } from "../../generated/SideBet/SideBet"
import { SideBet, SideBetConfig, SideBetGlobalConfig } from "../../generated/schema"
import { bigintToBytes } from "./bigintToBytes"
import { getOrCreateUser, updateUserLastActive } from "./user"
import { recordUserMarketSideBetStake } from "./user-market-stats"
import { requireMarket } from "./market"

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

/**
 * Mark a config inactive so it stops being offered.
 *
 * `getConfig` REVERTS with `ConfigInactive` for a removed config — it never reports `marketId == 0`
 * — so deactivation cannot go through an on-chain read. `ConfigRemoved` carries the id, which is
 * all this needs.
 */
export function deactivateSideBetConfig(configId: BigInt, timestamp: BigInt): void {
  const existing = SideBetConfig.load(configId.toString())
  if (existing == null) {
    return
  }
  existing.active = false
  existing.lastUpdatedAt = timestamp
  existing.save()
}

export function syncSideBetConfig(
  contract: SideBetContract,
  configId: BigInt,
  timestamp: BigInt
): SideBetConfig | null {
  const cfgResult = contract.try_getConfig(configId)
  if (cfgResult.reverted) {
    // The only reverts here are `ConfigInactive` (removed) and `UnknownConfig` (id past the
    // count, impossible for an event-driven call). Either way the config must not stay active.
    log.warning("SideBet getConfig({}) reverted — deactivating", [configId.toString()])
    deactivateSideBetConfig(configId, timestamp)
    return null
  }
  const cfg = cfgResult.value
  const marketId = cfg.marketId.toI32()

  const market = requireMarket(marketId)
  let entity = SideBetConfig.load(configId.toString())
  if (entity == null) {
    entity = new SideBetConfig(configId.toString())
    entity.createdAt = timestamp
    entity.minStake = BigInt.zero()
    entity.maxStake = BigInt.zero()
  }
  entity.configId = configId
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

/** Everything `SideBetPlaced` carries. Enough to index a bet without touching the chain. */
export class SideBetPlacedInput {
  constructor(
    public betId: BigInt,
    public configId: BigInt,
    public player: Address,
    public marketId: i32,
    public stake: BigInt,
    public payout: BigInt,
    public startGlobalRound: BigInt,
    public windowSpins: i32
  ) {}
}

/**
 * Index a side bet from its `SideBetPlaced` event.
 *
 * The event alone carries player, market, stake, payout, window and start round, so the bet is
 * always created — an `eth_call` failure or a market the registry has not indexed yet can no longer
 * make it disappear. `getBet` is still preferred for the descriptive fields (bet kind, targets)
 * because the contract snapshots the config into the bet, and a later `updateConfig` would make the
 * live config entity describe the bet incorrectly. When that read fails we fall back to the indexed
 * `SideBetConfig`, and only then to defaults.
 */
export function createSideBetFromPlacedEvent(
  contract: SideBetContract,
  input: SideBetPlacedInput,
  timestamp: BigInt
): SideBet {
  const id = sideBetIdFromBetId(input.betId)
  const existing = SideBet.load(id)
  if (existing != null) {
    return existing
  }

  // requireMarket, not getMarketById: a bet in a market the registry has not indexed yet gets a
  // provisional market rather than being dropped, matching what the config path already does.
  const market = requireMarket(input.marketId)

  const bet = new SideBet(id)
  bet.configId = input.configId
  bet.player = getOrCreateUser(input.player).id
  bet.market = market.id
  bet.bank = market.bank
  bet.startGlobalRound = input.startGlobalRound
  bet.windowSpins = input.windowSpins
  bet.spinsResolved = 0
  bet.stake = input.stake
  bet.potentialPayout = input.payout
  bet.actualPayout = BigInt.zero()
  bet.status = "ACTIVE"
  bet.placedAt = timestamp
  bet.spinsObserved = []
  bet.multiplierBps = deriveMultiplierBps(input.stake, input.payout)

  applyBetDescription(bet, contract, input.betId, input.configId)
  bet.save()

  recordUserMarketSideBetStake(input.player, market, input.stake, timestamp)
  updateUserLastActive(input.player, timestamp)
  return bet
}

/**
 * Recover a bet seen only at settlement time.
 *
 * `SideBetSettled` carries just (betId, player, outcome, payout), so market, stake and window must
 * come from `getBet`. Returns null when that read fails — there is genuinely nothing to store.
 * `configId` stays null: the on-chain `Bet` struct does not keep it, and writing 0 would be
 * indistinguishable from a real config 0.
 */
export function recoverSideBetFromChain(
  contract: SideBetContract,
  betId: BigInt,
  timestamp: BigInt
): SideBet | null {
  const id = sideBetIdFromBetId(betId)
  const existing = SideBet.load(id)
  if (existing != null) {
    return existing
  }

  const betResult = contract.try_getBet(betId)
  if (betResult.reverted) {
    log.warning("SideBet getBet({}) reverted — cannot recover bet at settlement", [betId.toString()])
    return null
  }
  const onChain = betResult.value
  const market = requireMarket(onChain.marketId.toI32())

  const bet = new SideBet(id)
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
  bet.multiplierBps = deriveMultiplierBps(onChain.stake, onChain.payout)
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

/** payout/stake as basis points. Returns 0 for a zero stake, which the contract rejects anyway. */
function deriveMultiplierBps(stake: BigInt, payout: BigInt): i32 {
  if (stake.le(BigInt.zero())) {
    return 0
  }
  return payout.times(BPS_DENOMINATOR).div(stake).toI32()
}

/**
 * Fill in the bet-kind fields, preferring the on-chain snapshot over the live config.
 *
 * Leaves `betType` at COLOR_COUNT (enum value 0) when neither source is available, so the bet is
 * still stored with its correct money fields rather than dropped.
 */
function applyBetDescription(
  bet: SideBet,
  contract: SideBetContract,
  betId: BigInt,
  configId: BigInt
): void {
  const betResult = contract.try_getBet(betId)
  if (!betResult.reverted) {
    const onChain = betResult.value
    bet.betType = sideBetTypeFromI32(onChain.betType)
    const betColor = sideBetColorFromI32(onChain.color)
    if (betColor != "") {
      bet.color = betColor
    }
    bet.targetNumber = onChain.targetNumber
    bet.targetCount = onChain.targetCount
    bet.redRatioBps = onChain.redRatioBps
    bet.placedAt = onChain.placedAt
    return
  }

  const config = SideBetConfig.load(configId.toString())
  if (config != null) {
    log.warning("SideBet getBet({}) reverted — describing bet from config {}", [
      betId.toString(),
      configId.toString(),
    ])
    bet.betType = config.betType
    bet.color = config.color
    bet.targetNumber = config.targetNumber
    bet.targetCount = config.targetCount
    bet.redRatioBps = config.redRatioBps
    return
  }

  log.warning("SideBet {}: neither getBet nor config {} available — kind fields left at defaults", [
    betId.toString(),
    configId.toString(),
  ])
  bet.betType = sideBetTypeFromI32(0)
}
