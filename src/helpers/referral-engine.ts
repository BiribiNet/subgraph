import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { getOrCreateUser, updateUserBrbrEarnings, normalizeAmountTo18 } from "./user"
import { consumeTxBetForReferral, getTxBetMarketId } from "./tx-activity"
import { requireMarket } from "./market"
import { ZERO } from "./number"

export function processReferralSet(
  player: Bytes,
  referrer: Bytes,
  txHash: Bytes,
  timestamp: BigInt
): void {
  const user = getOrCreateUser(player)
  if (!user.referrer) {
    getOrCreateUser(referrer)
    user.referrer = referrer
    user.referralSetAt = timestamp
    user.save()
  }

  const betAmount = consumeTxBetForReferral(txHash)
  if (betAmount.gt(ZERO)) {
    const marketId = getTxBetMarketId(txHash)
    if (marketId > 0) {
      const market = requireMarket(marketId)
      updateUserBrbrEarnings(
        referrer,
        normalizeAmountTo18(betAmount, market.assetDecimals),
        true,
        timestamp
      )
    }
  }
}
