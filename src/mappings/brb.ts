import { Address, BigInt } from "@graphprotocol/graph-ts"
import { Transfer, Approval } from "../../generated/BRBToken/BRB"
import { BRBTransfer, BRBBurn, RouletteRound, TokenApproval } from "../../generated/schema"
import { updateUserBRBBalance, updateUserLastActive } from "../helpers/user"
import { JACKPOT_TREASURY_ADDRESS, ZERO_ADDRESS } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { marketRoundId, isKnownBank, loadMarketByBank } from "../helpers/market"
import { getOrCreateDailyStats } from "../helpers/aggregation"
import { tryRecordMarketPayoutTransfer } from "../helpers/payout-transfer"
import { addGrossVaultBalance } from "../helpers/vault-ledger"
import { isBankInboundExcludedFromDonation } from "../helpers/tx-activity"
import { findBurnRoundForGlobalRound } from "../helpers/round-sync"

/** BRB wallet balance applies to EOAs only — not vaults, jackpot treasury, or zero address. */
function isBrbWalletAddress(addr: Address): bool {
  const hex = addr.toHexString()
  if (hex == ZERO_ADDRESS) {
    return false
  }
  if (addr.equals(JACKPOT_TREASURY_ADDRESS)) {
    return false
  }
  return !isKnownBank(addr)
}

export function handleTransfer(event: Transfer): void {
  const transfer = new BRBTransfer(event.transaction.hash.concat(bigintToBytes(event.logIndex)))
  transfer.from = event.params.from
  transfer.to = event.params.to
  transfer.value = event.params.value
  transfer.blockNumber = event.block.number
  transfer.timestamp = event.block.timestamp
  transfer.transactionHash = event.transaction.hash
  transfer.save()

  if (isBrbWalletAddress(event.params.from)) {
    updateUserBRBBalance(event.params.from, event.params.value, false)
  }
  if (isBrbWalletAddress(event.params.to)) {
    updateUserBRBBalance(event.params.to, event.params.value, true)
  }

  if (isBrbWalletAddress(event.params.from)) {
    updateUserLastActive(event.params.from, event.block.timestamp)
  }
  if (isBrbWalletAddress(event.params.to)) {
    updateUserLastActive(event.params.to, event.block.timestamp)
  }

  const globalState = getOrCreateGlobalState()

  const fromHex = event.params.from.toHexString()
  const toHex = event.params.to.toHexString()

  if (fromHex == ZERO_ADDRESS) {
    globalState.brbTotalSupply = globalState.brbTotalSupply.plus(event.params.value)
    globalState.save()
    return
  }

  if (event.params.to.equals(JACKPOT_TREASURY_ADDRESS)) {
    globalState.currentJackpot = globalState.currentJackpot.plus(event.params.value)
    const dailyStatsJackpot = getOrCreateDailyStats(event.block.timestamp)
    dailyStatsJackpot.jackpotFunded = dailyStatsJackpot.jackpotFunded.plus(event.params.value)
    dailyStatsJackpot.save()
  }

  if (toHex == ZERO_ADDRESS) {
    const burnId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
    const burn = new BRBBurn(burnId)
    burn.amount = event.params.value
    burn.timestamp = event.block.timestamp
    burn.blockNumber = event.block.number
    burn.transactionHash = event.transaction.hash
    if (globalState.lastRoundPaid.gt(BigInt.fromI32(0))) {
      const burnRound = findBurnRoundForGlobalRound(globalState.lastRoundPaid)
      if (burnRound != null) {
        burn.round = burnRound.id
        burnRound.roundBurnAmount = burnRound.roundBurnAmount.plus(event.params.value)
        burnRound.save()
      }
    }
    burn.save()

    globalState.totalBurned = globalState.totalBurned.plus(event.params.value)
    globalState.brbTotalSupply = globalState.brbTotalSupply.minus(event.params.value)

    const dailyStatsBurn = getOrCreateDailyStats(event.block.timestamp)
    dailyStatsBurn.burnAmount = dailyStatsBurn.burnAmount.plus(event.params.value)
    dailyStatsBurn.save()
  }

  if (isKnownBank(event.params.to)) {
    if (!isBankInboundExcludedFromDonation(event.transaction.hash, event.params.value)) {
      globalState.totalTransfersToPool = globalState.totalTransfersToPool.plus(event.params.value)
      const market = loadMarketByBank(event.params.to)
      if (market != null) {
        market.brbDonations = market.brbDonations.plus(event.params.value)
        addGrossVaultBalance(market, event.params.value)
        market.save()
      }
    }
  }

  tryRecordMarketPayoutTransfer(
    event.params.from,
    event.params.to,
    event.params.value,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
    event.logIndex
  )

  globalState.save()
}

export function handleApproval(event: Approval): void {
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  const approval = new TokenApproval(id)
  approval.token = "BRB"
  approval.owner = event.params.owner
  approval.spender = event.params.spender
  approval.value = event.params.value
  approval.blockNumber = event.block.number
  approval.timestamp = event.block.timestamp
  approval.transactionHash = event.transaction.hash
  approval.save()
}
