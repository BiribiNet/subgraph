import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { User } from "../../generated/schema"

export function getOrCreateUser(userAddress: Bytes): User {
  let user = User.load(userAddress)
  if (!user) {
    user = new User(userAddress)
    user.brbBalance = BigInt.fromI32(0)
    user.sbrbBalance = BigInt.fromI32(0)
    user.totalStaked = BigInt.fromI32(0)
    user.totalUnstaked = BigInt.fromI32(0)
    user.totalRouletteBets = BigInt.fromI32(0)
    user.totalRouletteWins = BigInt.fromI32(0)
    user.save()
  }
  return user
}

export function updateUserBRBBalance(userAddress: Bytes, amount: BigInt, isIncrease: boolean): void {
  const user = getOrCreateUser(userAddress)
  
  if (isIncrease) {
    user.brbBalance = user.brbBalance.plus(amount)
  } else {
    user.brbBalance = user.brbBalance.minus(amount)
  }
  
  user.save()
}

export function updateUserSBRBBalance(userAddress: Bytes, amount: BigInt, isIncrease: boolean): void {
  const user = getOrCreateUser(userAddress)
  
  if (isIncrease) {
    user.sbrbBalance = user.sbrbBalance.plus(amount)
  } else {
    user.sbrbBalance = user.sbrbBalance.minus(amount)
  }
  
  user.save()
}

export function updateUserStakingStats(userAddress: Bytes, amount: BigInt, isDeposit: boolean): void {
  const user = getOrCreateUser(userAddress)
  
  if (isDeposit) {
    user.totalStaked = user.totalStaked.plus(amount)
  } else {
    user.totalUnstaked = user.totalUnstaked.plus(amount)
  }
  
  user.save()
}

export function updateUserRouletteStats(userAddress: Bytes, amount: BigInt, isWin: boolean, isPayout: boolean): void {
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
  const user = getOrCreateUser(userAddress)
  
  user.totalRouletteBets = user.totalRouletteBets.plus(betAmount)
  user.totalRouletteWins = user.totalRouletteWins.plus(winAmount)
  
  user.save()
}
