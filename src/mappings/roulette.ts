import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  BetRecorded,
  VrfRequested,
  RoundResolved,
  VRFResult,
  GlobalRoundSealed,
  PayoutProgress,
  MinJackpotConditionUpdated,
  Initialized,
  Upgraded
} from "../../generated/RouletteClean/Game"
import {
  RouletteRound,
  ContractUpgrade
} from "../../generated/schema"
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_NO_MORE_BETS,
  ROUND_STATUS_VRF,
  ROUND_STATUS_PAYOUT,
  ROUND_STATUS_CLEAN
} from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { createNewRouletteRound } from "../helpers/rouletteRound"
import { calculateMaxPayoutFromRoundComponents, recordRouletteBetEntry } from "../helpers/betting"
import { getOrCreateDailyStats, trackDailyUniquePlayer } from "../helpers/aggregation"
import { updateUserLastActive } from "../helpers/user"

export function handleBetRecorded(event: BetRecorded): void {
  const roundId = event.params.localRound
  const roundKey = bigintToBytes(roundId)
  let round = RouletteRound.load(roundKey)
  const globalState = getOrCreateGlobalState()

  if (round == null) {
    round = createNewRouletteRound(roundId, event.block.timestamp)
    globalState.totalRounds = globalState.totalRounds.plus(BigInt.fromI32(1))
  }

  if (round.status == ROUND_STATUS_BETTING) {
    const betType = BigInt.fromI32(i32(event.params.betType))
    const number = BigInt.fromI32(i32(event.params.number))
    recordRouletteBetEntry(
      event.params.player,
      event.params.amount,
      betType,
      number,
      round,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash
    )

    round.betCount = round.betCount.plus(BigInt.fromI32(1))
    round.maxBetAmount = calculateMaxPayoutFromRoundComponents(round)
    round.save()

    globalState.pendingBets = globalState.pendingBets.plus(event.params.amount)
    globalState.currentRound = roundKey
    globalState.currentRoundNumber = roundId

    const daily = getOrCreateDailyStats(event.block.timestamp)
    daily.betCount = daily.betCount.plus(BigInt.fromI32(1))
    daily.volume = daily.volume.plus(event.params.amount)
    daily.save()

    trackDailyUniquePlayer(event.block.timestamp, event.params.player.toHexString())
    updateUserLastActive(event.params.player, event.block.timestamp)
    globalState.save()
  }
}

export function handleGlobalRoundSealed(event: GlobalRoundSealed): void {
  const round = RouletteRound.load(bigintToBytes(event.params.globalRoundId))
  if (round == null) {
    log.error("Round not found for GlobalRoundSealed: {}", [event.params.globalRoundId.toString()])
    return
  }
  round.status = ROUND_STATUS_NO_MORE_BETS
  round.save()
}

export function handleVrfRequested(event: VrfRequested): void {
  const globalState = getOrCreateGlobalState()
  const resolvingRoundId = event.params.newRoundId
  const nextRoundId = resolvingRoundId.plus(BigInt.fromI32(1))
  globalState.currentRound = bigintToBytes(nextRoundId)
  globalState.currentRoundNumber = nextRoundId
  globalState.roundTransitionInProgress = true
  globalState.save()

  const round = RouletteRound.load(bigintToBytes(resolvingRoundId))
  if (round != null) {
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
  if (round == null) {
    log.error("Round not found for VRF result: {}", [roundId.toString()])
    return
  }

  round.jackpotNumber = BigInt.fromI32(i32(event.params.jackpotNumber))
  round.winningNumber = BigInt.fromI32(i32(event.params.winningNumber))
  round.vrfResultAt = event.block.timestamp
  round.save()
}

export function handleRoundResolved(event: RoundResolved): void {
  const roundId = event.params.roundId
  const round = RouletteRound.load(bigintToBytes(roundId))
  if (round == null) {
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
  globalState.lastRoundPaid = roundId
  globalState.roundTransitionInProgress = false
  globalState.save()

  round.status = ROUND_STATUS_CLEAN
  round.resolvedAt = event.block.timestamp
  round.save()
}

export function handlePayoutProgress(event: PayoutProgress): void {
  const round = RouletteRound.load(bigintToBytes(event.params.globalRoundId))
  if (round == null) {
    return
  }
  if (round.status != ROUND_STATUS_PAYOUT) {
    round.status = ROUND_STATUS_PAYOUT
  }
  round.totalPayouts = round.totalPayouts.plus(event.params.paidAmount)
  round.save()
}

export function handleMinJackpotConditionUpdated(event: MinJackpotConditionUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.minJackpotCondition = event.params.newMinJackpotCondition
  globalState.save()
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
