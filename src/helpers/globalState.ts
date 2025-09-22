import { Bytes, BigInt } from "@graphprotocol/graph-ts"
import { GlobalState } from "../../generated/schema"

const GLOBAL_STATE_ID = Bytes.fromHexString("0x0000000000000000000000000000000000000001") // Singleton ID for global state

export function getOrCreateGlobalState(): GlobalState {
  let globalState = GlobalState.load(GLOBAL_STATE_ID)
  if (!globalState) {
    globalState = new GlobalState(GLOBAL_STATE_ID)
    globalState.currentRound = BigInt.fromI32(1)
    globalState.lastRoundStartTime = BigInt.fromI32(0)
    globalState.lastRoundPaid = BigInt.fromI32(0)
    globalState.gamePeriod = BigInt.fromI32(120) // Default 60 seconds
    globalState.totalBets = BigInt.fromI32(0)
    globalState.totalPayouts = BigInt.fromI32(0)
    globalState.protocolFeeBasisPoints = BigInt.fromI32(300) // Default 3%
    globalState.jackpotFeeBasisPoints = BigInt.fromI32(150) // Default 1.5%
    globalState.burnFeeBasisPoints = BigInt.fromI32(50) // Default 0.5%
    globalState.feeRecipient = Bytes.fromHexString("0x0000000000000000000000000000000000000000")
    globalState.totalAssets = BigInt.fromI32(0)
    globalState.totalShares = BigInt.fromI32(0)
    globalState.pendingBets = BigInt.fromI32(0)
    globalState.lastRoundResolved = BigInt.fromI32(0)
    globalState.roundTransitionInProgress = false
    globalState.largeWithdrawalBatchSize = BigInt.fromI32(5)
    globalState.maxQueueLength = BigInt.fromI32(100)
    globalState.totalPendingLargeWithdrawals = BigInt.fromI32(0)
    globalState.totalFees = BigInt.fromI32(0)
  }
  return globalState
}

export { GLOBAL_STATE_ID }
