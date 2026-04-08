import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  VrfRequested,
  RoundResolved,
  RoundForceResolved,
  VRFResult,
  BatchProcessed,
  JackpotResultEvent,
  ComputedPayouts,
  MinJackpotConditionUpdated,
  JackpotPayoutFailed,
  PayoutBatchFailed,
  RoleGranted,
  RoleRevoked,
  RoleAdminChanged,
  Initialized,
  Upgraded
} from "../../generated/RouletteClean/Game"
import {
  RouletteRound,
  AdminRoleChange,
  ContractUpgrade,
  PayoutFailure
} from "../../generated/schema"
import { ROUND_STATUS_VRF, ROUND_STATUS_PAYOUT, ROUND_STATUS_CLEAN, ROUND_STATUS_COMPUTING_PAYOUT } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"

export function handleJackpotResultEvent(event: JackpotResultEvent): void {
  const round = RouletteRound.load(bigintToBytes(event.params.roundId))
  if (!round) {
    log.error("Round not found for jackpot result event: {}", [event.params.roundId.toString()])
    return
  }
  round.jackpotWinnerCount = event.params.jackpotWinnerCount

  round.save()
}

export function handleComputedPayouts(event: ComputedPayouts): void {
  const round = RouletteRound.load(bigintToBytes(event.params.roundId))
  if (!round) {
    log.error("Round not found for computed payouts: {}", [event.params.roundId.toString()])
    return
  }
  round.status = ROUND_STATUS_COMPUTING_PAYOUT;
  round.computedPayoutsCount = event.params.totalWinningBets;
  round.save()
}

export function handleMinJackpotConditionUpdated(event: MinJackpotConditionUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.minJackpotCondition = event.params.newMinJackpotCondition
  globalState.save()
}

/** VRF requested for the round that just ended. The contract emits the
 *  **resolving** round as the first parameter (named `newRoundId` in the ABI
 *  due to a naming mismatch — it is actually the round being resolved, not the
 *  next round). We apply VRF metadata directly to that round and advance
 *  `globalState.currentRoundNumber` to `resolvingRoundId + 1` so that the
 *  payout detection logic in `brb.ts` (which uses `currentRoundNumber - 1`)
 *  can find the resolving round. `handleRoundCleaningCompleted` will set the
 *  authoritative value once cleaning finishes. */
export function handleVrfRequested(event: VrfRequested): void {
  const globalState = getOrCreateGlobalState()
  // Contract emits the resolving round as "newRoundId" (naming mismatch)
  const resolvingRoundId = event.params.newRoundId
  const nextRoundId = resolvingRoundId.plus(BigInt.fromI32(1))
  globalState.currentRound = bigintToBytes(nextRoundId)
  globalState.currentRoundNumber = nextRoundId
  globalState.roundTransitionInProgress = true
  globalState.save()

  // Apply VRF metadata to the actual resolving round (not N-1)
  const round = RouletteRound.load(bigintToBytes(resolvingRoundId))
  if (round) {
    round.status = ROUND_STATUS_VRF
    round.requestId = event.params.requestId
    round.vrfTxHash = event.transaction.hash
    round.endedAt = event.block.timestamp
    round.save()
  }
}

export function handleVRFResult(event: VRFResult): void {
  const roundId = event.params.roundId
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (!round) {
    log.error("Round not found for VRF result: {}", [roundId.toString()])
    return
  }

  // Update round with VRF result data only — do NOT advance status here.
  // Status stays VRF until ComputedPayouts (normal case) or RoundResolved (no winners).
  // This prevents the backwards status transition: PAYOUT → COMPUTING_PAYOUT
  // that occurred because VRFResult and ComputedPayouts are emitted in the same tx
  // with VRFResult first (log order).
  round.jackpotNumber = event.params.jackpotNumber;
  round.winningNumber = event.params.winningNumber
  round.vrfResultAt = event.block.timestamp
  round.save()

  // Note: Bet winning/losing is now determined by actual payout transfers
  // in the Transfer event handler in stakedBRB.ts
}

export function handleRoundResolved(event: RoundResolved): void {
  const roundId = event.params.roundId
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (!round) {
    log.error("Round not found for resolution: {}", [roundId.toString()])
    return
  }

  const globalState = getOrCreateGlobalState()

  if (round.totalBets.gt(globalState.pendingBets)) {
    log.warning("Round {} totalBets ({}) exceeds pendingBets ({})", [
      roundId.toString(),
      round.totalBets.toString(),
      globalState.pendingBets.toString()
    ])
    globalState.pendingBets = BigInt.fromI32(0)
  } else {
    globalState.pendingBets = globalState.pendingBets.minus(round.totalBets)
  }
  globalState.lastRoundPaid = event.params.roundId
  globalState.save();

  round.status = ROUND_STATUS_CLEAN
  round.resolvedAt = event.block.timestamp
  round.save()
}

export function handleRoundForceResolved(event: RoundForceResolved): void {
  const roundId = event.params.roundId
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (!round) {
    log.error("Round not found for force resolution: {}", [roundId.toString()])
    return
  }

  round.status = ROUND_STATUS_CLEAN
  round.winningNumber = BigInt.fromI32(37) // void marker — no valid bet can match
  round.resolvedAt = event.block.timestamp
  round.forceResolved = true
  round.save()
}

export function handleBatchProcessed(event: BatchProcessed): void {
  const roundId = event.params.roundId
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (!round) {
    log.error("Round not found for batch processing: {}", [roundId.toString()])
    return
  }

  // Update round payout totals
  round.currentPayoutsCount = round.currentPayoutsCount.plus(event.params.payoutsCount)

  // Set payoutCompletedAt when all expected payouts have been processed
  if (round.computedPayoutsCount !== null) {
    const computed = round.computedPayoutsCount as BigInt
    if (round.currentPayoutsCount.ge(computed)) {
      round.payoutCompletedAt = event.block.timestamp
    }
  }

  round.save()
}

export function handleGameRoleGranted(event: RoleGranted): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new AdminRoleChange(id)
  entity.contract = "Game"
  entity.eventType = "GRANTED"
  entity.role = event.params.role
  entity.account = event.params.account
  entity.sender = event.params.sender
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleGameRoleRevoked(event: RoleRevoked): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new AdminRoleChange(id)
  entity.contract = "Game"
  entity.eventType = "REVOKED"
  entity.role = event.params.role
  entity.account = event.params.account
  entity.sender = event.params.sender
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleGameRoleAdminChanged(event: RoleAdminChanged): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new AdminRoleChange(id)
  entity.contract = "Game"
  entity.eventType = "ADMIN_CHANGED"
  entity.role = event.params.role
  entity.previousAdminRole = event.params.previousAdminRole
  entity.newAdminRole = event.params.newAdminRole
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleGameInitialized(event: Initialized): void {
  log.info("Game contract initialized with version {}", [event.params.version.toString()])
}

export function handleGameUpgraded(event: Upgraded): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new ContractUpgrade(id)
  entity.contract = "Game"
  entity.implementation = event.params.implementation
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleJackpotPayoutFailed(event: JackpotPayoutFailed): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const failure = new PayoutFailure(id)
  failure.round = bigintToBytes(event.params.roundId)
  failure.batchIndex = event.params.batchIndex
  failure.failureType = "JACKPOT"
  failure.reason = event.params.reason
  failure.timestamp = event.block.timestamp
  failure.blockNumber = event.block.number
  failure.transactionHash = event.transaction.hash
  failure.save()

  const round = RouletteRound.load(bigintToBytes(event.params.roundId))
  if (round) {
    round.failedJackpotBatches = round.failedJackpotBatches.plus(BigInt.fromI32(1))
    round.save()
  }
}

export function handlePayoutBatchFailed(event: PayoutBatchFailed): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const failure = new PayoutFailure(id)
  failure.round = bigintToBytes(event.params.roundId)
  failure.batchIndex = event.params.batchIndex
  failure.failureType = "REGULAR"
  failure.reason = event.params.reason
  failure.timestamp = event.block.timestamp
  failure.blockNumber = event.block.number
  failure.transactionHash = event.transaction.hash
  failure.save()

  const round = RouletteRound.load(bigintToBytes(event.params.roundId))
  if (round) {
    round.failedPayoutBatches = round.failedPayoutBatches.plus(BigInt.fromI32(1))
    round.save()
  }
}
