import { Bytes, BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { GlobalState } from "../../generated/schema"
import { ZERO } from "./number"
import { getOrCreateGlobalRound } from "./globalRound"

const GLOBAL_STATE_ID = Bytes.fromHexString("0x0000000000000000000000000000000000000001")

export function getOrCreateGlobalState(): GlobalState {
  let globalState = GlobalState.load(GLOBAL_STATE_ID)
  if (!globalState) {
    globalState = new GlobalState(GLOBAL_STATE_ID)
    const initialRound = getOrCreateGlobalRound(BigInt.fromI32(1), ZERO)
    initialRound.save()
    globalState.currentGlobalRound = initialRound.id
    globalState.currentRoundNumber = BigInt.fromI32(1)
    globalState.lastRoundStartTime = ZERO
    globalState.lastRoundPaid = ZERO
    globalState.currentJackpot = ZERO
    globalState.stableVaultTotalAssets = ZERO
    globalState.brbVaultTotalAssets = ZERO
    globalState.stableVaultTotalDeposits = ZERO
    globalState.brbVaultTotalDeposits = ZERO
    globalState.lastRoundResolved = ZERO
    globalState.roundTransitionInProgress = false
    globalState.largeWithdrawalBatchSize = BigInt.fromI32(5)
    globalState.maxQueueLength = BigInt.fromI32(100)
    globalState.totalPendingLargeWithdrawals = ZERO
    globalState.withdrawalQueueCounter = ZERO
    globalState.totalTransfersToPool = ZERO
    globalState.totalWagered = ZERO
    globalState.totalBets = ZERO
    globalState.totalRounds = ZERO
    globalState.totalPlayers = ZERO
    globalState.totalBurned = ZERO
    globalState.totalJackpotsPaid = ZERO
    globalState.totalStakerRevenue = ZERO
    globalState.brbTotalSupply = ZERO
    globalState.totalPayouts = ZERO
    globalState.totalDeposited = ZERO
    globalState.totalWithdrawn = ZERO
  }
  return globalState
}

export function calculateSharePrice(totalAssets: BigInt, totalShares: BigInt): BigDecimal {
  if (totalShares.gt(ZERO)) {
    const PRECISION = BigInt.fromI32(10).pow(18)
    return totalAssets
      .times(PRECISION)
      .toBigDecimal()
      .div(totalShares.toBigDecimal())
      .div(PRECISION.toBigDecimal())
  }
  return BigDecimal.fromString("1")
}

export { GLOBAL_STATE_ID }
