import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { Transfer as BrbTransfer } from '../generated/BRBToken/BRB';
import { BetRecorded } from '../generated/RouletteEngine/Game';
import { BetsReleased, Deposit } from '../generated/templates/BankVault/BankVault4626';
import { ReferralSet } from '../generated/RouletteEngine/Game';
import { handleTransfer as handleBrbTransfer } from '../src/mappings/brb';
import { handleBetRecorded, handleReferralSet } from '../src/mappings/roulette';
import { handleBetsReleased, handleDeposit } from '../src/mappings/bank-vault';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  TEST_BANK,
  TEST_ENGINE,
  BRB_TOKEN,
  createRoundForTests,
  emitBrbTransfer,
  emitDeposit,
  setupBrbTestMarket,
  setupTestMarket,
} from './helpers';

const REFERRER = '0xbbbb000000000000000000000000000000000002';

function buildBetRecorded(tx: ethereum.Transaction, logIndex: i32): BetRecorded {
  setupTestMarket();
  const event = changetype<BetRecorded>(newMockEvent());
  event.transaction = tx;
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.parameters.push(
    new ethereum.EventParam('localRound', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.parameters.push(
    new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
  );
  event.parameters.push(
    new ethereum.EventParam('totalAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
  );
  event.parameters.push(new ethereum.EventParam('betData', ethereum.Value.fromBytes(CORNER_BET_DATA)));
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  return event;
}

describe('Audit fix: donations exclude bets and deposits', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('pure BRB transfer to bank counts as donation', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '500000000000000000', 1_000_000);
    assert.fieldEquals('Market', '1', 'brbDonations', '500000000000000000');
  });

  test('BRB transfer after BetRecorded in same tx is not a donation', () => {
    const base = changetype<ethereum.Event>(newMockEvent());
    handleBetRecorded(buildBetRecorded(base.transaction, 0));

    const transfer = changetype<BrbTransfer>(newMockEvent());
    transfer.transaction = base.transaction;
    transfer.address = BRB_TOKEN;
    transfer.parameters = new Array<ethereum.EventParam>();
    transfer.parameters.push(
      new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    transfer.parameters.push(
      new ethereum.EventParam('to', ethereum.Value.fromAddress(TEST_BANK))
    );
    transfer.parameters.push(
      new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    transfer.logIndex = BigInt.fromI32(1);
    transfer.block.timestamp = BigInt.fromI32(1_000_000);
    handleBrbTransfer(transfer);

    assert.fieldEquals('Market', '1', 'brbDonations', '0');
  });

  test('deposit BRB transfer is not counted as donation', () => {
    setupBrbTestMarket();
    const base = changetype<ethereum.Event>(newMockEvent());

    const transfer = changetype<BrbTransfer>(newMockEvent());
    transfer.transaction = base.transaction;
    transfer.address = BRB_TOKEN;
    transfer.parameters = new Array<ethereum.EventParam>();
    transfer.parameters.push(
      new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    transfer.parameters.push(
      new ethereum.EventParam('to', ethereum.Value.fromAddress(TEST_BANK))
    );
    transfer.parameters.push(
      new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    transfer.logIndex = BigInt.fromI32(0);
    transfer.block.timestamp = BigInt.fromI32(1_000_000);
    handleBrbTransfer(transfer);

    const deposit = changetype<Deposit>(newMockEvent());
    deposit.transaction = base.transaction;
    deposit.address = TEST_BANK;
    deposit.parameters = new Array<ethereum.EventParam>();
    deposit.parameters.push(
      new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    deposit.parameters.push(
      new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    deposit.parameters.push(
      new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    deposit.parameters.push(
      new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1000000000000000000')))
    );
    deposit.logIndex = BigInt.fromI32(1);
    deposit.block.timestamp = BigInt.fromI32(1_000_000);
    handleDeposit(deposit);

    assert.fieldEquals('Market', '1', 'brbDonations', '0');
  });
});

describe('Audit fix: first referred bet credits referrer BRBR', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('ReferralSet in same tx as BetRecorded credits referrer totalBrbrEarned', () => {
    const base = changetype<ethereum.Event>(newMockEvent());
    handleBetRecorded(buildBetRecorded(base.transaction, 0));

    const ev = changetype<ReferralSet>(newMockEvent());
    ev.transaction = base.transaction;
    ev.address = TEST_ENGINE;
    ev.parameters = new Array<ethereum.EventParam>();
    ev.parameters.push(
      new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    ev.parameters.push(
      new ethereum.EventParam('referrer', ethereum.Value.fromAddress(Address.fromString(REFERRER)))
    );
    ev.block.timestamp = BigInt.fromI32(1_000_000);
    ev.logIndex = BigInt.fromI32(1);
    handleReferralSet(ev);

    assert.fieldEquals('User', REFERRER, 'totalBrbrEarned', '1000000000000000000');
  });
});

describe('Audit fix: BetsReleased clears pendingBets', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('BetsReleased decrements market pendingBets', () => {
    const base = changetype<ethereum.Event>(newMockEvent());
    handleBetRecorded(buildBetRecorded(base.transaction, 0));
    assert.fieldEquals('Market', '1', 'pendingBets', '1000000000000000000');

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

    assert.fieldEquals('Market', '1', 'pendingBets', '0');
  });
});
