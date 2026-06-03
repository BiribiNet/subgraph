import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  JackpotPayout,
  PayoutTransaction,
  RouletteBet,
  RouletteRound,
  WithdrawTransaction,
  Market,
} from "../../generated/schema"
import { JACKPOT_TREASURY_ADDRESS, ROUND_STATUS_PAYOUT } from "./constant"
import { bigintToBytes } from "./bigintToBytes"
import { getOrCreateDailyStats, getOrCreateHourlySnapshot } from "./aggregation"
import { getOrCreateGlobalState } from "./globalState"
import { findBetInGlobalRound, findBetInMarketRound, isKnownBank, loadMarketByBank } from "./market"
import { updateUserRouletteStats } from "./user"
import { recordUserMarketWin } from "./user-market-stats"

/**
 * Records per-winner payout detail from an ERC-20 Transfer (market asset or BRB).
 * Round payout totals remain authoritative via RouletteEngine.PayoutProgress.
 */
export function tryRecordMarketPayoutTransfer(
  from: Address,
  to: Address,
  value: BigInt,
  blockNumber: BigInt,
  timestamp: BigInt,
  transactionHash: Bytes,
  logIndex: BigInt
): void {
  if (WithdrawTransaction.load(transactionHash) != null) {
    return
  }

  const globalState = getOrCreateGlobalState()
  const resolvingRoundId = globalState.roundTransitionInProgress
    ? globalState.currentRoundNumber
    : globalState.lastRoundPaid
  if (resolvingRoundId.equals(BigInt.zero())) {
    return
  }

  let bet: RouletteBet | null = null
  let currentRound: RouletteRound | null = null
  let assetDecimals: i32 = 18

  if (isKnownBank(from)) {
    const market = loadMarketByBank(from)
    if (market != null) {
      assetDecimals = market.assetDecimals
      bet = findBetInMarketRound(changetype<Bytes>(to), resolvingRoundId, market.marketId)
      if (bet != null) {
        currentRound = RouletteRound.load(bet.round)
      }
    }
  } else if (from.equals(JACKPOT_TREASURY_ADDRESS)) {
    bet = findBetInGlobalRound(changetype<Bytes>(to), resolvingRoundId)
    if (bet != null) {
      currentRound = RouletteRound.load(bet.round)
      if (currentRound != null) {
        const marketEntity = Market.load(currentRound.market)
        if (marketEntity != null) {
          assetDecimals = marketEntity.assetDecimals
        }
      }
    }
  } else {
    return
  }

  if (currentRound == null || bet == null) {
    return
  }
  if (currentRound.status != ROUND_STATUS_PAYOUT) {
    return
  }

  const payoutId = transactionHash.concat(bigintToBytes(logIndex))
  const wasAlreadyWinner = bet.won
  const normalizedPayout = value
  const payoutMarket = Market.load(bet.market)

  if (from.equals(JACKPOT_TREASURY_ADDRESS)) {
    const jackpotPayoutTx = new JackpotPayout(payoutId)
    jackpotPayoutTx.user = to
    jackpotPayoutTx.round = currentRound.id
    jackpotPayoutTx.bet = bet.id
    jackpotPayoutTx.amount = value
    jackpotPayoutTx.blockNumber = blockNumber
    jackpotPayoutTx.timestamp = timestamp
    jackpotPayoutTx.transactionHash = transactionHash
    jackpotPayoutTx.save()

    globalState.currentJackpot = globalState.currentJackpot.minus(value)

    globalState.totalJackpotsPaid = globalState.totalJackpotsPaid.plus(value)
    globalState.totalPayouts = globalState.totalPayouts.plus(value)

    updateUserRouletteStats(to, value, assetDecimals, true, !wasAlreadyWinner, timestamp)
    if (payoutMarket != null) {
      recordUserMarketWin(to, payoutMarket, value, !wasAlreadyWinner, timestamp)
    }
    bet.won = true
    bet.actualPayout = bet.actualPayout.plus(value)

    const dailyStatsJackpotPayout = getOrCreateDailyStats(timestamp)
    dailyStatsJackpotPayout.totalPayouts = dailyStatsJackpotPayout.totalPayouts.plus(normalizedPayout)
    dailyStatsJackpotPayout.save()
    const hourlyJackpotPayout = getOrCreateHourlySnapshot(timestamp)
    hourlyJackpotPayout.totalPayouts = hourlyJackpotPayout.totalPayouts.plus(normalizedPayout)
    hourlyJackpotPayout.save()
  } else {
    const payoutTx = new PayoutTransaction(payoutId)
    payoutTx.user = to
    payoutTx.round = currentRound.id
    payoutTx.bet = bet.id
    payoutTx.amount = value
    payoutTx.blockNumber = blockNumber
    payoutTx.timestamp = timestamp
    payoutTx.transactionHash = transactionHash
    payoutTx.save()

    bet.actualPayout = bet.actualPayout.plus(value)
    bet.won = true
    updateUserRouletteStats(to, value, assetDecimals, true, !wasAlreadyWinner, timestamp)
    if (payoutMarket != null) {
      recordUserMarketWin(to, payoutMarket, value, !wasAlreadyWinner, timestamp)
    }

    globalState.totalPayouts = globalState.totalPayouts.plus(value)

    const dailyStatsRegularPayout = getOrCreateDailyStats(timestamp)
    dailyStatsRegularPayout.totalPayouts = dailyStatsRegularPayout.totalPayouts.plus(normalizedPayout)
    dailyStatsRegularPayout.save()
    const hourlyRegularPayout = getOrCreateHourlySnapshot(timestamp)
    hourlyRegularPayout.totalPayouts = hourlyRegularPayout.totalPayouts.plus(normalizedPayout)
    hourlyRegularPayout.save()
  }

  bet.save()
  globalState.save()
}
