import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';
import { Market } from '../generated/schema';
import { getOrCreateGlobalState } from '../src/helpers/globalState';
import { findBetInMarketRound } from '../src/helpers/market';
import { tryRecordMarketPayoutTransfer } from '../src/helpers/payout-transfer';
import { JACKPOT_TREASURY_ADDRESS, ROUND_STATUS_PAYOUT } from '../src/helpers/constant';
import { CORNER_BET_DATA, DEFAULT_USER, TEST_BANK, createRoundForTests, emitBetRecorded, emitBrbTransfer, emitJackpotFundedInTx, testRoundId } from './helpers';

const TX = Bytes.fromHexString('0x1111111111111111111111111111111111111111111111111111111111111111');
const BRB_PAYOUT = BigInt.fromString('2000000000000000000');
const FUNDER = '0xd990413247611013161a7287d262664df8da7309';

function arrange(decimals: i32): void {
  const round = createRoundForTests(1, 1_000_000);
  emitBetRecorded(DEFAULT_USER, '10000000', CORNER_BET_DATA, 1);
  const market = Market.load(round.market)!;
  market.assetDecimals = decimals;
  market.save();
  // Reload: the bet handler also writes this round.
  const bet = findBetInMarketRound(Address.fromString(DEFAULT_USER), BigInt.fromI32(1), 1)!;
  const state = getOrCreateGlobalState();
  state.lastRoundPaid = BigInt.fromI32(1);
  state.currentJackpot = BRB_PAYOUT.times(BigInt.fromI32(10));
  state.save();
  round.status = ROUND_STATUS_PAYOUT;
  round.save();
  assert.fieldEquals('RouletteBet', bet.id.toHexString(), 'actualPayout', '0');
}

function pay(from: Address, value: BigInt, logIndex: i32): void {
  tryRecordMarketPayoutTransfer(from, Address.fromString(DEFAULT_USER), value,
    BigInt.fromI32(100), BigInt.fromI32(1_000_500), TX, BigInt.fromI32(logIndex));
}

function checkOrder(decimals: i32, jackpotFirst: boolean): void {
  arrange(decimals);
  const regular = BigInt.fromI32(5).times(BigInt.fromI32(10).pow(<u8>decimals));
  if (jackpotFirst) pay(JACKPOT_TREASURY_ADDRESS, BRB_PAYOUT, 1);
  pay(TEST_BANK, regular, 2);
  if (!jackpotFirst) pay(JACKPOT_TREASURY_ADDRESS, BRB_PAYOUT, 3);
  const bet = findBetInMarketRound(Address.fromString(DEFAULT_USER), BigInt.fromI32(1), 1)!;
  assert.fieldEquals('RouletteBet', bet.id.toHexString(), 'actualPayout', regular.toString());
  assert.fieldEquals('RouletteBet', bet.id.toHexString(), 'won', 'true');
  assert.fieldEquals('UserMarketStats', DEFAULT_USER + '-1', 'totalWon', regular.toString());
  assert.fieldEquals('UserMarketStats', DEFAULT_USER + '-1', 'winCount', '1');
  assert.fieldEquals('User', DEFAULT_USER, 'totalWon', '5000000000000000000');
  assert.fieldEquals('User', DEFAULT_USER, 'winCount', '1');
  assert.entityCount('JackpotPayout', 1);
  assert.entityCount('PayoutTransaction', 1);
}

describe('Jackpot receipts never change roulette asset winnings', () => {
  beforeEach(() => clearStore());
  test('USDC roulette then BRB jackpot', () => checkOrder(6, false));
  test('BRB jackpot then USDC roulette', () => checkOrder(6, true));
  test('18-decimal roulette then BRB jackpot', () => checkOrder(18, false));
  test('BRB jackpot then 18-decimal roulette', () => checkOrder(18, true));
  test('jackpot alone does not fabricate a regular roulette win', () => {
    arrange(6);
    pay(JACKPOT_TREASURY_ADDRESS, BRB_PAYOUT, 1);
    const bet = findBetInMarketRound(Address.fromString(DEFAULT_USER), BigInt.fromI32(1), 1)!;
    assert.fieldEquals('RouletteBet', bet.id.toHexString(), 'actualPayout', '0');
    assert.fieldEquals('RouletteBet', bet.id.toHexString(), 'won', 'false');
    assert.fieldEquals('UserMarketStats', DEFAULT_USER + '-1', 'totalWon', '0');
    assert.fieldEquals('User', DEFAULT_USER, 'winCount', '0');
    assert.entityCount('JackpotPayout', 1);
  });
  test('treasury BRB receipt is counted once despite market input event', () => {
    arrange(6);
    emitBrbTransfer(FUNDER, JACKPOT_TREASURY_ADDRESS.toHexString(), '2500000000000000000', 1_000_000);
    emitJackpotFundedInTx(1, 1, '3000000', TX, 9);
    assert.fieldEquals('DailyStat', '11', 'jackpotFunded', '2500000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'jackpotRevenue', '3000000');
  });
  test('funder input without a treasury receipt is not BRB funding', () => {
    arrange(6);
    emitJackpotFundedInTx(1, 1, '3000000', TX, 9);
    assert.fieldEquals('DailyStat', '11', 'jackpotFunded', '0');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'jackpotRevenue', '3000000');
  });
});

