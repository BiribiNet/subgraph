import { BigInt, log } from "@graphprotocol/graph-ts"
import {
  RoundStarted,
  RoundResolved,
  VRFResult,
  BatchProcessed,
  JackpotResultEvent
} from "../../generated/RouletteClean/Game"
import {
  RouletteRound
} from "../../generated/schema"
import { ROUND_STATUS_VRF, ROUND_STATUS_PAYOUT, ROUND_STATUS_CLEAN } from "../helpers/constant"
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

export function handleRoundStarted(event: RoundStarted): void {
  const globalState = getOrCreateGlobalState()

  // Update current round
  globalState.currentRound = event.params.roundId
  globalState.lastRoundStartTime = event.params.timestamp
  globalState.save()

  // Update previous round status to VRF
  const previousRoundId = event.params.roundId.minus(BigInt.fromI32(1))
  const previousRound = RouletteRound.load(bigintToBytes(previousRoundId))
  if (previousRound) {
    previousRound.status = ROUND_STATUS_VRF
    previousRound.requestId = event.params.requestId
    previousRound.vrfTxHash = event.transaction.hash
    previousRound.endedAt = event.block.timestamp
    previousRound.save()
  }
}

export function handleVRFResult(event: VRFResult): void {
  const roundId = event.params.roundId
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (!round) {
    log.error("Round not found for VRF result: {}", [roundId.toString()])
    return
  }

  // Update round with VRF result
  round.jackpotNumber = event.params.jackpotNumber;
  round.winningNumber = event.params.winningNumber
  round.vrfResultAt = event.block.timestamp
  round.status = ROUND_STATUS_PAYOUT
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

  round.status = ROUND_STATUS_CLEAN
  round.cleaningCompletedAt = event.block.timestamp
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
  round.totalPayouts = round.totalPayouts.plus(event.params.payoutsCount)
  round.save()

  // Update global totals
  const globalState = getOrCreateGlobalState()
  globalState.totalPayouts = globalState.totalPayouts.plus(event.params.payoutsCount)
  globalState.save()
}


