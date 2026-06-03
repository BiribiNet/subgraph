import { BigInt } from "@graphprotocol/graph-ts"
import { Market } from "../../generated/schema"
import { ZERO } from "./number"

export function releasePendingBets(market: Market, amount: BigInt): void {
  if (amount.equals(ZERO)) {
    return
  }
  if (market.pendingBets.le(amount)) {
    market.pendingBets = ZERO
  } else {
    market.pendingBets = market.pendingBets.minus(amount)
  }
  market.save()
}

export function clearMarketPendingBets(market: Market): void {
  market.pendingBets = ZERO
  market.save()
}
