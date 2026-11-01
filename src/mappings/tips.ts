import { BigInt } from "@graphprotocol/graph-ts"
import { TipSent } from "../../generated/templates/TipJar/TipJar"
import { Tip, TipTotal } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"
import { BRB_TOKEN_ADDRESS, ZERO_ADDRESS } from "../helpers/constant"
import { getOrCreateUser, updateUserLastActive } from "../helpers/user"
import { recomputeAndSaveUserPoints } from "../helpers/brb-points"

export function handleTipSent(event: TipSent): void {
  if (event.params.amount.le(BigInt.zero())) return
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))
  if (Tip.load(id) != null) return
  const tip = new Tip(id)
  tip.jar = event.address
  tip.sender = event.params.sender
  tip.token = event.params.token
  tip.recipient = event.params.recipient
  tip.amount = event.params.amount
  tip.timestamp = event.block.timestamp
  tip.blockNumber = event.block.number
  tip.transactionHash = event.transaction.hash
  tip.save()

  // Never mix deployments, assets or destinations.
  const totalId = event.address.concat(event.params.token).concat(event.params.recipient)
  let total = TipTotal.load(totalId)
  if (total == null) {
    total = new TipTotal(totalId)
    total.jar = event.address
    total.token = event.params.token
    total.recipient = event.params.recipient
    total.amount = BigInt.zero()
    total.count = BigInt.zero()
  }
  total.amount = total.amount.plus(event.params.amount)
  total.count = total.count.plus(BigInt.fromI32(1))
  total.updatedAt = event.block.timestamp
  total.save()

  // Only explicitly configured TipJar sources reach this handler. The immutable
  // router emits TipSent after receiving the exact transfer. Ordinary Transfer,
  // approval, fees and deposits never award tip points. Dedup above precedes all
  // user accounting; The Graph rolls it back with the source event on reorg.
  if (!event.params.token.equals(BRB_TOKEN_ADDRESS)
    || event.params.sender.toHexString() == ZERO_ADDRESS
    || event.params.recipient.toHexString() == ZERO_ADDRESS
    || event.params.sender.equals(event.params.recipient)) return
  updateUserLastActive(event.params.sender, event.block.timestamp)
  const user = getOrCreateUser(event.params.sender)
  user.totalTipsSent = user.totalTipsSent.plus(event.params.amount)
  user.tipCount = user.tipCount.plus(BigInt.fromI32(1))
  recomputeAndSaveUserPoints(user, event.block.timestamp)
}
