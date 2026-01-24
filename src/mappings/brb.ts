import { Address, BigInt } from "@graphprotocol/graph-ts"
import { Transfer } from "../../generated/BRBToken/BRB"
import { BRBTransfer, RouletteRound, RouletteBet, PayoutTransaction, JackpotPayout, WithdrawTransaction } from "../../generated/schema"
import { updateUserBRBBalance, updateUserRouletteStats } from "../helpers/user"
import { JACKPOT_CONTRACT_ADDRESS, ROUND_STATUS_PAYOUT, STAKED_BRB_CONTRACT_ADDRESS, ZERO_ADDRESS } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"

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
  if (event.params.from.toHexString() == ZERO_ADDRESS || 
      event.params.to.toHexString() == ZERO_ADDRESS) {
    return
  }

  // Check if this transfer is from the StakedBRB contract to a user (potential payout)
  // We need to check if the from address is the StakedBRB contract
  // For now, we'll check if it's during a payout phase
  const globalState = getOrCreateGlobalState()

  if (event.params.from.equals(Address.fromString(STAKED_BRB_CONTRACT_ADDRESS))) { 
    if (event.params.to.equals(Address.fromString(JACKPOT_CONTRACT_ADDRESS))) {
      // Jackpot increased
      globalState.currentJackpot = globalState.currentJackpot.plus(event.params.value)
    } else if (event.params.to.equals(Address.fromBytes(globalState.feeRecipient))) {
      // Protocol fee increased
      globalState.totalFees = globalState.totalFees.plus(event.params.value)
    } else if (event.params.to.equals(Address.fromString(ZERO_ADDRESS))) {
      // Burned
      globalState.totalBurned = globalState.totalBurned.plus(event.params.value)
    }
  }
  const currentRound = RouletteRound.load(bigintToBytes(globalState.currentRoundNumber.minus(BigInt.fromI32(1))))
  
  if (currentRound && currentRound.status == ROUND_STATUS_PAYOUT) {
    // Get the corresponding RouletteBet entity first
    const bet = RouletteBet.load(event.params.to.concat(bigintToBytes(globalState.currentRoundNumber.minus(BigInt.fromI32(1)))))
    
    if (bet !== null) {
      const payoutId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
      if (event.params.from.equals(Address.fromString(JACKPOT_CONTRACT_ADDRESS))) {
        // This looks like a jackpot payout transfer
        const jackpotPayoutTx = new JackpotPayout(payoutId)
        jackpotPayoutTx.user = event.params.to;
        jackpotPayoutTx.round = currentRound.id
        jackpotPayoutTx.bet = bet.id
        jackpotPayoutTx.amount = event.params.value
        jackpotPayoutTx.blockNumber = event.block.number
        jackpotPayoutTx.timestamp = event.block.timestamp
        jackpotPayoutTx.transactionHash = event.transaction.hash
        jackpotPayoutTx.save()
        globalState.currentJackpot = globalState.currentJackpot.minus(event.params.value)
        globalState.totalPayouts = globalState.totalPayouts.plus(event.params.value)
        updateUserRouletteStats(event.params.to, event.params.value, true, true)
      } else if (event.params.from.equals(Address.fromString(STAKED_BRB_CONTRACT_ADDRESS))) {
        const withdrawTx = WithdrawTransaction.load(event.transaction.hash);
        if (withdrawTx === null) { // if we are in a withdraw scenario exit
          // This looks like a payout transfer
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
          if (currentPayout !== null) {
            bet.actualPayout = currentPayout.plus(event.params.value)
          } else {
            bet.actualPayout = event.params.value
          }
  
          // Update round totals
          currentRound.totalPayouts = currentRound.totalPayouts.plus(event.params.value)
          // Update global totals
          globalState.totalPayouts = globalState.totalPayouts.plus(event.params.value)
          updateUserRouletteStats(event.params.to, event.params.value, true, true)
        }
      }
      bet.save()

      currentRound.save()

      globalState.save()

      // Update user roulette stats (win)
    }
  }
}
