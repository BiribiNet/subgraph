import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { UserMarketStats, Market } from "../../generated/schema"
import { ZERO_ADDRESS } from "./constant"
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

// Single owner of Market.stakerCount: a market gains a staker when this user's
// per-market share balance leaves zero, and loses one when it returns to zero.
// The global user.sbrbBalance must not drive this — it mixes share units across
// vaults, so multi-vault stakers were only ever counted in their first market.
export function recordUserMarketSbrbShares(
  userAddress: Bytes,
  market: Market,
  amount: BigInt,
  isIncrease: boolean
): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const stats = getOrCreateUserMarketStats(userAddress, market)
  const sharesBefore = stats.sbrbShares
  if (isIncrease) {
    stats.sbrbShares = stats.sbrbShares.plus(amount)
  } else if (stats.sbrbShares.lt(amount)) {
    stats.sbrbShares = ZERO
  } else {
    stats.sbrbShares = stats.sbrbShares.minus(amount)
  }
  if (sharesBefore.equals(ZERO) && stats.sbrbShares.gt(ZERO)) {
    market.stakerCount = market.stakerCount.plus(ONE)
    market.save()
  } else if (sharesBefore.gt(ZERO) && stats.sbrbShares.equals(ZERO)) {
    if (market.stakerCount.gt(ZERO)) {
      market.stakerCount = market.stakerCount.minus(ONE)
    }
    market.save()
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
