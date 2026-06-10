import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { newMockEvent, createMockedFunction } from 'matchstick-as';

import { BetRecorded } from '../generated/RouletteEngine/Game';
import { Transfer as BrbTransfer } from '../generated/BRBToken/BRB';
import { handleTransfer as handleBrbTransfer } from '../src/mappings/brb';
import { ZERO_ADDRESS } from '../src/helpers/constant';
import {
  Deposit,
  WithdrawalRequested,
  WithdrawalProcessed,
  BetPlaced,
  BetsReleased,
  PayoutBatchProcessed,
  FundsTransferred,
  SideBetStakeLocked,
} from '../generated/templates/BankVault/BankVault4626';
import { BankAddress, Market, RouletteRound } from '../generated/schema';
import { getOrCreateGlobalRound } from '../src/helpers/globalRound';
import { getOrCreateGlobalState } from '../src/helpers/globalState';
import { getOrCreateMarket, marketRoundId } from '../src/helpers/market';
import { createNewRouletteRound } from '../src/helpers/rouletteRound';
import { handleBetRecorded } from '../src/mappings/roulette';
import {
  handleDeposit,
  handleWithdrawalRequested,
  handleWithdrawalProcessed,
  handleBetPlaced,
  handleBetsReleased,
  handlePayoutBatchProcessed,
  handleFundsTransferred,
  handleSideBetStakeLocked,
} from '../src/mappings/bank-vault';
import { bigintToBytes } from '../src/helpers/bigintToBytes';

export const GLOBAL_STATE_ID = '0x0000000000000000000000000000000000000001';
export const TEST_ENGINE = Address.fromString('0x2f6bbd7df2e997788a6a3759edcd7282028d40bd');
export const TEST_BANK = Address.fromString('0xcccc000000000000000000000000000000000001');
export const TEST_ASSET = Address.fromString('0xaaaa000000000000000000000000000000000001');
export const DEFAULT_USER = '0xbbbbedc42dc53842141be8f70df9efe4d08538a4';
export const BRB_TOKEN = Address.fromString('0xa8dedb784804f07e1748582ca309ef74acd8c040');

/** Composite RouletteRound id: globalRound + marketId (default market 1). */
export function testRoundId(globalRound: i32, marketId: i32 = 1): string {
  return marketRoundId(BigInt.fromI32(globalRound), marketId).toHexString();
}

export function mockVaultTokenMetadata(): void {
  createMockedFunction(TEST_ASSET, 'symbol', 'symbol():(string)').returns([
    ethereum.Value.fromString('BRB'),
  ]);
  createMockedFunction(TEST_ASSET, 'decimals', 'decimals():(uint8)').returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(18)),
  ]);
  createMockedFunction(TEST_BANK, 'name', 'name():(string)').returns([
    ethereum.Value.fromString('Biribi Test Vault'),
  ]);
  createMockedFunction(TEST_BANK, 'symbol', 'symbol():(string)').returns([
    ethereum.Value.fromString('bvTEST'),
  ]);
  createMockedFunction(TEST_BANK, 'minBet', 'minBet():(uint256)').returns([
    ethereum.Value.fromUnsignedBigInt(BigInt.fromString('5000000000000000000')),
  ]);
}

/** Registers market 1 + bank reverse-lookup so vault handlers resolve the market. */
export function setupTestMarket(marketId: i32 = 1): void {
  getOrCreateGlobalState().save();
  mockVaultTokenMetadata();
  const ts = BigInt.fromI32(1_000_000);
  const market = getOrCreateMarket(
    marketId,
    changetype<Bytes>(TEST_ASSET),
    changetype<Bytes>(TEST_BANK),
    changetype<Bytes>(TEST_ENGINE),
    ts,
    BigInt.fromI32(10_000)
  );
  market.assetDecimals = 18;
  market.save();

  const bankKey = changetype<Bytes>(TEST_BANK);
  let lookup = BankAddress.load(bankKey);
  if (lookup == null) {
    lookup = new BankAddress(bankKey);
    lookup.market = market.id;
    lookup.save();
  }
}

/** Same as setupTestMarket but with BRB as the vault underlying asset (donation undo on deposit). */
export function setupBrbTestMarket(marketId: i32 = 1): void {
  setupTestMarket(marketId);
  const market = Market.load(marketId.toString());
  if (market != null) {
    market.asset = changetype<Bytes>(BRB_TOKEN);
    market.assetSymbol = 'BRB';
    market.assetClass = 'BRB';
    market.save();
  }
}

/**
 * Bootstrap GlobalRound + per-market RouletteRound (Phase 1C multi-market model).
 */
export function createRoundForTests(
  globalRound: i32,
  timestamp: i32,
  marketId: i32 = 1
): RouletteRound {
  setupTestMarket(marketId);
  const ts = BigInt.fromI32(timestamp);
  const gr = getOrCreateGlobalRound(BigInt.fromI32(globalRound), ts);
  gr.save();
  const market = getOrCreateMarket(
    marketId,
    changetype<Bytes>(TEST_ASSET),
    changetype<Bytes>(TEST_BANK),
    changetype<Bytes>(TEST_ENGINE),
    ts,
    BigInt.fromI32(10_000)
  );
  const round = createNewRouletteRound(gr, market, ts);
  round.save();
  return round;
}

/** ABI order matches RouletteEngine: (uint256[] betTypes, uint256[] numbers, uint256[] amounts). */
export function encodeBetRecordedData(amount: string, betType: i32, number: i32): Bytes {
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(betType)]),
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(number)]),
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromString(amount)]),
      ])
    )
  );
  return encoded ? encoded : Bytes.empty();
}

/** 10 BRB CORNER on pocket 1 — used for deterministic maxBetAmount assertions. */
export const CORNER_BET_DATA = encodeBetRecordedData('10000000000000000000', 4, 1);

export function emitBetRecorded(
  player: string,
  totalAmount: string,
  betData: Bytes,
  localRound: i32,
  marketId: i32 = 1,
  timestamp: i32 = 1_000_000,
  logIndex: i32 = 0
): void {
  setupTestMarket(marketId);
  const event = changetype<BetRecorded>(newMockEvent());
  event.address = TEST_ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(marketId)))
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
  event.parameters.push(new ethereum.EventParam('betData', ethereum.Value.fromBytes(betData)));
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleBetRecorded(event);
}

export function emitDeposit(
  owner: string,
  assets: string,
  shares: string,
  timestamp: i32,
  logIndex: i32 = 0
): void {
  setupTestMarket();
  const event = changetype<Deposit>(newMockEvent());
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
    new ethereum.EventParam('shares', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(shares)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleDeposit(event);
}

export function emitWithdrawalRequested(
  owner: string,
  bps: i32,
  receiver: string,
  timestamp: i32,
  logIndex: i32 = 0
): void {
  setupTestMarket();
  const event = changetype<WithdrawalRequested>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(owner)))
  );
  event.parameters.push(
    new ethereum.EventParam('bps', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(bps)))
  );
  event.parameters.push(
    new ethereum.EventParam('receiver', ethereum.Value.fromAddress(Address.fromString(receiver)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleWithdrawalRequested(event);
}

export function emitWithdrawalProcessed(
  owner: string,
  bps: i32,
  receiver: string,
  assetsPaid: string,
  sharesBurned: string,
  timestamp: i32,
  logIndex: i32 = 1
): void {
  setupTestMarket();
  const event = changetype<WithdrawalProcessed>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('owner', ethereum.Value.fromAddress(Address.fromString(owner)))
  );
  event.parameters.push(
    new ethereum.EventParam('bps', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(bps)))
  );
  event.parameters.push(
    new ethereum.EventParam('receiver', ethereum.Value.fromAddress(Address.fromString(receiver)))
  );
  event.parameters.push(
    new ethereum.EventParam('assetsPaid', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(assetsPaid)))
  );
  event.parameters.push(
    new ethereum.EventParam('sharesBurned', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(sharesBurned)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleWithdrawalProcessed(event);
}

export function emitBetPlaced(
  amount: string,
  timestamp: i32 = 1_000_000,
  logIndex: i32 = 0
): void {
  setupTestMarket();
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
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleBetPlaced(event);
}

export function emitBetsReleased(
  amount: string,
  newLockedTotal: string,
  timestamp: i32 = 1_000_000,
  logIndex: i32 = 0
): void {
  setupTestMarket();
  const event = changetype<BetsReleased>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount)))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'newLockedTotal',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(newLockedTotal))
    )
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleBetsReleased(event);
}

export function emitPayoutBatchProcessed(
  totalPaid: string,
  timestamp: i32 = 1_000_000,
  payoutCount: i32 = 1,
  logIndex: i32 = 0
): void {
  setupTestMarket();
  const event = changetype<PayoutBatchProcessed>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam(
      'payoutCount',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(payoutCount))
    )
  );
  event.parameters.push(
    new ethereum.EventParam('totalPaid', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(totalPaid)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handlePayoutBatchProcessed(event);
}

export function emitFundsTransferred(
  amount: string,
  timestamp: i32 = 1_000_000,
  logIndex: i32 = 0
): void {
  setupTestMarket();
  const event = changetype<FundsTransferred>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('recipient', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
  );
  event.parameters.push(
    new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleFundsTransferred(event);
}

export function emitSideBetStakeLocked(
  player: string,
  stake: string,
  payoutReserve: string,
  newLockedTotal: string,
  timestamp: i32 = 1_000_000,
  logIndex: i32 = 0
): void {
  setupTestMarket();
  const event = changetype<SideBetStakeLocked>(newMockEvent());
  event.address = TEST_BANK;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('player', ethereum.Value.fromAddress(Address.fromString(player)))
  );
  event.parameters.push(
    new ethereum.EventParam('stake', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(stake)))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'payoutReserve',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(payoutReserve))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      'newLockedTotal',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(newLockedTotal))
    )
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  handleSideBetStakeLocked(event);
}

export function withBlock<T extends ethereum.Event>(event: T, timestamp: i32, blockNumber: i32): T {
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(blockNumber);
  return event;
}

export function emptyMockEvent(): ethereum.Event {
  const ev = newMockEvent();
  ev.parameters = new Array<ethereum.EventParam>();
  return ev;
}

export function globalRoundIdHex(globalRound: i32): string {
  return bigintToBytes(BigInt.fromI32(globalRound)).toHexString();
}

function buildBrbTransferEvent(
  from: string,
  to: string,
  value: string,
  timestamp: i32,
  logIndex: i32
): BrbTransfer {
  const event = changetype<BrbTransfer>(newMockEvent());
  event.address = BRB_TOKEN;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('from', ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(
    new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(to)))
  );
  event.parameters.push(
    new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value)))
  );
  event.logIndex = BigInt.fromI32(logIndex);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.block.number = BigInt.fromI32(timestamp / 100);
  return event;
}

/**
 * Simulates a BRB Transfer. When `autoFundSender` is true (default) and `from` is not zero,
 * mints 1000 BRB to the sender first so wallet balance tracking does not underflow in tests.
 */
export function emitBrbTransfer(
  from: string,
  to: string,
  value: string,
  timestamp: i32,
  logIndex: i32 = 0,
  autoFundSender: boolean = true
): void {
  if (autoFundSender && from != ZERO_ADDRESS) {
    const fundEvent = buildBrbTransferEvent(
      ZERO_ADDRESS,
      from,
      '1000000000000000000000',
      timestamp > 0 ? timestamp - 1 : 0,
      logIndex > 0 ? logIndex - 1 : 0
    );
    handleBrbTransfer(fundEvent);
  }
  handleBrbTransfer(buildBrbTransferEvent(from, to, value, timestamp, logIndex));
}
