import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { Transfer as BrbTransfer } from '../generated/BRBToken/BRB';
import { Deposit } from '../generated/templates/BankVault/BankVault4626';
import { handleTransfer as handleBrbTransfer } from '../src/mappings/brb';
import { handleDeposit } from '../src/mappings/bank-vault';
import { ZERO_ADDRESS } from '../src/helpers/constant';
import {
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_BANK,
  BRB_TOKEN,
  createRoundForTests,
  emitBrbTransfer,
  emitDeposit,
  setupBrbTestMarket,
  setupTestMarket,
} from './helpers';

const USER_ADDRESS_2 = '0xccccccdc53842141be8f70df9efe4d08538a5555';
const OTHER_ADDRESS = '0xdddddddc53842141be8f70df9efe4d08538a6666';

describe('Transfer Tracking Tests', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('Transfers TO registered bank increment totalTransfersToPool', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '1000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '1000000000000000000');
  });

  test('Multiple transfers TO bank accumulate', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '1000000000000000000', 1_000_000);
    emitBrbTransfer(USER_ADDRESS_2, TEST_BANK.toHexString(), '2000000000000000000', 1_000_100, 1);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '3000000000000000000');
  });

  test('Transfers FROM bank do not increment totalTransfersToPool', () => {
    emitBrbTransfer(TEST_BANK.toHexString(), DEFAULT_USER, '1000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
  });

  test('Mints (from zero) skip pool tracking', () => {
    emitBrbTransfer(ZERO_ADDRESS, TEST_BANK.toHexString(), '1000000000000000000', 1_000_000, 0, false);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
  });

  test('Transfers to unrelated addresses do not increment totalTransfersToPool', () => {
    emitBrbTransfer(DEFAULT_USER, OTHER_ADDRESS, '1000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
  });
});

describe('Deposit Tracking Tests', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('Deposits increment stableVaultTotalDeposits in GlobalState', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalDeposits', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '1000000000000000000');
  });

  test('Multiple deposits accumulate stable vault deposits', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);
    emitDeposit(USER_ADDRESS_2, '2000000000000000000', '2000000000000000000', 1_000_100);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalDeposits', '3000000000000000000');
  });
});

describe('Pool liquidity via BRB transfer + deposit', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('BRB transfer to bank increases brbDonations and gross vault balance', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '500000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'brbDonations', '500000000000000000');
    assert.fieldEquals('Market', '1', 'grossVaultBalance', '500000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '500000000000000000');
  });

  test('Deposit increases Market.totalAssets and GlobalState vault totals', () => {
    emitDeposit(DEFAULT_USER, '1000000000000000000', '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'totalAssets', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '1000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalAssets', '1000000000000000000');
  });

  test('BRB transfer + deposit in same tx does not count as donation on BRB market', () => {
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
    assert.fieldEquals('Market', '1', 'totalAssets', '1000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
  });
});
