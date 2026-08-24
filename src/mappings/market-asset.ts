import { Transfer } from "../../generated/BRBToken/BRB"
import { tryRecordMarketPayoutTransfer } from "../helpers/payout-transfer"

/**
 * Per-winner payout attribution for a market whose asset is not BRB.
 *
 * Only the BRB token has a static ERC-20 data source, and per-bet settlement is only ever visible
 * as the asset's own `Transfer(bank -> winner)` — no engine or vault event names the winner and the
 * amount (`PayoutProgress` and `PayoutBatchProcessed` are both aggregates). Without this template a
 * USDC or DAI winner was never credited: `won` stayed false, `actualPayout` stayed zero, and since
 * `totalLost` is derived as `totalRouletteBets - totalWon`, every one of their bets was booked as a
 * total loss — which also dragged their BRBpoints, and so their DAO voting weight, down with it.
 *
 * Instantiated per market from `processMarketRegistered`, skipping BRB so its transfers are not
 * counted twice. The ABI is BRB's only because it is a plain ERC-20 `Transfer` — nothing here is
 * BRB-specific.
 */
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
