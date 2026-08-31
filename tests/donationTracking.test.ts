import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  newMockEvent,
  test,
} from 'matchstick-as';

import { Transfer as BrbTransfer } from '../generated/BRBToken/BRB';
import { BetRecorded } from '../generated/RouletteEngine/Game';
import { Deposit } from '../generated/templates/BankVault/BankVault4626';
import { RouletteRound } from '../generated/schema';
import { handleTransfer as handleBrbTransfer } from '../src/mappings/brb';
import { handleDeposit } from '../src/mappings/bank-vault';
import { handleBetRecorded } from '../src/mappings/roulette';
import { ROUND_STATUS_VRF } from '../src/helpers/constant';
import { marketRoundId } from '../src/helpers/market';
import { ZERO_ADDRESS } from '../src/helpers/constant';
import {
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_BANK,
  BRB_TOKEN,
  CORNER_BET_DATA,
  createRoundForTests,
  emitBrbTransfer,
  emitDeposit,
  emitSideBetStakeLocked,
  setupBrbTestMarket,
  setupSecondTestMarket,
  setupTestMarket,
  TEST_BANK_2,
  TEST_ENGINE,
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
    // Only a BRB vault can hold BRB as liquidity; elsewhere it is a stray token the
    // vault's own totalAssets() cannot see.
    setupBrbTestMarket();
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '1000000000000000000', 1_000_000);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '1000000000000000000');
  });

  test('Multiple transfers TO bank accumulate', () => {
    // Only a BRB vault can hold BRB as liquidity; elsewhere it is a stray token the
    // vault's own totalAssets() cannot see.
    setupBrbTestMarket();
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
    // Only a BRB vault can hold BRB as liquidity; elsewhere it is a stray token the
    // vault's own totalAssets() cannot see.
    setupBrbTestMarket();
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '500000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'brbDonations', '500000000000000000');
    assert.fieldEquals('Market', '1', 'grossVaultBalance', '500000000000000000');
    assert.fieldEquals('Market', '1', 'totalAssets', '500000000000000000');
  });

  test('H-14: a BRB-market side-bet stake raises gross by the stake exactly once', () => {
    setupBrbTestMarket();
    const stake = '500000000000000000';

    // The vault pulls the stake, so the token emits Transfer into the bank first — counted as a
    // donation and added to gross. SideBetStakeLocked then added the same stake again, doubling
    // grossVaultBalance and with it totalAssets, sharePrice and every APY snapshot.
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), stake, 1_000_000);
    assert.fieldEquals('Market', '1', 'brbDonations', stake);

    emitSideBetStakeLocked(DEFAULT_USER, stake, '5000000000000000000', '5000000000000000000', 1_000_000, 1);

    assert.fieldEquals('Market', '1', 'grossVaultBalance', stake);
    assert.fieldEquals('Market', '1', 'brbDonations', '0');
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

// ── Same-transaction builders ────────────────────────────────────────────────
//
// The shared `emit*` helpers each mint their own transaction via `newMockEvent()`. Everything
// below turns on several logs sharing ONE transaction, which is the only scope in which the
// per-tx scratch entities mean anything — so these build the events by hand.

function brbTransferInTx(
  transaction: ethereum.Transaction,
  from: string,
  value: string,
  logIndex: i32
): void {
  const event = changetype<BrbTransfer>(newMockEvent());
  event.transaction = transaction;
  event.address = BRB_TOKEN;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(new ethereum.EventParam('to', ethereum.Value.fromAddress(TEST_BANK)));
  event.parameters.push(
    new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  handleBrbTransfer(event);
}

function depositInTx(
  transaction: ethereum.Transaction,
  owner: string,
  assets: string,
  logIndex: i32
): void {
  const event = changetype<Deposit>(newMockEvent());
  event.transaction = transaction;
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('sender', ethereum.Value.fromAddress(Address.fromString(owner)))
  );
  event.parameters.push(
    new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(owner)))
  );
  event.parameters.push(
    new ethereum.EventParam('assets', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(assets)))
  );
  event.parameters.push(
    new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(assets)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  handleDeposit(event);
}

function betRecordedInTx(
  transaction: ethereum.Transaction,
  player: string,
  totalAmount: string,
  localRound: i32,
  logIndex: i32
): void {
  const event = changetype<BetRecorded>(newMockEvent());
  event.transaction = transaction;
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.parameters.push(
    new ethereum.EventParam('localRound', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(localRound)))
  );
  event.parameters.push(
    new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(player)))
  );
  event.parameters.push(
    new ethereum.EventParam('totalAmount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(totalAmount)))
  );
  event.parameters.push(new ethereum.EventParam('betData', ethereum.Value.fromBytes(CORNER_BET_DATA)));
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(1_000_000);
  event.block.number = BigInt.fromI32(10_000);
  handleBetRecorded(event);
}

describe('Donation undo is scoped to what was actually booked', () => {
  const PRIOR_GIFT = '500000000000000000';
  const GIFT_TX_HASH = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
  const DEPOSIT_TX_HASH = '0xbbbb000000000000000000000000000000000000000000000000000000000002';
  const DEPOSIT_AMOUNT = '1000000000000000000';

  beforeEach(() => {
    clearStore();
    setupBrbTestMarket();
    createRoundForTests(1, 1_000_000);
  });

  test('should leave an earlier donation intact when a second deposit in one tx was excluded', () => {
    // A genuine gift, in a transaction of its own — `newMockEvent()` hands out one default hash,
    // so the hashes have to be set apart by hand or every event shares a scratch and the gift is
    // fair game. Nothing in a later transaction may spend it.
    const giftTx = changetype<ethereum.Event>(newMockEvent()).transaction;
    giftTx.hash = Bytes.fromHexString(GIFT_TX_HASH);
    brbTransferInTx(giftTx, OTHER_ADDRESS, PRIOR_GIFT, 0);
    assert.fieldEquals('Market', '1', 'brbDonations', PRIOR_GIFT);

    // Two deposits in ONE transaction — a router or multicall stacking two `deposit()` calls.
    // The first deposit leaves `depositToBank` behind, which then excludes the SECOND transfer
    // from donation accounting. Nothing is booked for it, so there is nothing to undo; an undo
    // inferred from `assets` instead ate into the unrelated gift above, and stripped real
    // balance out of `grossVaultBalance` with it.
    const tx = changetype<ethereum.Event>(newMockEvent()).transaction;
    tx.hash = Bytes.fromHexString(DEPOSIT_TX_HASH);
    brbTransferInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 0);
    depositInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 1);
    brbTransferInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 2);
    depositInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 3);

    assert.fieldEquals('Market', '1', 'brbDonations', PRIOR_GIFT);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', PRIOR_GIFT);
    // 0.5 gift + 2 × 1.0 deposited = 2.5, matching what the bank really holds.
    assert.fieldEquals('Market', '1', 'grossVaultBalance', '2500000000000000000');
  });

  test('should still undo the donation booked by an ordinary BRB deposit', () => {
    // Non-regression on the nominal path, where the undo IS load-bearing: the vault pulls the
    // assets before it emits `Deposit`, so the transfer really was booked as a donation.
    const tx = changetype<ethereum.Event>(newMockEvent()).transaction;
    brbTransferInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 0);
    assert.fieldEquals('Market', '1', 'brbDonations', DEPOSIT_AMOUNT);

    depositInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 1);

    assert.fieldEquals('Market', '1', 'brbDonations', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
    assert.fieldEquals('Market', '1', 'grossVaultBalance', DEPOSIT_AMOUNT);
  });

  test('should mark bet funds as non-donation even when the slice is no longer BETTING', () => {
    // Hardening, not a reproduction of an observed event: the engine rejects bets on a locked
    // round. But if a slice ever did lag, the bet's own transfer would be booked as a permanent
    // donation — the bet path has no undo at all.
    const round = RouletteRound.load(marketRoundId(BigInt.fromI32(1), 1));
    if (round == null) {
      throw new Error('round fixture missing');
    }
    round.status = ROUND_STATUS_VRF;
    round.save();

    const tx = changetype<ethereum.Event>(newMockEvent()).transaction;
    betRecordedInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 1, 0);
    brbTransferInTx(tx, DEFAULT_USER, DEPOSIT_AMOUNT, 1);

    assert.fieldEquals('Market', '1', 'brbDonations', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
    // The bet itself is still skipped by the status guard — only the scratch is unconditional.
    assert.entityCount('RouletteBet', 0);
  });
});

describe('Stray BRB is not vault liquidity', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('should ignore BRB sent to a vault whose asset is not BRB', () => {
    // Market 2 is a 6-decimal vault, i.e. a USDC-like one. `BankVault4626.totalAssets()` reads
    // `asset()`, so BRB sitting in it is invisible on-chain and must be invisible here too.
    // Booking it credited 1e18 to a ledger denominated in 1e6 units — a trillion units of TVL
    // conjured by one transfer anybody can make, which then reached sharePrice and every APY.
    setupSecondTestMarket(6);

    emitBrbTransfer(DEFAULT_USER, TEST_BANK_2.toHexString(), '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '2', 'grossVaultBalance', '0');
    assert.fieldEquals('Market', '2', 'totalAssets', '0');
    assert.fieldEquals('Market', '2', 'brbDonations', '0');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalTransfersToPool', '0');
  });

  test('should still book BRB sent to the BRB vault', () => {
    setupBrbTestMarket();

    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), '1000000000000000000', 1_000_000);

    assert.fieldEquals('Market', '1', 'brbDonations', '1000000000000000000');
    assert.fieldEquals('Market', '1', 'grossVaultBalance', '1000000000000000000');
  });
});
