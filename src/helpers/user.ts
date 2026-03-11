import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { User } from "../../generated/schema"
import { ZERO_ADDRESS } from "./constant"
import { getOrCreateGlobalState } from "./globalState"
import { ONE, ZERO } from "./number"

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
    user.totalRouletteWins = BigInt.fromI32(0)
    user.save()
  }
  return user
}

export function updateUserBRBBalance(userAddress: Bytes, amount: BigInt, isIncrease: boolean): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)
  
  if (isIncrease) {
    user.brbBalance = user.brbBalance.plus(amount)
  } else {
    user.brbBalance = user.brbBalance.minus(amount)
  }
  
  user.save()
}

export function updateUserSBRBBalance(userAddress: Bytes, amount: BigInt, isIncrease: boolean): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)
  const globalState = getOrCreateGlobalState()

  if (isIncrease) {
    if (user.sbrbBalance.equals(ZERO)) {
      globalState.stakersCount = globalState.stakersCount.plus(ONE)
    }
    user.sbrbBalance = user.sbrbBalance.plus(amount)
  } else {
    user.sbrbBalance = user.sbrbBalance.minus(amount)
    if (user.sbrbBalance.equals(ZERO)) {
      globalState.stakersCount = globalState.stakersCount.minus(ONE)
    }
  }

  globalState.save();
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
    user.brbReferalBalance = user.brbReferalBalance.minus(amount)
  }
  
  user.save()
}

export function updateUserStakingStats(userAddress: Bytes, amount: BigInt, isDeposit: boolean): void {
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
}

export function updateUserRouletteStats(userAddress: Bytes, amount: BigInt, isWin: boolean, isPayout: boolean): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)
  
  if (isPayout) {
    if (isWin) {
      user.totalRouletteWins = user.totalRouletteWins.plus(amount)
    }
  } else {
    user.totalRouletteBets = user.totalRouletteBets.plus(amount)
  }
  
  user.save()
}

export function updateUserGeneralStats(userAddress: Bytes, betAmount: BigInt, winAmount: BigInt): void {
  if (userAddress.toHexString() == ZERO_ADDRESS) {
    return
  }
  const user = getOrCreateUser(userAddress)
  
  user.totalRouletteBets = user.totalRouletteBets.plus(betAmount)
  user.totalRouletteWins = user.totalRouletteWins.plus(winAmount)
  
  user.save()
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
