// Mainnet has identified/processed/skipped receipts; the Sepolia entrypoint stays separate.
export * from './bank-vault'
import { BigInt } from '@graphprotocol/graph-ts'
import { WithdrawalIdentified, WithdrawalProcessed, WithdrawalSkipped } from '../../generated/templates/BankVault/BankVault4626'
import { ProtocolWithdrawalReceipt } from '../../generated/schema'
import { recordWithdrawalRequested, recordWithdrawalProcessed, recordWithdrawalPayment, handleWithdrawalIdentified as recordProtocolRequest } from './bank-vault'
export function handleWithdrawalIdentified(event: WithdrawalIdentified): void {
  recordWithdrawalRequested(event, event.params.owner, event.params.bps)
  recordProtocolRequest(event)
}
export function handleWithdrawalProcessed(event: WithdrawalProcessed): void {
  recordWithdrawalProcessed(event, event.params.owner, event.params.assetsPaid, event.params.sharesBurned)
  recordWithdrawalPayment(event, event.params.requestId, event.params.owner, event.params.assetsPaid, event.params.sharesBurned)
}
export function handleWithdrawalSkipped(event: WithdrawalSkipped): void {
  recordWithdrawalProcessed(event, event.params.owner, BigInt.zero(), BigInt.zero())
  const id = event.address.toHexString() + '-' + event.params.requestId.toString()
  const row = ProtocolWithdrawalReceipt.load(id)
  if (row != null) {
    row.processedAt = event.block.timestamp
    row.assetsPaid = BigInt.zero()
    row.sharesBurned = BigInt.zero()
    row.save() // A skipped transfer has no payment transaction.
  }
}
