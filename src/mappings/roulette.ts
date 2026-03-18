import { BigInt, log } from "@graphprotocol/graph-ts"
import {
  RoundStarted,
  RoundResolved,
  VRFResult,
  BatchProcessed,
  JackpotResultEvent,
  ChainlinkSetupCompleted,
  ComputedPayouts
} from "../../generated/RouletteClean/Game"
import {
  RouletteRound
} from "../../generated/schema"
import { ROUND_STATUS_VRF, ROUND_STATUS_PAYOUT, ROUND_STATUS_CLEAN, ROUND_STATUS_BETTING, ROUND_STATUS_COMPUTING_PAYOUT } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"

function zerosArray(length: i32): Array<BigInt> {
  const arr = new Array<BigInt>(length);
  for (let i = 0; i < length; i++) {
    arr[i] = BigInt.fromI32(0);
  }
  return arr;
}

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

export function handleRoundStarted(event: RoundStarted): void {
  const globalState = getOrCreateGlobalState()

  const roundId = bigintToBytes(event.params.roundId);
  const round = new RouletteRound(roundId);
  round.roundNumber = event.params.roundId;
  round.status = ROUND_STATUS_BETTING;
  round.totalBets = BigInt.fromI32(0)
  round.maxBetAmount = BigInt.fromI32(0)
  round.maxStraightBet = BigInt.fromI32(0)
  round.maxStreetBet = BigInt.fromI32(0)
  round.straightBetsTotals = zerosArray(37) // index = roulette number (0..36)
  round.streetBetsTotals = zerosArray(37) // index = street start number (1..34, step 3)
  round.redBetsSum = BigInt.fromI32(0)
  round.blackBetsSum = BigInt.fromI32(0)
  round.oddBetsSum = BigInt.fromI32(0)
  round.evenBetsSum = BigInt.fromI32(0)
  round.lowBetsSum = BigInt.fromI32(0)
  round.highBetsSum = BigInt.fromI32(0)
  round.dozenBetsSum = zerosArray(4) // index = dozen id (1..3)
  round.columnBetsSum = zerosArray(4) // index = column id (1..3)
  round.otherBetsPayout = BigInt.fromI32(0)
  round.currentPayoutsCount = BigInt.fromI32(0);
  round.totalPayouts = BigInt.fromI32(0);
  round.startedAt = event.params.timestamp;

  round.save();

  // Update current round
  globalState.currentRound = roundId;
  globalState.currentRoundNumber = event.params.roundId
  globalState.lastRoundStartTime = event.params.timestamp
  globalState.roundTransitionInProgress = true
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

export function handleChainlinkSetupCompleted(event: ChainlinkSetupCompleted): void {
  const round = new RouletteRound(bigintToBytes(BigInt.fromI32(1)));
  round.roundNumber = BigInt.fromI32(1);
  round.status = ROUND_STATUS_BETTING;
  round.totalBets = BigInt.fromI32(0)
  round.maxBetAmount = BigInt.fromI32(0)
  round.maxStraightBet = BigInt.fromI32(0)
  round.maxStreetBet = BigInt.fromI32(0)
  round.straightBetsTotals = zerosArray(37)
  round.streetBetsTotals = zerosArray(37)
  round.redBetsSum = BigInt.fromI32(0)
  round.blackBetsSum = BigInt.fromI32(0)
  round.oddBetsSum = BigInt.fromI32(0)
  round.evenBetsSum = BigInt.fromI32(0)
  round.lowBetsSum = BigInt.fromI32(0)
  round.highBetsSum = BigInt.fromI32(0)
  round.dozenBetsSum = zerosArray(4)
  round.columnBetsSum = zerosArray(4)
  round.otherBetsPayout = BigInt.fromI32(0)
  round.currentPayoutsCount = BigInt.fromI32(0);
  round.totalPayouts = BigInt.fromI32(0);
  round.startedAt = event.block.timestamp;

  round.save();

  const globalState = getOrCreateGlobalState()
  globalState.chainlinkKeeperRegistry = event.params.keeperRegistry
  globalState.chainlinkKeeperRegistrar = event.params.keeperRegistrar
  globalState.subscriptionId = event.params.subscriptionId
  globalState.save()
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

  const globalState = getOrCreateGlobalState()
  
  globalState.lastRoundPaid = event.params.roundId
  globalState.pendingBets = globalState.pendingBets.minus(round.totalBets)
  globalState.save();

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
  round.currentPayoutsCount = round.currentPayoutsCount.plus(event.params.payoutsCount)
  round.save()
}


