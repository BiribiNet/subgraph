import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import {
  BetRecorded,
  VrfRequested,
  RoundResolved,
  VRFResult,
  GlobalRoundSealed,
  PayoutProgress,
  MinJackpotConditionUpdated,
  MarketRegistered,
  JackpotFunded,
  InfrastructureFeePaid,
  RoundLocked,
  Upgraded
} from "../../generated/RouletteEngine/Game"
import { RouletteRound, ContractUpgrade, GlobalRound } from "../../generated/schema"
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
import { calculateMaxPayoutFromRoundComponents, recordRouletteBetEntry } from "./betting"
import { getOrCreateDailyStats, trackDailyUniquePlayer } from "./aggregation"
import { updateUserLastActive } from "./user"
import { getOrCreateGlobalRound, globalRoundIdBytes } from "./globalRound"
import { marketRoundId, requireMarket, getOrCreateMarket } from "./market"
import { ZERO } from "./number"
import { BankVault as BankVaultTemplate } from "../../generated/templates"

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

export function processBetRecorded(event: BetRecorded): void {
  const globalRoundId = event.params.localRound
  const marketId = event.params.marketId.toI32()
  const globalState = getOrCreateGlobalState()
  const grKey = globalRoundIdBytes(globalRoundId)
  const existingGr = GlobalRound.load(grKey)
  const gr = getOrCreateGlobalRound(globalRoundId, event.block.timestamp)
  if (existingGr == null) {
    globalState.totalRounds = globalState.totalRounds.plus(BigInt.fromI32(1))
    gr.save()
  }
  const round = loadOrCreateMarketRound(globalRoundId, marketId, event.block.timestamp)

  if (round.firstBetAt.equals(ZERO)) {
    round.firstBetAt = event.block.timestamp
  }
  if (gr.firstBetAt.equals(ZERO)) {
    gr.firstBetAt = event.block.timestamp
  }

  if (round.status == ROUND_STATUS_BETTING) {
    const market = requireMarket(marketId)
    const betType = BigInt.fromI32(i32(event.params.betType))
    const number = BigInt.fromI32(i32(event.params.number))
    recordRouletteBetEntry(
      event.params.player,
      event.params.amount,
      betType,
      number,
      round,
      market,
      event.block.number,
      event.block.timestamp,
      event.transaction.hash
    )

    round.betCount = round.betCount.plus(BigInt.fromI32(1))
    round.maxBetAmount = calculateMaxPayoutFromRoundComponents(round)
    round.save()

    market.pendingBets = market.pendingBets.plus(event.params.amount)
    market.maxBetAmount = market.maxBetAmount.plus(event.params.amount)
    market.save()

    globalState.pendingBets = globalState.pendingBets.plus(event.params.amount)
    globalState.currentGlobalRound = gr.id
    globalState.currentRoundNumber = globalRoundId

    const daily = getOrCreateDailyStats(event.block.timestamp)
    daily.betCount = daily.betCount.plus(BigInt.fromI32(1))
    daily.volume = daily.volume.plus(event.params.amount)
    daily.save()

    trackDailyUniquePlayer(event.block.timestamp, event.params.player.toHexString())
    updateUserLastActive(event.params.player, event.block.timestamp)
    gr.save()
    globalState.save()
  }
}

export function processGlobalRoundSealed(event: GlobalRoundSealed): void {
  const gr = GlobalRound.load(globalRoundIdBytes(event.params.globalRoundId))
  if (gr == null) {
    log.error("GlobalRound not found for GlobalRoundSealed: {}", [event.params.globalRoundId.toString()])
    return
  }
  gr.status = ROUND_STATUS_NO_MORE_BETS
  gr.endedAt = event.block.timestamp
  const triggerMarketId = event.params.triggerMarketId.toI32()
  const trigger = requireMarket(triggerMarketId)
  gr.triggerMarket = trigger.id
  gr.save()

  const round = RouletteRound.load(marketRoundId(event.params.globalRoundId, triggerMarketId))
  if (round != null) {
    round.status = ROUND_STATUS_NO_MORE_BETS
    round.save()
  }
}

export function processRoundLocked(event: RoundLocked): void {
  const gr = getOrCreateGlobalRound(event.params.globalRoundId, event.block.timestamp)
  gr.status = ROUND_STATUS_NO_MORE_BETS
  gr.endedAt = event.block.timestamp
  gr.save()
}

export function processVrfRequested(event: VrfRequested): void {
  const globalState = getOrCreateGlobalState()
  const resolvingRoundId = event.params.newRoundId
  const nextRoundId = resolvingRoundId.plus(BigInt.fromI32(1))
  const nextGr = getOrCreateGlobalRound(nextRoundId, event.block.timestamp)
  globalState.currentGlobalRound = nextGr.id
  globalState.currentRoundNumber = nextRoundId
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
  gr.vrfResultAt = event.block.timestamp
  gr.save()
}

export function processRoundResolved(event: RoundResolved): void {
  const roundId = event.params.roundId
  const gr = GlobalRound.load(globalRoundIdBytes(roundId))
  if (gr == null) {
    log.error("GlobalRound not found for resolution: {}", [roundId.toString()])
    return
  }

  const globalState = getOrCreateGlobalState()
  if (globalState.pendingBets.gt(BigInt.fromI32(0))) {
    globalState.pendingBets = BigInt.fromI32(0)
  }

  globalState.lastRoundPaid = roundId
  globalState.roundTransitionInProgress = false
  globalState.save()

  gr.status = ROUND_STATUS_CLEAN
  gr.resolvedAt = event.block.timestamp
  gr.save()
}

export function processPayoutProgress(event: PayoutProgress): void {
  const marketId = event.params.marketId.toI32()
  const round = RouletteRound.load(marketRoundId(event.params.globalRoundId, marketId))
  if (round == null) {
    return
  }
  if (round.status == ROUND_STATUS_PAYOUT) {
    // already in payout
  } else {
    round.status = ROUND_STATUS_PAYOUT
  }
  round.totalPayouts = round.totalPayouts.plus(event.params.paidAmount)
  round.currentPayoutsCount = event.params.toCursor
  round.save()

  const gr = GlobalRound.load(globalRoundIdBytes(event.params.globalRoundId))
  if (gr != null) {
    if (gr.status == ROUND_STATUS_PAYOUT) {
      // already set
    } else {
      gr.status = ROUND_STATUS_PAYOUT
      gr.save()
    }
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

export function processMinJackpotConditionUpdated(event: MinJackpotConditionUpdated): void {
  const globalState = getOrCreateGlobalState()
  globalState.minJackpotCondition = event.params.newMinJackpotCondition
  globalState.save()
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
