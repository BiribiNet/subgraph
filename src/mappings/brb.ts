import { Bytes, BigInt } from "@graphprotocol/graph-ts"
import { Transfer } from "../../generated/BRBToken/BRB"
import { BRBTransfer, GlobalState, RouletteRound, RouletteBet, PayoutTransaction } from "../../generated/schema"
import { updateUserBRBBalance, updateUserRouletteStats } from "../helpers/user"
import { ROUND_STATUS_PAYOUT } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"

const GLOBAL_STATE_ID = Bytes.fromHexString("0x0000000000000000000000000000000000000001") // Singleton ID for global state

function getOrCreateGlobalState(): GlobalState {
  let globalState = GlobalState.load(GLOBAL_STATE_ID)
  if (!globalState) {
    globalState = new GlobalState(GLOBAL_STATE_ID)
    globalState.currentRound = BigInt.fromI32(1)
    globalState.lastRoundStartTime = BigInt.fromI32(0)
    globalState.lastRoundPaid = BigInt.fromI32(0)
    globalState.gamePeriod = BigInt.fromI32(60) // Default 60 seconds
    globalState.totalBets = BigInt.fromI32(0)
    globalState.totalPayouts = BigInt.fromI32(0)
    globalState.protocolFeeBasisPoints = BigInt.fromI32(250) // Default 2.5%
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

export function handleTransfer(event: Transfer): void {
  // Create transfer entity
  const transfer = new BRBTransfer(event.transaction.hash.concat(bigintToBytes(event.logIndex)))
  transfer.from = event.params.from
  transfer.to = event.params.to
  transfer.value = event.params.value
  transfer.blockNumber = event.block.number
  transfer.timestamp = event.block.timestamp
  transfer.transactionHash = event.transaction.hash
  transfer.save()

  // Update user balances
  updateUserBRBBalance(event.params.from, event.params.value, false) // Subtract from sender
  updateUserBRBBalance(event.params.to, event.params.value, true)   // Add to receiver

  // Check if this is a payout transfer (from StakedBRB contract to a user)
  // Skip if this is a mint (from zero address) or burn (to zero address)
  if (event.params.from.toHexString() == "0x0000000000000000000000000000000000000000" || 
      event.params.to.toHexString() == "0x0000000000000000000000000000000000000000") {
    return
  }

  // Check if this transfer is from the StakedBRB contract to a user (potential payout)
  // We need to check if the from address is the StakedBRB contract
  // For now, we'll check if it's during a payout phase
  const globalState = getOrCreateGlobalState()
  const currentRound = RouletteRound.load(bigintToBytes(globalState.currentRound.minus(BigInt.fromI32(1))))
  
  if (currentRound && currentRound.status == ROUND_STATUS_PAYOUT) {
    // Get the corresponding RouletteBet entity first
    const bet = RouletteBet.load(event.params.to.concat(bigintToBytes(globalState.currentRound.minus(BigInt.fromI32(1)))))
    
    if (bet) {
      // This looks like a payout transfer
      const payoutId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
      const payoutTx = new PayoutTransaction(payoutId)
      payoutTx.user = event.params.to
      payoutTx.round = currentRound.id
      payoutTx.bet = bet.id
      payoutTx.amount = event.params.value
      payoutTx.blockNumber = event.block.number
      payoutTx.timestamp = event.block.timestamp
      payoutTx.transactionHash = event.transaction.hash
      payoutTx.save()

      // Update the corresponding RouletteBet entity
      const currentPayout = bet.actualPayout
      if (currentPayout) {
        bet.actualPayout = currentPayout.plus(event.params.value)
      } else {
        bet.actualPayout = event.params.value
      }
      bet.save()

      // Update round totals
      currentRound.totalPayouts = currentRound.totalPayouts.plus(event.params.value)
      currentRound.save()

      // Update global totals
      globalState.totalPayouts = globalState.totalPayouts.plus(event.params.value)
      globalState.save()

      // Update user roulette stats (win)
      updateUserRouletteStats(event.params.to, event.params.value, true, false)
    }
  }
}
