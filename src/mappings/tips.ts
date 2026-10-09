import { BigInt } from "@graphprotocol/graph-ts"
import { TipSent } from "../../generated/templates/TipJar/TipJar"
import { Tip, TipTotal } from "../../generated/schema"
import { bigintToBytes } from "../helpers/bigintToBytes"

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

  // Never mix deployments, assets or destinations. No game or BRBP accounting.
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
}
