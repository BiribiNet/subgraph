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
  Upgraded
} from "../../generated/RouletteEngine/Game"
import {
  BRBBurn,
  ContractUpgrade,
  GlobalRound,
  GlobalState,
  PendingBrbBurn,
  RouletteBet,
  RouletteRound,
} from "../../generated/schema"
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_VRF,
  ROUND_STATUS_PAYOUT,
  ROUND_STATUS_CLEAN
} from "./constant"
import { BRB_TOKEN_ADDRESS } from "./constant"
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
import { BankVault as BankVaultTemplate, MarketAsset as MarketAssetTemplate } from "../../generated/templates"
import { recordTxBetToBank } from "./tx-activity"
import {
  finalizeMarketRoundsOnResolve,
  lockAllParticipatingMarketRounds,
} from "./round-sync"
import { observeSideBetSpinsForRound } from "./side-bet-vrf"

// Takes the caller's `GlobalRound` instance rather than loading its own: `store.get` hands back a
// fresh object every call, so a second copy incremented here was silently discarded the moment the
// caller saved its own — which is why `participantMarketCount` never left zero.
function loadOrCreateMarketRound(
  gr: GlobalRound,
  globalRoundId: BigInt,
  marketId: i32,
  timestamp: BigInt
): RouletteRound {
  const market = requireMarket(marketId)
  const roundKey = marketRoundId(globalRoundId, marketId)
  let round = RouletteRound.load(roundKey)
  if (round == null) {
    round = createNewRouletteRound(gr, market, timestamp)
    gr.participantMarketCount = gr.participantMarketCount.plus(BigInt.fromI32(1))
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
    // Persist the increment — getOrCreateDailyStats returns an unsaved instance, so without this
    // save the per-day uniquePlayers count is silently discarded (stays 0 forever).
    daily.save()
  }
}

export function processBetRecorded(event: BetRecorded): void {
  const globalRoundId = event.params.localRound
  const marketId = event.params.marketId.toI32()
  const globalState = getOrCreateGlobalState()
  const gr = getOrCreateGlobalRound(globalRoundId, event.block.timestamp)
  const round = loadOrCreateMarketRound(gr, globalRoundId, marketId, event.block.timestamp)

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

  // RoundCountdownStarted is the FIRST log of the first-bet tx (before
  // BetRecorded), so the GlobalRound entity does not exist yet at this point —
  // create it instead of dropping the event
  // (a load + early-return left triggerMarket/lockAt unset on every round).
  const gr = getOrCreateGlobalRound(event.params.roundId, event.block.timestamp)
  const triggerMarketId = event.params.triggerMarketId.toI32()
  const trigger = requireMarket(triggerMarketId)
  gr.triggerMarket = trigger.id
  gr.lockAt = event.params.lockAt
  if (gr.firstBetAt.equals(ZERO)) {
    gr.firstBetAt = event.block.timestamp
  }
  gr.save()
}

/**
 * The engine no longer emits a separate RoundLocked event: the TriggerVrf job locks
 * the round and requests VRF in one transaction, so VrfRequested IS the lock signal.
 * Betting is also rejected on-chain once lockAt elapsed, ahead of this event.
 */
export function processVrfRequested(event: VrfRequested): void {
  const globalState = getOrCreateGlobalState()
  const resolvingRoundId = event.params.newRoundId
  globalState.currentGlobalRound = globalRoundIdBytes(resolvingRoundId)
  globalState.currentRoundNumber = resolvingRoundId
  globalState.roundTransitionInProgress = true
  globalState.save()

  const gr = getOrCreateGlobalRound(resolvingRoundId, event.block.timestamp)
  gr.status = ROUND_STATUS_VRF
  gr.requestId = event.params.requestId
  gr.vrfTxHash = event.transaction.hash
  gr.endedAt = event.block.timestamp
  gr.save()

  lockAllParticipatingMarketRounds(resolvingRoundId)
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
  // `getOrCreateGlobalRound` does not persist, and `currentGlobalRound` is a non-null reference:
  // leaving the next round unsaved pointed GlobalState at an entity that did not exist until that
  // round's first bet. Any query selecting through it failed outright ("Null value resolved for
  // non-null field"), and CallFailed in that window found no round to attribute itself to — 38 of
  // the 58 lifetime failures were lost that way.
  nextGr.save()
  globalState.currentGlobalRound = nextGr.id
  globalState.currentRoundNumber = nextRoundId
  globalState.totalRounds = globalState.totalRounds.plus(BigInt.fromI32(1))

  gr.status = ROUND_STATUS_CLEAN
  gr.resolvedAt = event.block.timestamp
  gr.save()

  // Flush before finalizeMarketRoundsOnResolve: `updateRoundRevenueAggregates` loads and saves its
  // own GlobalState copy to add the round's staker share, so saving this (older) copy afterwards
  // wiped that write — which is why `totalStakerRevenue` read 0 while every round carried one.
  globalState.save()

  finalizeMarketRoundsOnResolve(roundId, event.block.timestamp)

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
  // Payouts are sharded across lanes and every lane keeps its own cursor starting at 0, so the raw
  // `toCursor` is a per-lane position, not a round total — assigning it made a three-row round
  // report whatever its last lane happened to end on. The rows this batch settled are the span it
  // covers.
  round.currentPayoutsCount = round.currentPayoutsCount.plus(
    event.params.toCursor.minus(event.params.fromCursor)
  )
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
  // This event is the first thing in the transaction that names both the round and the market the
  // funder just burned for, so it is where the queued burn gets its home.
  round.roundBurnAmount = round.roundBurnAmount.plus(
    claimBurnForRound(event.transaction.hash, round)
  )
  round.save()

  const daily = getOrCreateDailyStats(event.block.timestamp)
  daily.jackpotFunded = daily.jackpotFunded.plus(event.params.amount)
  daily.save()
}

/**
 * Claims this transaction's next unattributed BRB burn for `round` and returns its amount (zero if
 * the funder burned nothing for this market — a skipped swap or a failed burn still emits
 * JackpotFunded). Markets settle one after another within a transaction, each burning before it
 * emits, so FIFO order pairs a burn with its own market.
 */
function claimBurnForRound(transactionHash: Bytes, round: RouletteRound): BigInt {
  const pending = PendingBrbBurn.load(transactionHash)
  if (pending == null) {
    return ZERO
  }
  const burnIds = pending.burnIds
  if (pending.cursor >= burnIds.length) {
    return ZERO
  }
  const burn = BRBBurn.load(burnIds[pending.cursor])
  pending.cursor += 1
  pending.save()
  if (burn == null) {
    return ZERO
  }
  burn.round = round.id
  burn.save()
  return burn.amount
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
  // A winner is only ever named by the asset's own Transfer(bank -> winner); no engine or vault
  // event carries (winner, amount). BRB already has a static data source, so spawning one here too
  // would double-count it.
  if (!event.params.asset.equals(BRB_TOKEN_ADDRESS)) {
    MarketAssetTemplate.create(event.params.asset)
  }
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
