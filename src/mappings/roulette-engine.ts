import { BigInt, log } from "@graphprotocol/graph-ts"
import {
  BetRecorded,
  VrfRequested,
  RoundResolved,
  VRFResult,
  GlobalRoundSealed,
  PayoutProgress,
  MinJackpotConditionUpdated,
  Initialized,
  Upgraded,
  MarketRegistered,
  RoundLocked,
  JackpotFunded,
  InfrastructureFeePaid
} from "../../generated/RouletteEngine/Game"
import {
  Market,
  MarketRound,
  RouletteBet,
  RouletteRound,
  ContractUpgrade
} from "../../generated/schema"
import { BankVault4626 as BankVault4626Template } from "../../generated/templates"
import {
  ROUND_STATUS_BETTING,
  ROUND_STATUS_NO_MORE_BETS,
  ROUND_STATUS_VRF,
  ROUND_STATUS_PAYOUT,
  ROUND_STATUS_CLEAN
} from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { createNewRouletteRound, createOrLoadMarketRound } from "../helpers/rouletteRound"
import { calculateMaxPayoutFromRoundComponents, recordRouletteBetEntry } from "../helpers/betting"
import { getOrCreateDailyStats, trackDailyUniquePlayer } from "../helpers/aggregation"
import { updateUserLastActive } from "../helpers/user"
import { getOrCreateMarketByIdWithBank, upsertBankIndex } from "../helpers/market"
import { ONE, ZERO } from "../helpers/number"

export function handleMarketRegistered(event: MarketRegistered): void {
  const marketId = event.params.marketId
  const bank = event.params.bank

  // Idempotent: getOrCreateMarketByIdWithBank loads if exists, else creates with metadata.
  const market = getOrCreateMarketByIdWithBank(marketId, bank, event.block.timestamp)
  upsertBankIndex(bank, market)

  // Spawn the template only if this is the first time we see this bank. The static USDC
  // bank source already covers `0x3861523245933a342debab87daa8298f3640c57c` historically,
  // so we skip template spawn for that address to avoid double-indexing.
  const usdcBank = "0x3861523245933a342debab87daa8298f3640c57c"
  if (bank.toHexString().toLowerCase() != usdcBank) {
    BankVault4626Template.create(bank)
    log.info("MarketRegistered: spawned BankVault4626 template for market {} bank {}", [
      marketId.toString(),
      bank.toHexString()
    ])
  } else {
    log.info("MarketRegistered: skipped template spawn for USDC bank (static source covers it)", [])
  }
}

export function handleBetRecorded(event: BetRecorded): void {
  const globalRoundId = event.params.localRound
  const marketIdBig = event.params.marketId
  const roundKey = bigintToBytes(globalRoundId)
  let round = RouletteRound.load(roundKey)
  const globalState = getOrCreateGlobalState()

  if (round == null) {
    round = createNewRouletteRound(globalRoundId, event.block.timestamp)
    globalState.totalRounds = globalState.totalRounds.plus(ONE)
  }

  if (round.status != ROUND_STATUS_BETTING) {
    return
  }

  const betType = BigInt.fromI32(i32(event.params.betType))
  const number = BigInt.fromI32(i32(event.params.number))

  const bet = recordRouletteBetEntry(
    event.params.player,
    event.params.amount,
    betType,
    number,
    round,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash
  )

  // Resolve market and update its MarketRound projection.
  const marketKey = bigintToBytes(marketIdBig)
  const market = Market.load(marketKey)
  if (market != null) {
    const mr = createOrLoadMarketRound(market, globalRoundId, globalRoundId, round, event.block.timestamp)
    mr.totalBets = mr.totalBets.plus(event.params.amount)
    mr.betCount = mr.betCount.plus(ONE)
    mr.save()
    bet.marketRound = mr.id
    bet.market = market.id
    bet.save()
  } else {
    log.warning(
      "BetRecorded: Market {} not found; MarketRound not created (will be backfilled when MarketRegistered indexes)",
      [marketIdBig.toString()]
    )
  }

  round.betCount = round.betCount.plus(ONE)
  round.maxBetAmount = calculateMaxPayoutFromRoundComponents(round)
  round.save()

  globalState.pendingBets = globalState.pendingBets.plus(event.params.amount)
  globalState.currentRound = roundKey
  globalState.currentRoundNumber = globalRoundId

  const daily = getOrCreateDailyStats(event.block.timestamp)
  daily.betCount = daily.betCount.plus(ONE)
  daily.volume = daily.volume.plus(event.params.amount)
  daily.save()

  trackDailyUniquePlayer(event.block.timestamp, event.params.player.toHexString())
  updateUserLastActive(event.params.player, event.block.timestamp)
  globalState.save()
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

export function handleRoundLocked(event: RoundLocked): void {
  const marketIdBig = event.params.marketId
  const globalRoundId = event.params.globalRoundId
  const marketKey = bigintToBytes(marketIdBig)
  const market = Market.load(marketKey)
  if (market == null) {
    log.warning("RoundLocked: Market {} not found", [marketIdBig.toString()])
    return
  }
  const round = RouletteRound.load(bigintToBytes(globalRoundId))
  if (round == null) {
    log.warning("RoundLocked: RouletteRound {} not found", [globalRoundId.toString()])
    return
  }
  const mr = createOrLoadMarketRound(market, event.params.roundId, globalRoundId, round, event.block.timestamp)
  mr.status = ROUND_STATUS_NO_MORE_BETS
  mr.lockedAt = event.block.timestamp
  mr.save()
}

export function handleVrfRequested(event: VrfRequested): void {
  const globalState = getOrCreateGlobalState()
  const resolvingRoundId = event.params.newRoundId
  const nextRoundId = resolvingRoundId.plus(ONE)
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
    globalState.pendingBets = ZERO
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
  const globalRoundId = event.params.globalRoundId
  const marketIdBig = event.params.marketId

  const round = RouletteRound.load(bigintToBytes(globalRoundId))
  if (round == null) {
    return
  }
  if (round.status != ROUND_STATUS_PAYOUT) {
    round.status = ROUND_STATUS_PAYOUT
  }
  round.totalPayouts = round.totalPayouts.plus(event.params.paidAmount)
  round.save()

  const market = Market.load(bigintToBytes(marketIdBig))
  if (market != null) {
    const mr = createOrLoadMarketRound(market, globalRoundId, globalRoundId, round, event.block.timestamp)
    mr.status = ROUND_STATUS_PAYOUT
    mr.totalPayouts = mr.totalPayouts.plus(event.params.paidAmount)
    mr.save()
  }
}

export function handleJackpotFunded(event: JackpotFunded): void {
  const globalRoundId = event.params.globalRoundId
  const marketIdBig = event.params.marketId

  const round = RouletteRound.load(bigintToBytes(globalRoundId))
  if (round == null) {
    log.warning("JackpotFunded: RouletteRound {} not found", [globalRoundId.toString()])
    return
  }
  const market = Market.load(bigintToBytes(marketIdBig))
  if (market == null) {
    log.warning("JackpotFunded: Market {} not found", [marketIdBig.toString()])
    return
  }
  const mr = createOrLoadMarketRound(market, globalRoundId, globalRoundId, round, event.block.timestamp)
  mr.jackpotFunded = mr.jackpotFunded.plus(event.params.amount)
  mr.save()
}

export function handleInfrastructureFeePaid(event: InfrastructureFeePaid): void {
  const globalRoundId = event.params.globalRoundId
  const marketIdBig = event.params.marketId

  const round = RouletteRound.load(bigintToBytes(globalRoundId))
  if (round == null) {
    log.warning("InfrastructureFeePaid: RouletteRound {} not found", [globalRoundId.toString()])
    return
  }
  const market = Market.load(bigintToBytes(marketIdBig))
  if (market == null) {
    log.warning("InfrastructureFeePaid: Market {} not found", [marketIdBig.toString()])
    return
  }
  const mr = createOrLoadMarketRound(market, globalRoundId, globalRoundId, round, event.block.timestamp)
  mr.infraFee = mr.infraFee.plus(event.params.amount)
  mr.save()
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
