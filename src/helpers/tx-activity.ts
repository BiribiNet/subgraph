import { BigInt, Bytes, store } from "@graphprotocol/graph-ts"
import { TxActivity, TxBrbDonation } from "../../generated/schema"
import { ZERO } from "./number"

export function getOrCreateTxActivity(txHash: Bytes): TxActivity {
  let ctx = TxActivity.load(txHash)
  if (ctx == null) {
    ctx = new TxActivity(txHash)
    ctx.betToBank = ZERO
    ctx.betToBankForReferral = ZERO
    ctx.depositToBank = ZERO
    ctx.betMarketId = 0
  }
  return ctx
}

/**
 * Mark bet funds heading into a bank, so the inbound `Transfer` later in this transaction is not
 * booked as a donation.
 *
 * Kept separate from `recordTxBetForReferral` because the two have different preconditions: the
 * tokens move whatever the subgraph decides to do with the bet, whereas crediting a referrer is
 * only right for a bet the subgraph actually recorded.
 */
export function recordTxBetToBank(txHash: Bytes, amount: BigInt, marketId: i32): void {
  const ctx = getOrCreateTxActivity(txHash)
  ctx.betToBank = ctx.betToBank.plus(amount)
  ctx.betMarketId = marketId
  ctx.save()
}

/**
 * Seed the referral-credit scratch. Deliberately a second counter rather than a read of
 * `betToBank`: the donation path consumes that one, so a single counter let the two drain each
 * other within one transaction.
 */
export function recordTxBetForReferral(txHash: Bytes, amount: BigInt): void {
  const ctx = getOrCreateTxActivity(txHash)
  ctx.betToBankForReferral = ctx.betToBankForReferral.plus(amount)
  ctx.save()
}

export function recordTxDepositToBank(txHash: Bytes, amount: BigInt): void {
  const ctx = getOrCreateTxActivity(txHash)
  ctx.depositToBank = ctx.depositToBank.plus(amount)
  ctx.save()
}

/** True when this inbound bank transfer should not count as a donation. */
export function isBankInboundExcludedFromDonation(txHash: Bytes, amount: BigInt): boolean {
  const ctx = TxActivity.load(txHash)
  if (ctx == null) {
    return false
  }
  if (ctx.betToBank.ge(amount)) {
    ctx.betToBank = ctx.betToBank.minus(amount)
    ctx.save()
    return true
  }
  if (ctx.depositToBank.ge(amount)) {
    ctx.depositToBank = ctx.depositToBank.minus(amount)
    ctx.save()
    return true
  }
  return false
}

export function consumeTxBetForReferral(txHash: Bytes): BigInt {
  const ctx = TxActivity.load(txHash)
  if (ctx == null || ctx.betToBankForReferral.equals(ZERO)) {
    return ZERO
  }
  const amount = ctx.betToBankForReferral
  ctx.betToBankForReferral = ZERO
  ctx.save()
  return amount
}

export function getTxBetMarketId(txHash: Bytes): i32 {
  const ctx = TxActivity.load(txHash)
  if (ctx == null) {
    return 0
  }
  return ctx.betMarketId
}

function txBrbDonationId(txHash: Bytes, bank: Bytes): Bytes {
  return txHash.concat(bank)
}

/**
 * Record BRB that `brb.ts` actually booked as a donation into `bank` during this transaction.
 *
 * The undo path runs from a vault event that fires *after* the ERC-20 `Transfer`, so it cannot
 * observe the booking directly. Without this record it inferred one from the amount alone and
 * could unwind a donation it never booked.
 */
export function recordTxBrbDonation(txHash: Bytes, bank: Bytes, amount: BigInt): void {
  const id = txBrbDonationId(txHash, bank)
  let booked = TxBrbDonation.load(id)
  if (booked == null) {
    booked = new TxBrbDonation(id)
    booked.amount = ZERO
  }
  booked.amount = booked.amount.plus(amount)
  booked.save()
}

/** Consume up to `amount` of the donation booked for this (transaction, bank), and return it. */
export function consumeTxBrbDonation(txHash: Bytes, bank: Bytes, amount: BigInt): BigInt {
  const id = txBrbDonationId(txHash, bank)
  const booked = TxBrbDonation.load(id)
  if (booked == null) {
    return ZERO
  }
  const consumed = booked.amount.lt(amount) ? booked.amount : amount
  const remaining = booked.amount.minus(consumed)
  if (remaining.equals(ZERO)) {
    store.remove("TxBrbDonation", id.toHexString())
  } else {
    booked.amount = remaining
    booked.save()
  }
  return consumed
}
