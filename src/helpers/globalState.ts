import { Bytes, BigInt, BigDecimal } from "@graphprotocol/graph-ts"
import { GlobalState, ProtocolStats } from "../../generated/schema"
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

export function getOrCreateProtocolStats(): ProtocolStats {
  let stats = ProtocolStats.load("stats")
  if (!stats) {
    stats = new ProtocolStats("stats")
    stats.totalWagered = ZERO
    stats.totalBets = ZERO
    stats.totalRounds = ZERO
    stats.totalPlayers = ZERO
    stats.totalBurned = ZERO
    stats.totalJackpotsPaid = ZERO
    stats.totalStakerRevenue = ZERO
    stats.brbTotalSupply = ZERO
    stats.totalPayouts = ZERO
    stats.totalDeposited = ZERO
    stats.totalWithdrawn = ZERO
  }
  return stats
}

export { GLOBAL_STATE_ID }
