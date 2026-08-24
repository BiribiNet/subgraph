import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, newMockEvent, test } from 'matchstick-as';

import { Transfer } from '../generated/BRBToken/BRB';
import { PayoutProgress } from '../generated/RouletteEngine/Game';
import { Market } from '../generated/schema';
import { handleMarketAssetTransfer } from '../src/mappings/market-asset';
import { handlePayoutProgress } from '../src/mappings/roulette';
import { getOrCreateGlobalState } from '../src/helpers/globalState';
import {
  CORNER_BET_DATA,
  DEFAULT_USER,
  GLOBAL_STATE_ID,
  TEST_BANK,
  createRoundForTests,
  emitBetRecorded,
} from './helpers';

const ENGINE = Address.fromString('0x7eb8110d9e84d3c32fa6468d13ea2bc81544acf1');
const TIMESTAMP = 1_000_000;

function emitPayoutProgress(paidAmount: string, timestamp: i32): void {
  const event = changetype<PayoutProgress>(newMockEvent());
  event.address = ENGINE;
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('globalRoundId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.parameters.push(
    new ethereum.EventParam('marketId', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.parameters.push(
    new ethereum.EventParam('fromCursor', ethereum.Value.fromUnsignedBigInt(BigInt.zero()))
  );
  event.parameters.push(
    new ethereum.EventParam('toCursor', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  event.parameters.push(
    new ethereum.EventParam(
      'paidAmount',
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(paidAmount))
    )
  );
  event.block.timestamp = BigInt.fromI32(timestamp);
  handlePayoutProgress(event);
}

/** The market asset's own Transfer(bank -> winner) — the only event that names a winner. */
function emitMarketAssetPayout(to: string, value: string, timestamp: i32, logIndex: i32): void {
  const event = changetype<Transfer>(newMockEvent());
  event.address = Address.fromString('0xaaaa000000000000000000000000000000000001');
  event.parameters = new Array<ethereum.EventParam>();
  event.parameters.push(
    new ethereum.EventParam('from', ethereum.Value.fromAddress(TEST_BANK))
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
  handleMarketAssetTransfer(event);
}

/** Round 1 in PAYOUT with a bet from DEFAULT_USER, on a 6-decimal market. */
function arrangeSixDecimalRoundInPayout(): void {
  const round = createRoundForTests(1, TIMESTAMP);
  emitBetRecorded(DEFAULT_USER, '10000000000000000000', CORNER_BET_DATA, 1);
  emitPayoutProgress('5000000', TIMESTAMP + 300);

  // After the bet: `setupTestMarket` re-stamps assetDecimals to 18 on every call.
  const market = Market.load(round.market);
  if (market == null) {
    throw new Error('market missing');
  }
  market.assetDecimals = 6;
  market.save();

  const state = getOrCreateGlobalState();
  state.lastRoundPaid = BigInt.fromI32(1);
  state.save();
}

describe('Non-BRB market payouts are attributed to the winner', () => {
  beforeEach(() => {
    clearStore();
  });

  test('a USDC payout marks the bet won and credits the user', () => {
    arrangeSixDecimalRoundInPayout();

    // Before the MarketAsset template existed nothing listened to this Transfer at all: the bet
    // stayed `won: false` with a zero payout, and since totalLost is derived as
    // totalRouletteBets - totalWon, the player's bet was booked as a total loss.
    emitMarketAssetPayout(DEFAULT_USER, '5000000', TIMESTAMP + 400, 7);

    assert.entityCount('PayoutTransaction', 1);
    assert.fieldEquals('User', DEFAULT_USER, 'winCount', '1');
  });

  test('the credited amount is normalized to 18 decimals', () => {
    arrangeSixDecimalRoundInPayout();

    // 5 USDC won, recorded in the cross-market 18-decimal scale like totalWagered.
    emitMarketAssetPayout(DEFAULT_USER, '5000000', TIMESTAMP + 400, 7);

    assert.fieldEquals('User', DEFAULT_USER, 'totalWon', '5000000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalPayouts', '5000000000000000000');
  });

  test('a transfer from an address that is not a known bank is ignored', () => {
    arrangeSixDecimalRoundInPayout();

    const event = changetype<Transfer>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
      new ethereum.EventParam(
        'from',
        ethereum.Value.fromAddress(Address.fromString('0x1111000000000000000000000000000000000001'))
      )
    );
    event.parameters.push(
      new ethereum.EventParam('to', ethereum.Value.fromAddress(Address.fromString(DEFAULT_USER)))
    );
    event.parameters.push(
      new ethereum.EventParam('value', ethereum.Value.fromUnsignedBigInt(BigInt.fromString('5000000')))
    );
    event.logIndex = BigInt.fromI32(9);
    event.block.timestamp = BigInt.fromI32(TIMESTAMP + 500);
    event.block.number = BigInt.fromI32(10_005);
    handleMarketAssetTransfer(event);

    assert.entityCount('PayoutTransaction', 0);
  });
});
