import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  JackpotPayout,
  PayoutTransaction,
  RouletteBet,
  RouletteRound,
  WithdrawTransaction,
  Market,
  GlobalState,
} from "../../generated/schema"
import {
  JACKPOT_TREASURY_ADDRESS,
  ROUND_STATUS_NO_MORE_BETS,
  ROUND_STATUS_PAYOUT,
} from "./constant"
import { bigintToBytes } from "./bigintToBytes"
import { getOrCreateDailyStats, getOrCreateHourlySnapshot } from "./aggregation"
import { getOrCreateGlobalState } from "./globalState"
import { ZERO } from "./number"
import { findBetInGlobalRound, findBetInMarketRound, isKnownBank, loadMarketByBank } from "./market"
import { normalizeAmountTo18, updateUserRouletteStats } from "./user"
import { recordUserMarketWin } from "./user-market-stats"

/** Jackpot payouts are denominated in BRB, never in the market's own asset. */
const BRB_DECIMALS: i32 = 18

/**
 * True for the addresses settlement pays out of the bank that are protocol roles, not winners.
 *
 * Deliberately skips them outright rather than trying to tell a fee from a genuine win: these are
 * treasury and contract addresses, and crediting a fee as a win corrupts `won`, `actualPayout`,
 * the user's win totals and their BRBpoints tier, while contradicting the round's own payout
 * total. Under-crediting a protocol address, in the unlikely case one also bets, costs nothing by
 * comparison.
 */
function isProtocolFeeRecipient(globalState: GlobalState, to: Address): boolean {
  const infraRecipient = globalState.infraRecipient
  if (infraRecipient !== null && to.equals(Address.fromBytes(changetype<Bytes>(infraRecipient)))) {
    return true
  }
  const jackpotFunder = globalState.jackpotFunder
  if (jackpotFunder !== null && to.equals(Address.fromBytes(changetype<Bytes>(jackpotFunder)))) {
    return true
  }
  return false
}

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
    // Settlement pays protocol roles out of the same bank as the winners: the infrastructure fee
    // to INFRA_RECIPIENT and the jackpot swap input to the funder. Both are plain ERC-20
    // transfers, and the events naming them (InfrastructureFeePaid, JackpotFunded) are emitted
    // after the transfer, so nothing distinguishes them here except the recipient. Round 447 on
    // Sepolia credited its 0.02 BRB infra fee as a win to the wallet that happens to hold both
    // roles on testnet — a bet on BLACK that had lost to a red 1, marked won with a payout the
    // round's own `totalPayouts` (authoritative, from PayoutProgress) reported as zero.
    if (isProtocolFeeRecipient(globalState, to)) {
      return
    }
    const market = loadMarketByBank(from)
    if (market != null) {
      assetDecimals = market.assetDecimals
      bet = findBetInMarketRound(changetype<Bytes>(to), resolvingRoundId, market.marketId)
      if (bet != null) {
        currentRound = RouletteRound.load(bet.round)
      }
    }
  } else if (from.equals(JACKPOT_TREASURY_ADDRESS)) {
    // The treasury pays BRB whatever market the winning bet sat in, so the scale is BRB's, not
    // the market asset's. Reading the market's decimals here inflated a jackpot win by 10^12 for
    // a 6-decimal market.
    assetDecimals = BRB_DECIMALS
    bet = findBetInGlobalRound(changetype<Bytes>(to), resolvingRoundId)
    if (bet != null) {
      currentRound = RouletteRound.load(bet.round)
    }
  } else {
    return
  }

  if (currentRound == null || bet == null) {
    return
  }
  // The bank's Transfer to the winner is logged before the engine's PayoutProgress that flips the
  // market round to PAYOUT, so requiring PAYOUT here silently dropped the first batch of every
  // round: the winner's own bet kept a short `actualPayout` and its PayoutTransaction row never
  // existed. NO_MORE_BETS — set when VrfRequested locked the round — is the state a settlement
  // transfer actually arrives in. Anything earlier is a stake moving the other way.
  if (
    currentRound.status != ROUND_STATUS_PAYOUT &&
    currentRound.status != ROUND_STATUS_NO_MORE_BETS
  ) {
    return
  }

  const payoutId = transactionHash.concat(bigintToBytes(logIndex))
  const wasAlreadyWinner = bet.won
  // Cross-market aggregates are denominated in 18 decimals, matching `totalWagered`. Per-market and
  // per-bet amounts below stay in the asset's own units — those never mix.
  const normalizedPayout = normalizeAmountTo18(value, assetDecimals)
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

    // Clamp at zero: `currentJackpot` is a counter started at the manifest
    // startBlock, so it under-states the pool if the treasury already held BRB
    // then. graph-ts BigInt is signed and would silently go negative.
    globalState.currentJackpot = value.gt(globalState.currentJackpot)
      ? ZERO
      : globalState.currentJackpot.minus(value)

    globalState.totalJackpotsPaid = globalState.totalJackpotsPaid.plus(value)
    globalState.totalPayouts = globalState.totalPayouts.plus(normalizedPayout)

    updateUserRouletteStats(to, value, assetDecimals, true, !wasAlreadyWinner, timestamp)
    if (payoutMarket != null) {
      recordUserMarketWin(to, payoutMarket, value, !wasAlreadyWinner, timestamp)
    }
    bet.won = true
    bet.actualPayout = bet.actualPayout.plus(value)

    const dailyStatsJackpotPayout = getOrCreateDailyStats(timestamp)
    dailyStatsJackpotPayout.totalPayouts = dailyStatsJackpotPayout.totalPayouts.plus(normalizedPayout)
    // End-of-day pool snapshot — see the matching stamp in `brb.ts`.
    dailyStatsJackpotPayout.jackpotPool = globalState.currentJackpot
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

    globalState.totalPayouts = globalState.totalPayouts.plus(normalizedPayout)

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
