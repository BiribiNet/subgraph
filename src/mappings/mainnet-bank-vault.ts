// Mainnet has identified/processed/skipped receipts; the Sepolia entrypoint stays separate.
export * from './bank-vault'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { withdrawalFeeFromReceipt } from '../helpers/withdrawal-fee'
import { loadMarketByBank } from '../helpers/market'
import { getOrCreateGlobalState } from '../helpers/globalState'
import { subtractGrossVaultBalance } from '../helpers/vault-ledger'
import { subtractVaultAssetsTotals } from '../helpers/vaultClassTotals'
import { WithdrawalIdentified, WithdrawalProcessed, WithdrawalSkipped } from '../../generated/templates/BankVault/BankVault4626'
import { ProtocolWithdrawalReceipt } from '../../generated/schema'
import { recordWithdrawalRequested, recordWithdrawalProcessed, recordWithdrawalPayment, handleWithdrawalIdentified as recordProtocolRequest } from './bank-vault'
export function handleWithdrawalIdentified(event: WithdrawalIdentified): void {
  recordWithdrawalRequested(event, event.params.owner, event.params.bps)
  recordProtocolRequest(event)
}
export function handleWithdrawalProcessed(event: WithdrawalProcessed): void {
  const market = loadMarketByBank(event.address)
  if (market != null && event.params.sharesBurned.gt(BigInt.zero())) {
    const state = getOrCreateGlobalState()
    const infra = state.infraRecipient
    assert(infra !== null, 'Withdrawal fee recipient is not indexed')
    const fee = withdrawalFeeFromReceipt(event, event.params.owner, event.params.receiver,
      event.params.assetsPaid, event.params.sharesBurned, Address.fromBytes(market.asset), Address.fromBytes(infra!))
    subtractGrossVaultBalance(market, fee)
    subtractVaultAssetsTotals(market, state, fee)
    market.save()
    state.save()
  }
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
