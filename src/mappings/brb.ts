import { BigInt } from "@graphprotocol/graph-ts"
import { Transfer } from "../../generated/BRBToken/BRB"
import { BRBTransfer, BRBBurn, RouletteRound, RouletteBet, PayoutTransaction, JackpotPayout, WithdrawTransaction } from "../../generated/schema"
import { updateUserBRBBalance, updateUserRouletteStats } from "../helpers/user"
import { JACKPOT_CONTRACT_ADDRESS, ROUND_STATUS_COMPUTING_PAYOUT, ROUND_STATUS_PAYOUT, STAKED_BRB_CONTRACT_ADDRESS, ZERO_ADDRESS } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { getOrCreateDailyStats } from "../helpers/aggregation"

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

  const globalState = getOrCreateGlobalState()

  const fromHex = event.params.from.toHexString()
  const toHex = event.params.to.toHexString();

  if (fromHex == ZERO_ADDRESS) {
    return
  }

  if (toHex == JACKPOT_CONTRACT_ADDRESS) {
    globalState.currentJackpot = globalState.currentJackpot.plus(event.params.value)
    const dailyStatsJackpot = getOrCreateDailyStats(event.block.timestamp)
    dailyStatsJackpot.jackpotFunded = dailyStatsJackpot.jackpotFunded.plus(event.params.value)
    dailyStatsJackpot.save()
  }

  if (toHex == ZERO_ADDRESS) {
    // Burned
    globalState.totalBurned = globalState.totalBurned.plus(event.params.value)

    // Create individual burn record
    const burnId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
    const burn = new BRBBurn(burnId)
    burn.amount = event.params.value
    burn.timestamp = event.block.timestamp
    burn.blockNumber = event.block.number
    burn.transactionHash = event.transaction.hash
    // Associate with current round if possible
    if (globalState.currentRoundNumber.gt(BigInt.fromI32(1))) {
      const prevRoundId = bigintToBytes(globalState.currentRoundNumber.minus(BigInt.fromI32(1)))
      const prevRound = RouletteRound.load(prevRoundId)
      if (prevRound != null) {
        burn.round = prevRound.id
      }
    }
    burn.save()

    // Update DailyStats burn tracking
    const dailyStatsBurn = getOrCreateDailyStats(event.block.timestamp)
    dailyStatsBurn.burnAmount = dailyStatsBurn.burnAmount.plus(event.params.value)
    dailyStatsBurn.save()
  }

  // Track BRB transfers TO StakedBRB contract (for donation calculation)
  if (toHex == STAKED_BRB_CONTRACT_ADDRESS) {
    // Track cumulative transfers to pool in GlobalState
    globalState.totalTransfersToPool = globalState.totalTransfersToPool.plus(event.params.value)
  }

  if (globalState.currentRoundNumber.gt(BigInt.fromI32(1))) {
    const currentRound = RouletteRound.load(bigintToBytes(globalState.currentRoundNumber.minus(BigInt.fromI32(1))))

    if (currentRound != null && (currentRound.status == ROUND_STATUS_COMPUTING_PAYOUT || currentRound.status == ROUND_STATUS_PAYOUT)) {
      // Get the corresponding RouletteBet entity first
      const bet = RouletteBet.load(event.params.to.concat(bigintToBytes(globalState.currentRoundNumber.minus(BigInt.fromI32(1)))))

      if (bet != null) {
        const payoutId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
        if (fromHex == JACKPOT_CONTRACT_ADDRESS) {
          // Jackpot payout transfer
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
          bet.won = true
        } else if (fromHex == STAKED_BRB_CONTRACT_ADDRESS) {
          const withdrawTx = WithdrawTransaction.load(event.transaction.hash);
          if (withdrawTx == null) { // if we are in a withdraw scenario exit
            // Regular payout transfer
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
            bet.won = true

            // Update round totals
            currentRound.totalPayouts = currentRound.totalPayouts.plus(event.params.value)
            // Update global totals
            globalState.totalPayouts = globalState.totalPayouts.plus(event.params.value)
            updateUserRouletteStats(event.params.to, event.params.value, true, true)
          }
        }

        // Update DailyStats with payout in real-time
        const dailyStatsPayout = getOrCreateDailyStats(event.block.timestamp)
        dailyStatsPayout.totalPayouts = dailyStatsPayout.totalPayouts.plus(event.params.value)
        dailyStatsPayout.save()

        bet.save()
        currentRound.save()
      }
    }
  }
  globalState.save()
}
