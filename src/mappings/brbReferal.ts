import { Transfer } from "../../generated/BRBReferal/BRBReferal"
import { BRBReferalTransfer } from "../../generated/schema"
import { updateUserBRBReferalBalance } from "../helpers/user"
import { bigintToBytes } from "../helpers/bigintToBytes"

export function handleTransfer(event: Transfer): void {
  // Skip mint (from zero address) and burn (to zero address) for balance tracking
  // but still create transfer entities for them
  const fromIsZero = event.params.from.toHexString() == "0x0000000000000000000000000000000000000000"
  const toIsZero = event.params.to.toHexString() == "0x0000000000000000000000000000000000000000"

  // Update user balances (skip zero addresses)
  if (!fromIsZero) {
    updateUserBRBReferalBalance(event.params.from, event.params.value, false) // Subtract from sender
    
    // Create transfer entity for sender (debit)
    const transferIdFrom = event.transaction.hash.concat(bigintToBytes(event.logIndex)).concat(event.params.from)
    const transferFrom = new BRBReferalTransfer(transferIdFrom)
    transferFrom.user = event.params.from
    transferFrom.from = event.params.from
    transferFrom.to = event.params.to
    transferFrom.value = event.params.value
    transferFrom.isCredit = false
    transferFrom.blockNumber = event.block.number
    transferFrom.timestamp = event.block.timestamp
    transferFrom.transactionHash = event.transaction.hash
    transferFrom.save()
  }

  if (!toIsZero) {
    updateUserBRBReferalBalance(event.params.to, event.params.value, true)   // Add to receiver
    
    // Create transfer entity for receiver (credit)
    const transferIdTo = event.transaction.hash.concat(bigintToBytes(event.logIndex)).concat(event.params.to)
    const transferTo = new BRBReferalTransfer(transferIdTo)
    transferTo.user = event.params.to
    transferTo.from = event.params.from
    transferTo.to = event.params.to
    transferTo.value = event.params.value
    transferTo.isCredit = true
    transferTo.blockNumber = event.block.number
    transferTo.timestamp = event.block.timestamp
    transferTo.transactionHash = event.transaction.hash
    transferTo.save()
  }
}
