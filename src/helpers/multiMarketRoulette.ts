import { Address, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts"
import {
  BetRecorded,
  VrfRequested,
  RoundResolved,
  VRFResult,
  RoundCountdownStarted,
  PayoutProgress,
  MarketRegistered,
  JackpotFunded,
  InfrastructureFeePaid,
  RoundLocked,
  Upgraded
} from "../../generated/RouletteEngine/Game"
import { RouletteRound, ContractUpgrade, GlobalRound, RouletteBet, GlobalState } from "../../generated/schema"
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_NO_MORE_BETS,
  ROUND_STATUS_VRF,
  ROUND_STATUS_PAYOUT,
  ROUND_STATUS_CLEAN
} from "./constant"
import { bigintToBytes } from "./bigintToBytes"
import { getOrCreateGlobalState } from "./globalState"
import { createNewRouletteRound } from "./rouletteRound"
import {
  calculateMaxPayoutFromRoundComponents,
  recordRouletteBetFromPayload,
  updateRoundMaxPayoutComponents,
} from "./betting"
import { decodeBetDataPayload } from "./bet-data"
import { getOrCreateDailyStats, trackDailyUniquePlayer } from "./aggregation"
import {
  getOrCreateUser,
  updateUserLastActive,
  updateUserWageredStats,
  normalizeAmountTo18,
  updateUserBrbrEarnings,
} from "./user"
import { recordUserMarketWager } from "./user-market-stats"
import { getOrCreateGlobalRound, globalRoundIdBytes } from "./globalRound"
import { marketRoundId, requireMarket, getOrCreateMarket } from "./market"
import { ZERO } from "./number"
import { BankVault as BankVaultTemplate } from "../../generated/templates"
import { recordTxBetToBank } from "./tx-activity"
import {
  finalizeMarketRoundsOnResolve,
  lockAllParticipatingMarketRounds,
} from "./round-sync"
import { observeSideBetSpinsForRound } from "./side-bet-vrf"

function loadOrCreateMarketRound(
  globalRoundId: BigInt,
  marketId: i32,
  timestamp: BigInt
): RouletteRound {
  const market = requireMarket(marketId)
  const gr = getOrCreateGlobalRound(globalRoundId, timestamp)
  const roundKey = marketRoundId(globalRoundId, marketId)
  let round = RouletteRound.load(roundKey)
  if (round == null) {
    round = createNewRouletteRound(gr, market, timestamp)
    gr.participantMarketCount = gr.participantMarketCount.plus(BigInt.fromI32(1))
    gr.save()
    market.save()
  }
  return round
}

function trackProtocolBetStats(
  globalState: GlobalState,
  amount: BigInt,
  player: Bytes,
  timestamp: BigInt
): void {
  globalState.totalWagered = globalState.totalWagered.plus(amount)
  globalState.totalBets = globalState.totalBets.plus(BigInt.fromI32(1))

  const daily = getOrCreateDailyStats(timestamp)
  if (trackDailyUniquePlayer(timestamp, player.toHexString())) {
    daily.uniquePlayers = daily.uniquePlayers.plus(BigInt.fromI32(1))
    globalState.totalPlayers = globalState.totalPlayers.plus(BigInt.fromI32(1))
  }
}

export function processBetRecorded(event: BetRecorded): void {
  const globalRoundId = event.params.localRound
  const marketId = event.params.marketId.toI32()
  const globalState = getOrCreateGlobalState()
  const grKey = globalRoundIdBytes(globalRoundId)
  const gr = getOrCreateGlobalRound(globalRoundId, event.block.timestamp)
  const round = loadOrCreateMarketRound(globalRoundId, marketId, event.block.timestamp)

  if (round.firstBetAt.equals(ZERO)) {
    round.firstBetAt = event.block.timestamp
  }
  if (gr.firstBetAt.equals(ZERO)) {
    gr.firstBetAt = event.block.timestamp
  }

  if (round.status == ROUND_STATUS_BETTING) {
    const market = requireMarket(marketId)
    const payload = decodeBetDataPayload(event.params.betData)

    const existingUserBet = RouletteBet.load(event.params.player.concat(round.id))
    const isNewRoundForUser = existingUserBet == null

    recordRouletteBetFromPayload(
      event.params.player,
      payload,
      event.params.totalAmount,
      round,
      market,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash
    )

    const legCount = payload.types.length
    if (legCount == 0) {
      updateRoundMaxPayoutComponents(round, event.params.totalAmount, ZERO, ZERO)
    } else {
      for (let i = 0; i < legCount; i++) {
        updateRoundMaxPayoutComponents(
          round,
          payload.amounts[i],
          payload.types[i],
          payload.numbers[i]
        )
      }
    }

    const normalizedWager = normalizeAmountTo18(event.params.totalAmount, market.assetDecimals)
    updateUserWageredStats(
      event.params.player,
      event.params.totalAmount,
      market.assetDecimals,
      isNewRoundForUser,
      event.block.timestamp
    )
    recordUserMarketWager(
      event.params.player,
      market,
      event.params.totalAmount,
      isNewRoundForUser,
      event.block.timestamp
    )

    recordTxBetToBank(event.transaction.hash, event.params.totalAmount, marketId)

    const player = getOrCreateUser(event.params.player)
    const referrerId = player.referrer
    if (referrerId) {
      updateUserBrbrEarnings(
        changetype<Bytes>(referrerId),
        normalizedWager,
        true,
        event.block.timestamp
      )
    }

    round.betCount = round.betCount.plus(BigInt.fromI32(1))
    if (isNewRoundForUser) {
      round.uniqueBettors = round.uniqueBettors.plus(BigInt.fromI32(1))
    }
    round.maxBetAmount = calculateMaxPayoutFromRoundComponents(round)
    round.save()

    market.pendingBets = market.pendingBets.plus(event.params.totalAmount)
    market.maxBetAmount = round.maxBetAmount
    market.save()

    globalState.currentGlobalRound = gr.id
    globalState.currentRoundNumber = globalRoundId

    const daily = getOrCreateDailyStats(event.block.timestamp)
    daily.betCount = daily.betCount.plus(BigInt.fromI32(1))
    daily.volume = daily.volume.plus(normalizedWager)
    daily.save()

    trackProtocolBetStats(globalState, normalizedWager, event.params.player, event.block.timestamp)
    updateUserLastActive(event.params.player, event.block.timestamp)
    gr.save()
    globalState.save()
  }
}

export function processRoundCountdownStarted(event: RoundCountdownStarted): void {
  // Self-heal GlobalState.roundDuration: lockAt = block.timestamp + ROUND_DURATION
  // in the same tx, and the engine never emits RoundDurationUpdated for its
  // initialize() value — this is the only event-based source of the duration.
  // Runs before the GlobalRound guard: the duration is valid regardless.
  const lockAt = event.params.lockAt
  if (lockAt.gt(event.block.timestamp)) {
    const globalState = getOrCreateGlobalState()
    const duration = lockAt.minus(event.block.timestamp)
    if (globalState.roundDuration.notEqual(duration)) {
      globalState.roundDuration = duration
      globalState.save()
    }
  }

  const gr = GlobalRound.load(globalRoundIdBytes(event.params.roundId))
  if (gr == null) {
    log.error("GlobalRound not found for RoundCountdownStarted: {}", [event.params.roundId.toString()])
    return
  }
  const triggerMarketId = event.params.triggerMarketId.toI32()
  const trigger = requireMarket(triggerMarketId)
  gr.triggerMarket = trigger.id
  gr.lockAt = event.params.lockAt
  gr.save()
}

export function processRoundLocked(event: RoundLocked): void {
  const gr = getOrCreateGlobalRound(event.params.globalRoundId, event.block.timestamp)
  gr.status = ROUND_STATUS_NO_MORE_BETS
  gr.endedAt = event.block.timestamp
  gr.save()

  lockAllParticipatingMarketRounds(event.params.globalRoundId)
}

export function processVrfRequested(event: VrfRequested): void {
  const globalState = getOrCreateGlobalState()
  const resolvingRoundId = event.params.newRoundId
  globalState.currentGlobalRound = globalRoundIdBytes(resolvingRoundId)
  globalState.currentRoundNumber = resolvingRoundId
  globalState.roundTransitionInProgress = true
  globalState.save()

  const gr = GlobalRound.load(globalRoundIdBytes(resolvingRoundId))
  if (gr != null) {
    gr.status = ROUND_STATUS_VRF
    gr.requestId = event.params.requestId
    gr.vrfTxHash = event.transaction.hash
    gr.endedAt = event.block.timestamp
    gr.save()
  }
}

export function processVRFResult(event: VRFResult): void {
  const roundId = event.params.roundId
  const gr = GlobalRound.load(globalRoundIdBytes(roundId))
  if (gr == null) {
    log.error("GlobalRound not found for VRF result: {}", [roundId.toString()])
    return
  }

  gr.jackpotNumber = BigInt.fromI32(i32(event.params.jackpotNumber))
  gr.winningNumber = BigInt.fromI32(i32(event.params.winningNumber))
  gr.jackpotTriggered = i32(event.params.winningNumber) == i32(event.params.jackpotNumber)
  gr.vrfResultAt = event.block.timestamp
  gr.save()

  observeSideBetSpinsForRound(roundId, BigInt.fromI32(i32(event.params.winningNumber)))
}

export function processRoundResolved(event: RoundResolved): void {
  const roundId = event.params.roundId
  const gr = GlobalRound.load(globalRoundIdBytes(roundId))
  if (gr == null) {
    log.error("GlobalRound not found for resolution: {}", [roundId.toString()])
    return
  }

  const globalState = getOrCreateGlobalState()
  globalState.lastRoundPaid = roundId
  globalState.lastRoundResolved = event.block.timestamp
  globalState.roundTransitionInProgress = false
  const nextRoundId = roundId.plus(BigInt.fromI32(1))
  const nextGr = getOrCreateGlobalRound(nextRoundId, event.block.timestamp)
  globalState.currentGlobalRound = nextGr.id
  globalState.currentRoundNumber = nextRoundId
  globalState.totalRounds = globalState.totalRounds.plus(BigInt.fromI32(1))

  gr.status = ROUND_STATUS_CLEAN
  gr.resolvedAt = event.block.timestamp
  gr.save()

  finalizeMarketRoundsOnResolve(roundId, event.block.timestamp)

  globalState.save()

  const daily = getOrCreateDailyStats(event.block.timestamp)
  daily.roundsCompleted = daily.roundsCompleted.plus(BigInt.fromI32(1))
  daily.save()
}

export function processPayoutProgress(event: PayoutProgress): void {
  const marketId = event.params.marketId.toI32()
  const round = RouletteRound.load(marketRoundId(event.params.globalRoundId, marketId))
  if (round == null) {
    return
  }
  if (round.status != ROUND_STATUS_PAYOUT) {
    round.status = ROUND_STATUS_PAYOUT
  }
  round.totalPayouts = round.totalPayouts.plus(event.params.paidAmount)
  round.currentPayoutsCount = event.params.toCursor
  round.save()

  const gr = GlobalRound.load(globalRoundIdBytes(event.params.globalRoundId))
  if (gr != null && gr.status != ROUND_STATUS_PAYOUT) {
    gr.status = ROUND_STATUS_PAYOUT
    gr.save()
  }
}

export function processJackpotFunded(event: JackpotFunded): void {
  const marketId = event.params.marketId.toI32()
  const round = RouletteRound.load(marketRoundId(event.params.globalRoundId, marketId))
  if (round == null) {
    return
  }
  round.jackpotRevenue = round.jackpotRevenue.plus(event.params.amount)
  round.save()

  const daily = getOrCreateDailyStats(event.block.timestamp)
  daily.jackpotFunded = daily.jackpotFunded.plus(event.params.amount)
  daily.save()
}

export function processInfrastructureFeePaid(event: InfrastructureFeePaid): void {
  const marketId = event.params.marketId.toI32()
  const round = RouletteRound.load(marketRoundId(event.params.globalRoundId, marketId))
  if (round == null) {
    return
  }
  round.infraRevenue = round.infraRevenue.plus(event.params.amount)
  round.save()
}

/** Sole source of market catalog: RouletteEngine.MarketRegistered (not MarketRegistry). */
export function processMarketRegistered(event: MarketRegistered): void {
  const marketId = event.params.marketId.toI32()
  const market = getOrCreateMarket(
    marketId,
    event.params.asset,
    event.params.bank,
    event.address,
    event.block.timestamp,
    event.block.number
  )
  market.save()
  BankVaultTemplate.create(event.params.bank)
}

export function processGameUpgraded(event: Upgraded): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const entity = new ContractUpgrade(id)
  entity.contract = "Game"
  entity.implementation = event.params.implementation
  entity.blockNumber = event.block.number
  entity.timestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}
