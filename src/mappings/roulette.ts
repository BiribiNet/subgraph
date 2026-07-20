import {
  BetRecorded,
  VrfRequested,
  RoundResolved,
  VRFResult,
  RoundCountdownStarted,
  PayoutProgress,
  Initialized,
  Upgraded,
  MarketRegistered,
  JackpotFunded,
  InfrastructureFeePaid,
  ReferralSet,
  WithdrawalQueueBatchSizeUpdated,
  MaxWithdrawalQueueLengthUpdated,
  RoundDurationUpdated,
  JackpotFunderUpdated,
  JackpotTreasuryUpdated,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
} from "../../generated/RouletteEngine/Game"
import { log } from "@graphprotocol/graph-ts"
import {
  grantRoleHolder,
  revokeRoleHolder,
  updateRoleAdmin,
  ROLE_CONTRACT_ROULETTE_ENGINE,
} from "../helpers/access-control"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { processReferralSet } from "../helpers/referral-engine"
import {
  processBetRecorded,
  processRoundCountdownStarted,
  processVrfRequested,
  processVRFResult,
  processRoundResolved,
  processPayoutProgress,
  processJackpotFunded,
  processInfrastructureFeePaid,
  processMarketRegistered,
  processGameUpgraded
} from "../helpers/multiMarketRoulette"

export function handleBetRecorded(event: BetRecorded): void {
  processBetRecorded(event)
}

export function handleRoundCountdownStarted(event: RoundCountdownStarted): void {
  processRoundCountdownStarted(event)
}

export function handleVrfRequested(event: VrfRequested): void {
  processVrfRequested(event)
}

export function handleVRFResult(event: VRFResult): void {
  processVRFResult(event)
}

export function handleRoundResolved(event: RoundResolved): void {
  processRoundResolved(event)
}

export function handlePayoutProgress(event: PayoutProgress): void {
  processPayoutProgress(event)
}

export function handleJackpotFunded(event: JackpotFunded): void {
  processJackpotFunded(event)
}

export function handleInfrastructureFeePaid(event: InfrastructureFeePaid): void {
  processInfrastructureFeePaid(event)
}

export function handleMarketRegistered(event: MarketRegistered): void {
  processMarketRegistered(event)
}

export function handleGameInitialized(event: Initialized): void {
  log.info("Game contract initialized with version {}", [event.params.version.toString()])
}

export function handleGameUpgraded(event: Upgraded): void {
  processGameUpgraded(event)
}

// Engine config setters — keep the GlobalState singleton in sync with on-chain
// withdrawal-queue / round-duration / fee-routing configuration.
export function handleWithdrawalQueueBatchSizeUpdated(event: WithdrawalQueueBatchSizeUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.largeWithdrawalBatchSize = event.params.newBatchSize
  globalState.save()
}

export function handleMaxWithdrawalQueueLengthUpdated(event: MaxWithdrawalQueueLengthUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.maxQueueLength = event.params.newMaxLength
  globalState.save()
}

export function handleRoundDurationUpdated(event: RoundDurationUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.roundDuration = event.params.newRoundDuration
  globalState.save()
}

export function handleJackpotFunderUpdated(event: JackpotFunderUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.jackpotFunder = event.params.newFunder
  globalState.save()
}

export function handleJackpotTreasuryUpdated(event: JackpotTreasuryUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.jackpotTreasury = event.params.newTreasury
  globalState.save()
}

export function handleReferralSet(event: ReferralSet): void {
  processReferralSet(
    event.params.player,
    event.params.referrer,
    event.transaction.hash,
    event.block.timestamp
  )
}

export function handleRoleGranted(event: RoleGranted): void {
  grantRoleHolder(
    event.address,
    ROLE_CONTRACT_ROULETTE_ENGINE,
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
    ROLE_CONTRACT_ROULETTE_ENGINE,
    event.params.role,
    event.params.newAdminRole
  )
}
