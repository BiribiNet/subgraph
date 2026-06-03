import { Transfer } from "../../generated/templates/MarketAsset/ERC20"
import { tryRecordMarketPayoutTransfer } from "../helpers/payout-transfer"

/** Market ERC-20 Transfer (USDC, etc.): per-winner vault payouts during settlement. */
export function handleMarketAssetTransfer(event: Transfer): void {
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
