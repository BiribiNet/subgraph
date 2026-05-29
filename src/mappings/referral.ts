import { Transfer } from "../../generated/BRBReferral/BRBReferral"
import { BRBReferalTransfer } from "../../generated/schema"
import {
  getOrCreateUser,
  updateUserBrbrEarnings,
  updateUserBRBReferalBalance,
  updateUserLastActive,
} from "../helpers/user"
import { ZERO_ADDRESS } from "../helpers/constant"
import { bigintToBytes } from "../helpers/bigintToBytes"

// BRBReferral is the (legacy) referral token, surfaced in Phase 2 as the
// soulbound `BRBr` component of BRBpoints. Referral rewards reach a referrer as
// a credit (Transfer `to` the referrer); a `to == 0x0` transfer is a burn /
// clean exit. The `from` address on a credit is recorded as-is so the frontend
// can attribute the referee. Holder-to-holder transfers don't occur for a
// soulbound token, so no sender balance is moved on the credit path.
export function handleTransfer(event: Transfer): void {
  const from = event.params.from
  const to = event.params.to
  const value = event.params.value
  const timestamp = event.block.timestamp
  const id = event.transaction.hash.concat(bigintToBytes(event.logIndex))

  // Burn / clean exit: the holder destroys their BRBr.
  if (to.toHexString() == ZERO_ADDRESS) {
    if (from.toHexString() != ZERO_ADDRESS) {
      const burn = new BRBReferalTransfer(id)
      burn.user = from
      burn.from = from
      burn.to = to
      burn.value = value
      burn.isCredit = false
      burn.blockNumber = event.block.number
      burn.timestamp = timestamp
      burn.transactionHash = event.transaction.hash
      burn.save()

      updateUserBrbrEarnings(from, value, false, timestamp)
      updateUserBRBReferalBalance(from, value, false)
      updateUserLastActive(from, timestamp)
    }
    return
  }

  // Credit: the referrer receives soulbound BRBr (feeds their BRBpoints).
  getOrCreateUser(to)

  const credit = new BRBReferalTransfer(id)
  credit.user = to
  credit.from = from
  credit.to = to
  credit.value = value
  credit.isCredit = true
  credit.blockNumber = event.block.number
  credit.timestamp = timestamp
  credit.transactionHash = event.transaction.hash
  credit.save()

  updateUserBrbrEarnings(to, value, true, timestamp)
  updateUserBRBReferalBalance(to, value, true)
  updateUserLastActive(to, timestamp)
}
