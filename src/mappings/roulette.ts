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
  RoundLocked
} from "../../generated/RouletteEngine/Game"
import { log } from "@graphprotocol/graph-ts"
import {
  processBetRecorded,
  processRoundCountdownStarted,
  processRoundLocked,
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

export function handleRoundLocked(event: RoundLocked): void {
  processRoundLocked(event)
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
