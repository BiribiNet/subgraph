import { Address, BigInt, log } from "@graphprotocol/graph-ts"

import {
  ConfigAdded,
  ConfigRemoved,
  ConfigStakeLimitsUpdated,
  ConfigUpdated,
  SideBetInfrastructureFeePaid,
  SideBetJackpotFunded,
  SideBetPlaced,
  SideBetSettled,
  SideBet as SideBetContract
} from "../../generated/SideBet/SideBet"
import { SideBet, SideBetConfig, SideBetSettlement } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { requireMarket } from "../helpers/market"
import { ZERO } from "../helpers/number"
import { getOrCreateUser } from "../helpers/user"

// On-chain enum index → schema enum string. Order MUST match ISideBet.sol.
const SIDE_BET_TYPE_BY_INDEX: string[] = [
  "COLOR_COUNT",
  "NUMBER_HIT",
  "CONSECUTIVE_STREAK",
  "RED_RATIO",
  "LIGHTNING_DOUBLE",
  "PERFECT_ALTERNATION",
  "DOZEN_HIT",
  "COLUMN_HIT",
  "JACKPOT_IN_WINDOW"
]
const SIDE_BET_COLOR_BY_INDEX: string[] = ["RED", "BLACK"]
const SIDE_BET_STATUS_BY_INDEX: string[] = ["ACTIVE", "WON", "LOST", "EXPIRED", "CANCELLED"]

function betTypeName(index: i32): string {
  if (index < 0 || index >= SIDE_BET_TYPE_BY_INDEX.length) return "COLOR_COUNT"
  return SIDE_BET_TYPE_BY_INDEX[index]
}

function colorName(index: i32): string {
  if (index < 0 || index >= SIDE_BET_COLOR_BY_INDEX.length) return "RED"
  return SIDE_BET_COLOR_BY_INDEX[index]
}

function statusName(index: i32): string {
  if (index < 0 || index >= SIDE_BET_STATUS_BY_INDEX.length) return "ACTIVE"
  return SIDE_BET_STATUS_BY_INDEX[index]
}

/**
 * Load or create a SideBetConfig with the given market as a baseline, then refresh
 * its rich fields (colour, targets, window, multiplier) from the contract. Config
 * events only carry configId (and ConfigAdded also marketId + betType), so the rest
 * is read via getConfig — a cheap call since config events are admin-only and rare.
 */
function upsertConfig(
  contractAddress: Address,
  configId: BigInt,
  marketIdHint: i32,
  timestamp: BigInt
): SideBetConfig {
  const id = bigintToBytes(configId)
  let config = SideBetConfig.load(id)
  if (config == null) {
    const marketId = marketIdHint >= 0 ? marketIdHint : 0
    config = new SideBetConfig(id)
    config.configId = configId
    config.marketId = marketId
    config.market = requireMarket(marketId).id
    config.betType = "COLOR_COUNT"
    config.windowSpins = 0
    config.multiplierBps = 0
    config.minStake = ZERO
    config.maxStake = ZERO
    config.active = true
    config.createdAt = timestamp
  }
  hydrateConfigFromChain(config, contractAddress, configId)
  config.updatedAt = timestamp
  return config
}

function hydrateConfigFromChain(config: SideBetConfig, contractAddress: Address, configId: BigInt): void {
  const bound = SideBetContract.bind(contractAddress)
  const result = bound.try_getConfig(configId)
  if (result.reverted) {
    log.warning("SideBet getConfig reverted for config {}", [configId.toString()])
    return
  }
  const onchain = result.value
  const marketId = onchain.marketId.toI32()
  config.market = requireMarket(marketId).id
  config.marketId = marketId
  config.betType = betTypeName(onchain.betType)
  config.color = colorName(onchain.color)
  config.targetNumber = onchain.targetNumber
  config.targetCount = onchain.targetCount
  config.redRatioBps = onchain.redRatioBps
  config.windowSpins = onchain.windowSpins
  config.multiplierBps = onchain.multiplierBps.toI32()
  config.minStake = onchain.minStake
  config.maxStake = onchain.maxStake
}

export function handleConfigAdded(event: ConfigAdded): void {
  const marketId = event.params.marketId.toI32()
  const config = upsertConfig(event.address, event.params.configId, marketId, event.block.timestamp)
  // Authoritative values from the event, in case getConfig was not yet readable.
  config.marketId = marketId
  config.market = requireMarket(marketId).id
  config.betType = betTypeName(event.params.betType)
  config.active = true
  config.save()
}

export function handleConfigUpdated(event: ConfigUpdated): void {
  const config = upsertConfig(event.address, event.params.configId, -1, event.block.timestamp)
  config.save()
}

export function handleConfigRemoved(event: ConfigRemoved): void {
  const config = SideBetConfig.load(bigintToBytes(event.params.configId))
  if (config == null) {
    return
  }
  config.active = false
  config.updatedAt = event.block.timestamp
  config.save()
}

export function handleConfigStakeLimitsUpdated(event: ConfigStakeLimitsUpdated): void {
  const config = upsertConfig(event.address, event.params.configId, -1, event.block.timestamp)
  config.minStake = event.params.minStake
  config.maxStake = event.params.maxStake
  config.save()
}

export function handleSideBetPlaced(event: SideBetPlaced): void {
  const user = getOrCreateUser(event.params.player)
  const marketId = event.params.marketId.toI32()
  const market = requireMarket(marketId)

  // The config is created by ConfigAdded before any bet can reference it; load it
  // directly to avoid a getConfig read on the hot bet path. Fall back to an upsert
  // only in the (unexpected) case it is missing.
  let config = SideBetConfig.load(bigintToBytes(event.params.configId))
  if (config == null) {
    config = upsertConfig(event.address, event.params.configId, marketId, event.block.timestamp)
    config.save()
  }

  const bet = new SideBet(bigintToBytes(event.params.betId))
  bet.betId = event.params.betId
  bet.config = config.id
  bet.player = user.id
  bet.market = market.id
  bet.bank = market.bank
  bet.betType = config.betType
  bet.color = config.color
  bet.targetNumber = config.targetNumber
  bet.targetCount = config.targetCount
  bet.redRatioBps = config.redRatioBps
  bet.windowSpins = event.params.windowSpins
  bet.spinsResolved = 0
  bet.multiplierBps = config.multiplierBps
  bet.startGlobalRound = event.params.startGlobalRound
  bet.stake = event.params.stake
  bet.potentialPayout = event.params.payout
  bet.actualPayout = ZERO
  bet.status = "ACTIVE"
  bet.placedAt = event.block.timestamp
  bet.spinsObserved = []
  bet.save()
}

export function handleSideBetSettled(event: SideBetSettled): void {
  const bet = SideBet.load(bigintToBytes(event.params.betId))
  if (bet == null) {
    log.warning("SideBetSettled: bet {} not found", [event.params.betId.toString()])
    return
  }
  const outcome = statusName(event.params.outcome)
  bet.status = outcome
  bet.actualPayout = event.params.payout
  bet.resolvedAt = event.block.timestamp
  bet.spinsResolved = bet.windowSpins
  bet.save()

  const settlementId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const settlement = new SideBetSettlement(settlementId)
  settlement.sideBet = bet.id
  settlement.outcome = outcome
  settlement.payout = event.params.payout
  settlement.settledAt = event.block.timestamp
  settlement.blockNumber = event.block.number
  settlement.transactionHash = event.transaction.hash
  settlement.save()
}

// Side-bet revenue routing — observational only. No dedicated entity yet; logged so
// the events are not silently dropped and can be promoted to aggregates later.
export function handleSideBetJackpotFunded(event: SideBetJackpotFunded): void {
  log.info("SideBetJackpotFunded market {} amount {}", [
    event.params.marketId.toString(),
    event.params.amount.toString()
  ])
}

export function handleSideBetInfrastructureFeePaid(event: SideBetInfrastructureFeePaid): void {
  log.info("SideBetInfrastructureFeePaid market {} amount {}", [
    event.params.marketId.toString(),
    event.params.amount.toString()
  ])
}
