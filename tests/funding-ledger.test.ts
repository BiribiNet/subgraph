import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as'
import { FundingReconciled, FundingRetryScheduled, FundingRetryReset } from '../generated/BRBJackpotFunder/BRBJackpotFunder'
import { handleFundingReconciled, handleFundingRetryScheduled, handleFundingRetryReset } from '../src/mappings/jackpot-funder'

const FUNDER = Address.fromString('0x1111111111111111111111111111111111111111')
const ASSET = Address.fromString('0x2222222222222222222222222222222222222222')
const ID = FUNDER.toHexString() + '-1'
function event(): FundingReconciled {
  const e = changetype<FundingReconciled>(newMockEvent())
  e.address = FUNDER
  e.parameters = [new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
    new ethereum.EventParam('asset', ethereum.Value.fromAddress(ASSET))]
  const names = ['credited', 'processed', 'queued', 'brbProduced', 'treasuryPaid', 'burned', 'pendingTreasury', 'pendingBurn']
  const values = [100, 40, 60, 300, 200, 50, 30, 20]
  for (let i = 0; i < names.length; i++) e.parameters.push(new ethereum.EventParam(names[i], ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(values[i]))))
  return e
}
describe('Funding vault ledger', () => {
  beforeEach(() => clearStore())
  test('keeps raw input and BRB output in two separate conservation equations', () => {
    handleFundingReconciled(event())
    assert.fieldEquals('FundingVaultBalance', ID, 'balanced', 'true')
    assert.fieldEquals('FundingVaultBalance', ID, 'queued', '60')
    assert.fieldEquals('FundingVaultBalance', ID, 'pendingBurn', '20')
    assert.entityCount('FundingLedgerSnapshot', 1)
  })
  test('records an accounting gap rather than masking it', () => {
    const e = event()
    e.parameters[5] = new ethereum.EventParam('brbProduced', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(301)))
    handleFundingReconciled(e)
    assert.fieldEquals('FundingVaultBalance', ID, 'balanced', 'false')
  })
  test('keeps old and replacement funder ledgers independent', () => {
    const first = event()
    handleFundingReconciled(first)
    const second = event()
    second.address = ASSET
    second.logIndex = first.logIndex.plus(BigInt.fromI32(1))
    handleFundingReconciled(second)
    assert.entityCount('FundingVaultBalance', 2)
    assert.entityCount('FundingLedgerSnapshot', 2)
  })
  test('retains a stopped retry budget across snapshots and records an explicit reset', () => {
    handleFundingReconciled(event())
    const retry = changetype<FundingRetryScheduled>(newMockEvent())
    retry.address = FUNDER
    retry.parameters = [new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))),
      new ethereum.EventParam('failures', ethereum.Value.fromI32(5)),
      new ethereum.EventParam('nextAttemptAt', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100))),
      new ethereum.EventParam('stopped', ethereum.Value.fromBoolean(true))]
    handleFundingRetryScheduled(retry)
    const next = event(); next.logIndex = next.logIndex.plus(BigInt.fromI32(1))
    handleFundingReconciled(next)
    assert.fieldEquals('FundingVaultBalance', ID, 'stopped', 'true')
    const reset = changetype<FundingRetryReset>(newMockEvent())
    reset.address = FUNDER; reset.parameters = [retry.parameters[0]]
    handleFundingRetryReset(reset)
    assert.fieldEquals('FundingVaultBalance', ID, 'stopped', 'false')
    assert.fieldEquals('FundingVaultBalance', ID, 'failures', '0')
  })
})
