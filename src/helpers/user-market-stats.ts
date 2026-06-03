import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { UserMarketStats, Market } from "../../generated/schema"
import { ZERO, ONE } from "./number"
import { getOrCreateUser } from "./user"

export function userMarketStatsId(userAddress: Bytes, marketId: string): string {
  return userAddress.toHexString() + "-" + marketId
}

export function getOrCreateUserMarketStats(userAddress: Bytes, market: Market): UserMarketStats {
  const id = userMarketStatsId(userAddress, market.id)
  let stats = UserMarketStats.load(id)
  if (stats == null) {
    getOrCreateUser(userAddress)
    stats = new UserMarketStats(id)
    stats.user = userAddress
    stats.market = market.id
    stats.totalWagered = ZERO
    stats.totalWon = ZERO
    stats.totalLost = ZERO
    stats.betCount = ZERO
    stats.winCount = ZERO
    stats.totalStaked = ZERO
    stats.totalUnstaked = ZERO
    stats.sbrbShares = ZERO
    stats.sideBetStake = ZERO
    stats.sideBetWon = ZERO
    stats.firstSeenAt = ZERO
    stats.lastActiveAt = ZERO
  }
  return stats
}

function syncTotalLost(stats: UserMarketStats): void {
  if (stats.totalWagered.ge(stats.totalWon)) {
    stats.totalLost = stats.totalWagered.minus(stats.totalWon)
  } else {
    stats.totalLost = ZERO
  }
}

function touchActivity(stats: UserMarketStats, timestamp: BigInt): void {
  if (stats.firstSeenAt.equals(ZERO)) {
    stats.firstSeenAt = timestamp
  }
  stats.lastActiveAt = timestamp
}

export function recordUserMarketWager(
  userAddress: Bytes,
  market: Market,
  amount: BigInt,
  isNewRound: boolean,
  timestamp: BigInt
): void {
  const stats = getOrCreateUserMarketStats(userAddress, market)
  stats.totalWagered = stats.totalWagered.plus(amount)
  if (isNewRound) {
    stats.betCount = stats.betCount.plus(ONE)
  }
  syncTotalLost(stats)
  touchActivity(stats, timestamp)
  stats.save()
}

export function recordUserMarketWin(
  userAddress: Bytes,
  market: Market,
  amount: BigInt,
  isFirstWinForBet: boolean,
  timestamp: BigInt
): void {
  const stats = getOrCreateUserMarketStats(userAddress, market)
  stats.totalWon = stats.totalWon.plus(amount)
  if (isFirstWinForBet) {
    stats.winCount = stats.winCount.plus(ONE)
  }
  syncTotalLost(stats)
  touchActivity(stats, timestamp)
  stats.save()
}

export function recordUserMarketStake(
  userAddress: Bytes,
  market: Market,
  amount: BigInt,
  isDeposit: boolean,
  timestamp: BigInt
): void {
  const stats = getOrCreateUserMarketStats(userAddress, market)
  if (isDeposit) {
    stats.totalStaked = stats.totalStaked.plus(amount)
  } else {
    stats.totalUnstaked = stats.totalUnstaked.plus(amount)
  }
  touchActivity(stats, timestamp)
  stats.save()
}

export function recordUserMarketSbrbShares(
  userAddress: Bytes,
  market: Market,
  amount: BigInt,
  isIncrease: boolean
): void {
  const stats = getOrCreateUserMarketStats(userAddress, market)
  if (isIncrease) {
    stats.sbrbShares = stats.sbrbShares.plus(amount)
  } else if (stats.sbrbShares.lt(amount)) {
    stats.sbrbShares = ZERO
  } else {
    stats.sbrbShares = stats.sbrbShares.minus(amount)
  }
  stats.save()
}

export function recordUserMarketSideBetStake(
  userAddress: Bytes,
  market: Market,
  stake: BigInt,
  timestamp: BigInt
): void {
  const stats = getOrCreateUserMarketStats(userAddress, market)
  stats.sideBetStake = stats.sideBetStake.plus(stake)
  touchActivity(stats, timestamp)
  stats.save()
}

export function recordUserMarketSideBetWin(
  userAddress: Bytes,
  market: Market,
  payout: BigInt,
  timestamp: BigInt
): void {
  if (payout.equals(ZERO)) {
    return
  }
  const stats = getOrCreateUserMarketStats(userAddress, market)
  stats.sideBetWon = stats.sideBetWon.plus(payout)
  touchActivity(stats, timestamp)
  stats.save()
}
