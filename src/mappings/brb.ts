import { Address, Bytes, log } from "@graphprotocol/graph-ts"
import { BRB, Transfer, Approval } from "../../generated/BRBToken/BRB"
import { BRBTransfer, BRBBurn, GlobalState, PendingBrbBurn, TokenApproval } from "../../generated/schema"
import { updateUserBRBBalance, updateUserLastActive } from "../helpers/user"
import { JACKPOT_TREASURY_ADDRESS, ZERO_ADDRESS } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { getOrCreateGlobalState } from "../helpers/globalState"
import { ZERO } from "../helpers/number"
import { isKnownBank, loadMarketByBank } from "../helpers/market"
import { getOrCreateDailyStats } from "../helpers/aggregation"
import { tryRecordMarketPayoutTransfer } from "../helpers/payout-transfer"
import { addGrossVaultBalance } from "../helpers/vault-ledger"
import { calculateMarketAPYs } from "../helpers/marketApy"
import { isBankInboundExcludedFromDonation, recordTxBrbDonation } from "../helpers/tx-activity"

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

/**
 * BRB was minted before the manifest's startBlock, so the mint/burn deltas alone drove
 * `brbTotalSupply` negative (it read -607 BRB against an on-chain supply of ~3M). Seed it from the
 * token the first time a non-mint transfer is seen, then let the deltas carry it. This is the one
 * eth_call in the BRB mapping and it fires once per subgraph lifetime: a transfer can only exist
 * once supply is non-zero, so the guard never re-arms.
 */
function seedBrbTotalSupplyOnce(globalState: GlobalState, token: Address): void {
  if (globalState.brbTotalSupply.notEqual(ZERO)) {
    return
  }
  const supply = BRB.bind(token).try_totalSupply()
  if (supply.reverted) {
    log.warning("BRB totalSupply() reverted while seeding the supply baseline", [])
    return
  }
  globalState.brbTotalSupply = supply.value
}

/** Appends a burn to its transaction's attribution queue (see PendingBrbBurn). */
function enqueueBurnForAttribution(transactionHash: Bytes, burnId: Bytes): void {
  let pending = PendingBrbBurn.load(transactionHash)
  if (pending == null) {
    pending = new PendingBrbBurn(transactionHash)
    pending.burnIds = new Array<Bytes>(0)
    pending.cursor = 0
  }
  const burnIds = pending.burnIds
  burnIds.push(burnId)
  pending.burnIds = burnIds
  pending.save()
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

  // Credited before the mint short-circuit below: BRB reaches the treasury both
  // as a BRBJackpotFunder transfer and (potentially) as a direct mint, and both
  // grow the pool.
  if (event.params.to.equals(JACKPOT_TREASURY_ADDRESS)) {
    globalState.currentJackpot = globalState.currentJackpot.plus(event.params.value)
    const dailyStatsJackpot = getOrCreateDailyStats(event.block.timestamp)
    dailyStatsJackpot.jackpotFunded = dailyStatsJackpot.jackpotFunded.plus(event.params.value)
    // `jackpotPool` is an end-of-day snapshot, not an accumulator: stamp the
    // post-mutation pool and let the last write of the day win.
    dailyStatsJackpot.jackpotPool = globalState.currentJackpot
    dailyStatsJackpot.save()
  }

  if (fromHex == ZERO_ADDRESS) {
    globalState.brbTotalSupply = globalState.brbTotalSupply.plus(event.params.value)
    globalState.save()
    return
  }

  seedBrbTotalSupplyOnce(globalState, event.address)

  if (toHex == ZERO_ADDRESS) {
    const burnId = event.transaction.hash.concat(bigintToBytes(event.logIndex))
    const burn = new BRBBurn(burnId)
    burn.amount = event.params.value
    burn.timestamp = event.block.timestamp
    burn.blockNumber = event.block.number
    burn.transactionHash = event.transaction.hash
    burn.save()
    // The round is not knowable yet — the funder burns before anything names the settlement it
    // belongs to. Queue it for the JackpotFunded event later in this same transaction; guessing
    // from `lastRoundPaid` here attributed every burn to the previous round, and to whichever
    // market happened to be scanned first.
    enqueueBurnForAttribution(event.transaction.hash, burnId)

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
        // Remember what was booked, so the vault event later in this transaction can undo
        // exactly this and never more — see `consumeTxBrbDonation`.
        recordTxBrbDonation(event.transaction.hash, event.params.to, event.params.value)
        calculateMarketAPYs(market, event.block.timestamp, event.block.number)
        market.save()
      }
    }
  }

  // Flush before tryRecordMarketPayoutTransfer: that helper loads and saves its
  // own GlobalState copy, so saving here afterwards would clobber its jackpot
  // and payout writes.
  globalState.save()

  tryRecordMarketPayoutTransfer(
    event.params.from,
    event.params.to,
    event.params.value,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
    event.logIndex
  )
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
