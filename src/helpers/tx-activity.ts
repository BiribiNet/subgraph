import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { TxActivity } from "../../generated/schema"
import { ZERO } from "./number"

export function getOrCreateTxActivity(txHash: Bytes): TxActivity {
  let ctx = TxActivity.load(txHash)
  if (ctx == null) {
    ctx = new TxActivity(txHash)
    ctx.betToBank = ZERO
    ctx.depositToBank = ZERO
    ctx.betMarketId = 0
  }
  return ctx
}

export function recordTxBetToBank(txHash: Bytes, amount: BigInt, marketId: i32): void {
  const ctx = getOrCreateTxActivity(txHash)
  ctx.betToBank = ctx.betToBank.plus(amount)
  ctx.betMarketId = marketId
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
  if (ctx == null || ctx.betToBank.equals(ZERO)) {
    return ZERO
  }
  const amount = ctx.betToBank
  ctx.betToBank = ZERO
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
