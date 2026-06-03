import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"
import { User, Market } from "../../generated/schema"
import { ZERO_ADDRESS } from "./constant"
import { ONE, ZERO } from "./number"
import { recomputeAndSaveUserPoints } from "./brb-points"

export function getOrCreateUser(userAddress: Bytes): User {
  let user = User.load(userAddress)
  if (user == null) {
    user = new User(userAddress)
    user.brbBalance = BigInt.fromI32(0)
    user.sbrbBalance = BigInt.fromI32(0)
    user.brbReferalBalance = BigInt.fromI32(0)
    user.totalStaked = BigInt.fromI32(0)
    user.totalUnstaked = BigInt.fromI32(0)
    user.cumulativeDepositValue = BigInt.fromI32(0)
    user.cumulativeDepositShares = BigInt.fromI32(0)
    user.totalRouletteBets = BigInt.fromI32(0)
    user.tier = "BRONZE"
    user.brbpPoints = BigInt.fromI32(0)
    user.firstSeenAt = BigInt.fromI32(0)
    user.lastActiveAt = BigInt.fromI32(0)
    user.totalWon = BigInt.fromI32(0)
    user.totalLost = BigInt.fromI32(0)
    user.winCount = BigInt.fromI32(0)
    user.betCount = BigInt.fromI32(0)
    user.totalBrbrEarned = BigInt.fromI32(0)
    user.totalBrbrSpent = BigInt.fromI32(0)
    user.save()
  }
  return user
}

export function updateUserLastActive(userAddress: Bytes, timestamp: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (user.firstSeenAt.equals(ZERO)) {
    user.firstSeenAt = timestamp
  }
  user.lastActiveAt = timestamp

  user.save()
}

export function updateUserBRBBalance(userAddress: Bytes, amount: BigInt, isIncrease: boolean): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (isIncrease) {
    user.brbBalance = user.brbBalance.plus(amount)
  } else {
    if (user.brbBalance.lt(amount)) {
      // Only warn when we had a positive tracked balance (likely stale index vs true anomaly).
      if (user.brbBalance.gt(ZERO)) {
        log.warning("BRB balance underflow for user {}: {} < {}", [userAddress.toHexString(), user.brbBalance.toString(), amount.toString()])
      }
      user.brbBalance = ZERO
    } else {
      user.brbBalance = user.brbBalance.minus(amount)
    }
  }

  user.save()
}

export function updateUserSBRBBalance(
  userAddress: Bytes,
  amount: BigInt,
  isIncrease: boolean,
  market: Market | null
): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (isIncrease) {
    if (user.sbrbBalance.equals(ZERO) && market != null) {
      market.stakerCount = market.stakerCount.plus(ONE)
      market.save()
    }
    user.sbrbBalance = user.sbrbBalance.plus(amount)
  } else {
    if (user.sbrbBalance.lt(amount)) {
      log.warning("sBRB balance underflow for user {}: {} < {}", [userAddress.toHexString(), user.sbrbBalance.toString(), amount.toString()])
      user.sbrbBalance = ZERO
    } else {
      user.sbrbBalance = user.sbrbBalance.minus(amount)
    }
    if (user.sbrbBalance.equals(ZERO) && market != null) {
      if (market.stakerCount.gt(ZERO)) {
        market.stakerCount = market.stakerCount.minus(ONE)
      }
      market.save()
    }
  }

  user.save()
}

export function updateUserBRBReferalBalance(userAddress: Bytes, amount: BigInt, isIncrease: boolean): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (isIncrease) {
    user.brbReferalBalance = user.brbReferalBalance.plus(amount)
  } else {
    if (user.brbReferalBalance.lt(amount)) {
      log.warning("BRBReferal balance underflow for user {}: {} < {}", [userAddress.toHexString(), user.brbReferalBalance.toString(), amount.toString()])
      user.brbReferalBalance = ZERO
    } else {
      user.brbReferalBalance = user.brbReferalBalance.minus(amount)
    }
  }

  user.save()
}

export function updateUserStakingStats(userAddress: Bytes, amount: BigInt, isDeposit: boolean, timestamp: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (isDeposit) {
    user.totalStaked = user.totalStaked.plus(amount)
  } else {
    user.totalUnstaked = user.totalUnstaked.plus(amount)
  }

  user.save()
  recomputeAndSaveUserPoints(user, timestamp)
}

// BRBP points are denominated in BRB-equivalent units (18 decimals).
const POINTS_DECIMALS = 18

/**
 * Normalize a raw token amount to 18 decimals so wagering volume counts by token
 * quantity, not raw units: 1 USDC (1e6) and 1 BRB (1e18) contribute the same
 * volume. No price oracle — this is purely a decimals alignment.
 *
 * Guard: when `assetDecimals` is unknown (market.ts seeds 0 on a failed read) or
 * outside the 1..18 range, fall back to no scaling to avoid runaway inflation.
 */
export function normalizeAmountTo18(amount: BigInt, assetDecimals: i32): BigInt {
  if (assetDecimals <= 0 || assetDecimals > POINTS_DECIMALS) {
    log.warning("Unexpected assetDecimals {} for wagered normalization; counting raw amount", [assetDecimals.toString()])
    return amount
  }
  const exponent = POINTS_DECIMALS - assetDecimals
  if (exponent == 0) {
    return amount
  }
  return amount.times(BigInt.fromI32(10).pow(u8(exponent)))
}

/**
 * Records wagering volume for the BRBpoints "wagered" component (weight x3).
 * Called at bet time from processBetRecorded, mirroring how DailyStats.volume is
 * accumulated. `assetDecimals` aligns multi-market amounts to 18 decimals;
 * `isNewRound` increments betCount only once per distinct round per user.
 */
export function updateUserWageredStats(userAddress: Bytes, amount: BigInt, assetDecimals: i32, isNewRound: boolean, timestamp: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  const normalized = normalizeAmountTo18(amount, assetDecimals)
  user.totalRouletteBets = user.totalRouletteBets.plus(normalized)
  if (isNewRound) {
    user.betCount = user.betCount.plus(ONE)
  }
  // Derive totalLost from totalRouletteBets - totalWon (always accurate)
  user.totalLost = user.totalRouletteBets.minus(user.totalWon)

  user.save()
  recomputeAndSaveUserPoints(user, timestamp)
}

/**
 * Records a roulette payout (a win). Bets are tracked separately at bet time via
 * updateUserWageredStats, so this only handles the win/payout side.
 */
export function updateUserRouletteStats(
  userAddress: Bytes,
  amount: BigInt,
  assetDecimals: i32,
  isWin: boolean,
  isFirstWinForBet: boolean,
  timestamp: BigInt
): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (isWin) {
    const normalized = normalizeAmountTo18(amount, assetDecimals)
    user.totalWon = user.totalWon.plus(normalized)
    if (isFirstWinForBet) {
      user.winCount = user.winCount.plus(ONE)
    }
  }

  user.totalLost = user.totalRouletteBets.minus(user.totalWon)

  user.save()
  recomputeAndSaveUserPoints(user, timestamp)
}

export function updateUserBrbrEarnings(userAddress: Bytes, amount: BigInt, isCredit: boolean, timestamp: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  if (isCredit) {
    user.totalBrbrEarned = user.totalBrbrEarned.plus(amount)
  } else {
    user.totalBrbrSpent = user.totalBrbrSpent.plus(amount)
  }

  user.save()
  recomputeAndSaveUserPoints(user, timestamp)
}

export function updateUserDepositCostBasis(userAddress: Bytes, assets: BigInt, shares: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  // Add deposit to cumulative values
  user.cumulativeDepositValue = user.cumulativeDepositValue.plus(assets)
  user.cumulativeDepositShares = user.cumulativeDepositShares.plus(shares)

  user.save()
}

export function updateUserWithdrawalCostBasis(userAddress: Bytes, shares: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)

  // If user has no cumulative shares, nothing to remove
  if (user.cumulativeDepositShares.equals(ZERO)) {
    return
  }

  // Calculate cost basis removed using scaled integer math with precision factor
  // Use precision factor to maintain accuracy during division
  const PRECISION = BigInt.fromI32(10).pow(18)
  // Formula: costBasisRemoved = ((shares × cumulativeDepositValue × PRECISION) / cumulativeDepositShares) / PRECISION
  const costBasisRemoved = shares
    .times(user.cumulativeDepositValue)
    .times(PRECISION)
    .div(user.cumulativeDepositShares)
    .div(PRECISION)

  // Validate that we're not removing more than we have (shouldn't happen, but safety check)
  // If shares exceed cumulative shares, reset everything to zero
  if (shares.ge(user.cumulativeDepositShares)) {
    user.cumulativeDepositShares = ZERO
    user.cumulativeDepositValue = ZERO
  } else {
    // Subtract shares first
    user.cumulativeDepositShares = user.cumulativeDepositShares.minus(shares)

    // Subtract cost basis, but cap at cumulativeDepositValue to prevent underflow
    if (costBasisRemoved.gt(user.cumulativeDepositValue)) {
      // Due to rounding, cost basis removed might slightly exceed cumulative value
      // In this case, set to zero (all cost basis is effectively removed)
      user.cumulativeDepositValue = ZERO
    } else {
      user.cumulativeDepositValue = user.cumulativeDepositValue.minus(costBasisRemoved)
    }

    // If no shares remaining after subtraction, reset cost basis to zero
    if (user.cumulativeDepositShares.equals(ZERO)) {
      user.cumulativeDepositValue = ZERO
    }
  }

  user.save()
}
