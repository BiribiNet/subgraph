import { Address, BigInt, log } from "@graphprotocol/graph-ts"
import {
  ConfigAdded,
  ConfigRemoved,
  ConfigStakeLimitsUpdated,
  ConfigUpdated,
  SideBet as SideBetContract,
  SideBetPlaced,
  SideBetSettled,
  SideBetJackpotFunded,
  SideBetInfrastructureFeePaid,
  MultiplierBandUpdated,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
} from "../../generated/SideBet/SideBet"
import { SideBet, SideBetSettlement, Market } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"
import {
  createSideBetFromChain,
  getOrCreateSideBetGlobalConfig,
  sideBetIdFromBetId,
  sideBetStatusFromI32,
  syncSideBetConfig
} from "../helpers/side-bet"
import { updateUserLastActive } from "../helpers/user"
import {
  recordUserMarketSideBetStake,
  recordUserMarketSideBetWin,
} from "../helpers/user-market-stats"
import { registerSideBetForRoundWatch } from "../helpers/side-bet-vrf"
import { getMarketById } from "../helpers/market"
import {
  ROLE_CONTRACT_SIDE_BET,
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
} from "../helpers/access-control"

function bindSideBet(contractAddress: Address): SideBetContract {
  return SideBetContract.bind(contractAddress)
}

export function handleConfigAdded(event: ConfigAdded): void {
  syncSideBetConfig(SideBetContract.bind(event.address), event.params.configId, event.block.timestamp)
}

export function handleConfigUpdated(event: ConfigUpdated): void {
  syncSideBetConfig(SideBetContract.bind(event.address), event.params.configId, event.block.timestamp)
}

export function handleConfigStakeLimitsUpdated(event: ConfigStakeLimitsUpdated): void {
  syncSideBetConfig(SideBetContract.bind(event.address), event.params.configId, event.block.timestamp)
}

export function handleConfigRemoved(event: ConfigRemoved): void {
  syncSideBetConfig(SideBetContract.bind(event.address), event.params.configId, event.block.timestamp)
}

export function handleSideBetPlaced(event: SideBetPlaced): void {
  const contract = bindSideBet(event.address)
  const bet = createSideBetFromChain(
    contract,
    event.params.betId,
    event.params.configId,
    event.block.timestamp
  )
  if (bet == null) {
    log.warning("SideBetPlaced: failed to index bet {}", [event.params.betId.toString()])
    return
  }
  registerSideBetForRoundWatch(bet.id, bet.startGlobalRound, bet.windowSpins)
  syncSideBetConfig(contract, event.params.configId, event.block.timestamp)
}

export function handleSideBetSettled(event: SideBetSettled): void {
  const betId = sideBetIdFromBetId(event.params.betId)
  let bet = SideBet.load(betId)
  if (bet == null) {
    const contract = SideBetContract.bind(event.address)
    bet = createSideBetFromChain(contract, event.params.betId, BigInt.zero(), event.block.timestamp)
    if (bet == null) {
      log.warning("SideBetSettled: bet {} not found", [event.params.betId.toString()])
      return
    }
  }

  bet.status = sideBetStatusFromI32(event.params.outcome)
  bet.actualPayout = event.params.payout
  bet.resolvedAt = event.block.timestamp
  bet.spinsResolved = bet.windowSpins
  bet.save()

  updateUserLastActive(event.params.player, event.block.timestamp)

  const settlementId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const settlement = new SideBetSettlement(settlementId)
  settlement.sideBet = bet.id
  settlement.outcome = sideBetStatusFromI32(event.params.outcome)
  settlement.payout = event.params.payout
  settlement.settledAt = event.block.timestamp
  settlement.blockNumber = event.block.number
  settlement.transactionHash = event.transaction.hash
  settlement.save()

  const market = Market.load(bet.market)
  if (market != null) {
    recordUserMarketSideBetWin(event.params.player, market, event.params.payout, event.block.timestamp)
  }
}

function accrueSideBetFee(marketId: i32, jackpot: boolean, amount: BigInt): void {
  const market = getMarketById(marketId)
  if (market == null) {
    return
  }
  if (jackpot) {
    market.sideBetJackpotFees = market.sideBetJackpotFees.plus(amount)
  } else {
    market.sideBetInfraFees = market.sideBetInfraFees.plus(amount)
  }
  market.save()
}

export function handleSideBetJackpotFunded(event: SideBetJackpotFunded): void {
  accrueSideBetFee(event.params.marketId.toI32(), true, event.params.amount)
}

export function handleSideBetInfrastructureFeePaid(event: SideBetInfrastructureFeePaid): void {
  accrueSideBetFee(event.params.marketId.toI32(), false, event.params.amount)
}

export function handleMultiplierBandUpdated(event: MultiplierBandUpdated): void {
  const cfg = getOrCreateSideBetGlobalConfig(event.block.timestamp)
  cfg.minMultiplierBps = event.params.minMultiplierBps.toI32()
  cfg.maxMultiplierBps = event.params.maxMultiplierBps.toI32()
  cfg.lastUpdatedAt = event.block.timestamp
  cfg.save()
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_SIDE_BET,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleRevoked(event: RoleRevoked): void {
  revokeRoleHolder(
    event.address,
    event.params.role,
    event.params.account,
    event.params.sender,
    event.block.timestamp
  )
}

export function handleRoleAdminChanged(event: RoleAdminChanged): void {
  updateRoleAdmin(
    event.address,
    ROLE_CONTRACT_SIDE_BET,
    event.params.role,
    event.params.newAdminRole
  )
}
