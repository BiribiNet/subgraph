import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  RoundStarted,
  RoundResolved,
  VRFResult,
  BatchProcessed
} from "../../generated/RouletteClean/Game"
import {
  GlobalState,
  RouletteRound
} from "../../generated/schema"
import { ROUND_STATUS_VRF, ROUND_STATUS_PAYOUT, ROUND_STATUS_CLEAN } from "../helpers/constant"


const GLOBAL_STATE_ID = Bytes.fromHexString("0x0000000000000000000000000000000000000001") // Singleton ID for global state

function getOrCreateGlobalState(): GlobalState {
  let globalState = GlobalState.load(GLOBAL_STATE_ID)
  if (!globalState) {
    globalState = new GlobalState(GLOBAL_STATE_ID)
    globalState.currentRound = BigInt.fromI32(1)
    globalState.lastRoundStartTime = BigInt.fromI32(0)
    globalState.lastRoundPaid = BigInt.fromI32(0)
    globalState.gamePeriod = BigInt.fromI32(60) // Default 60 seconds
    globalState.totalBets = BigInt.fromI32(0)
    globalState.totalPayouts = BigInt.fromI32(0)
    globalState.protocolFeeBasisPoints = BigInt.fromI32(250) // Default 2.5%
    globalState.feeRecipient = Bytes.fromHexString("0x0000000000000000000000000000000000000000")
    globalState.totalAssets = BigInt.fromI32(0)
    globalState.totalShares = BigInt.fromI32(0)
    globalState.pendingBets = BigInt.fromI32(0)
    globalState.lastRoundResolved = BigInt.fromI32(0)
    globalState.roundTransitionInProgress = false
    globalState.largeWithdrawalBatchSize = BigInt.fromI32(5)
    globalState.maxQueueLength = BigInt.fromI32(100)
    globalState.totalPendingLargeWithdrawals = BigInt.fromI32(0)
  }
  return globalState
}



export function handleRoundStarted(event: RoundStarted): void {
  const globalState = getOrCreateGlobalState()

  // Update current round
  globalState.currentRound = event.params.roundId
  globalState.lastRoundStartTime = event.params.timestamp
  globalState.save()

  // Update previous round status to VRF
  const previousRoundId = event.params.roundId.minus(BigInt.fromI32(1))
  const previousRound = RouletteRound.load(Bytes.fromHexString(previousRoundId.toHexString()))
  if (previousRound) {
    previousRound.status = ROUND_STATUS_VRF
    previousRound.requestId = event.params.requestId
    previousRound.vrfTxHash = event.transaction.hash
    previousRound.endedAt = event.block.timestamp
    previousRound.save()
  }
}

export function handleVRFResult(event: VRFResult): void {
  const roundId = event.params.roundId.toHexString()
  const round = RouletteRound.load(Bytes.fromHexString(roundId))
  if (!round) {
    log.error("Round not found for VRF result: {}", [roundId])
    return
  }

  // Update round with VRF result
  round.winningNumber = event.params.winningNumber
  round.vrfResultAt = event.block.timestamp
  round.status = ROUND_STATUS_PAYOUT
  round.save()

  // Note: Bet winning/losing is now determined by actual payout transfers
  // in the Transfer event handler in stakedBRB.ts
}

export function handleRoundResolved(event: RoundResolved): void {
  const roundId = event.params.roundId.toHexString()
  const round = RouletteRound.load(Bytes.fromHexString(roundId))
  if (!round) {
    log.error("Round not found for resolution: {}", [roundId])
    return
  }

  round.status = ROUND_STATUS_CLEAN
  round.cleaningCompletedAt = event.block.timestamp
  round.save()
}

export function handleBatchProcessed(event: BatchProcessed): void {
  const roundId = event.params.roundId.toHexString()
  const round = RouletteRound.load(Bytes.fromHexString(roundId))
  if (!round) {
    log.error("Round not found for batch processing: {}", [roundId])
    return
  }

  // Update round payout totals
  round.totalPayouts = round.totalPayouts.plus(event.params.payoutsCount)
  round.save()

  // Update global totals
  const globalState = getOrCreateGlobalState()
  globalState.totalPayouts = globalState.totalPayouts.plus(event.params.payoutsCount)
  globalState.save()
}


