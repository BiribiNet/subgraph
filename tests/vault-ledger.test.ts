import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import {
  BetPlaced,
  BetsReleased,
  Deposit,
  FundsTransferred,
  PayoutBatchProcessed,
} from '../generated/templates/BankVault/BankVault4626';
import {
  handleBetPlaced,
  handleBetsReleased,
  handleDeposit,
  handleFundsTransferred,
  handlePayoutBatchProcessed,
} from '../src/mappings/bank-vault';
import { TEST_BANK, DEFAULT_USER, setupTestMarket, createRoundForTests } from './helpers';

function emitBetPlaced(amount: string, timestamp: i32 = 1_000_000): void {
  const event = changetype<BetPlaced>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('user', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
  );
  event.parameters.push(
    new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount)))
  );
  event.parameters.push(new ethereum.EventParam('data', ethereum.Value.fromBytes(Bytes.empty())));
  event.parameters.push(
    new ethereum.EventParam('roundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.block.timestamp = BigInt.fromI32(timestamp);
  handleBetPlaced(event);
}

describe('Vault ledger', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('BetPlaced increases gross and locked but not totalAssets', () => {
    emitBetPlaced('1000000000000000000');

    assert.fieldEquals('Market', '1', 'grossVaultBalance', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'lockedBetLiquidity', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '0');
  });

  test('BetsReleased sets lockedBetLiquidity from event', () => {
    emitBetPlaced('1000000000000000000');

    const ev = changetype<BetsReleased>(newMockEvent());
    ev.address = TEST_BANK;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    ev.parameters.push(
      new ethereum.EventParam('newLockedTotal', ethereum.Value.fromUnsignedBigInt(BigInt.zero()))
    );
    handleBetsReleased(ev);

    assert.fieldEquals('Market', '1', 'lockedBetLiquidity', '0');
    assert.fieldEquals('Market', '1', 'totalAssets', '1000000000000000000');
  });

  test('Deposit increases gross and totalAssets', () => {
    const event = changetype<Deposit>(newMockEvent());
    event.address = TEST_BANK;
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    event.parameters.push(
      new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    event.parameters.push(
      new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('500000000000000000')))
    );
    event.parameters.push(
      new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('500000000000000000')))
    );
    event.block.timestamp = BigInt.fromI32(1_000_000);
    handleDeposit(event);

    assert.fieldEquals('Market', '1', 'grossVaultBalance', '500000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '500000000000000000');
  });

  test('PayoutBatchProcessed decreases gross', () => {
    const dep = changetype<Deposit>(newMockEvent());
    dep.address = TEST_BANK;
    dep.parameters = new Array<ethereum.EventParam>();
    dep.parameters.push(
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    dep.parameters.push(
      new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    dep.parameters.push(
      new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    dep.parameters.push(
      new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    dep.block.timestamp = BigInt.fromI32(1_000_000);
    handleDeposit(dep);

    const payout = changetype<PayoutBatchProcessed>(newMockEvent());
    payout.address = TEST_BANK;
    payout.parameters = new Array<ethereum.EventParam>();
    payout.parameters.push(
      new ethereum.EventParam('payoutCount', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3)))
    );
    payout.parameters.push(
      new ethereum.EventParam('totalPaid', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('200000000000000000')))
    );
    handlePayoutBatchProcessed(payout);

    assert.fieldEquals('Market', '1', 'grossVaultBalance', '800000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '800000000000000000');
  });

  test('FundsTransferred decreases gross', () => {
    const dep = changetype<Deposit>(newMockEvent());
    dep.address = TEST_BANK;
    dep.parameters = new Array<ethereum.EventParam>();
    dep.parameters.push(
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    dep.parameters.push(
      new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    dep.parameters.push(
      new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    dep.parameters.push(
      new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    dep.block.timestamp = BigInt.fromI32(1_000_000);
    handleDeposit(dep);

    const ft = changetype<FundsTransferred>(newMockEvent());
    ft.address = TEST_BANK;
    ft.parameters = new Array<ethereum.EventParam>();
    ft.parameters.push(
      new ethereum.EventParam('recipient', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    ft.parameters.push(
      new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('100000000000000000')))
    );
    handleFundsTransferred(ft);

    assert.fieldEquals('Market', '1', 'grossVaultBalance', '900000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '900000000000000000');
  });
});
