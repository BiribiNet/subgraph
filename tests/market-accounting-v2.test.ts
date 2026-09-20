import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';
import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import { Market } from '../generated/schema';
import { recordMarketAccounting } from '../src/helpers/market-accounting';
import { observedApr, recordMarketReturns } from '../src/helpers/market-returns';
import { createRoundForTests } from './helpers';

function n(value: i32): BigInt { return BigInt.fromI32(value); }

describe('Market accounting v2', () => {
  beforeEach(() => { clearStore(); createRoundForTests(1, 1000000); });

  test('Duplicate events count once, players are unique, tokens remain separate', () => {
    const market = Market.load('1')!;
    const player = Bytes.fromHexString('0x1111111111111111111111111111111111111111');
    recordMarketAccounting(market, 'a', n(1000000), n(10), ['volume', 'betCount'], [n(12), n(1)], player);
    recordMarketAccounting(market, 'a', n(1000000), n(10), ['volume', 'betCount'], [n(12), n(1)], player);
    recordMarketAccounting(market, 'b', n(1000001), n(11), ['volume', 'betCount'], [n(3), n(1)], player);
    assert.fieldEquals('MarketDailyStat', '11-1', 'volume', '15');
    assert.fieldEquals('MarketAccountingStat', 'hour-277-1', 'uniquePlayers', '1');
    assert.fieldEquals('MarketAccountingStat', 'total-1', 'betCount', '2');
    const other = new Market('2');
    recordMarketAccounting(other, 'a', n(1000000), n(10), ['volume'], [n(500)]);
    assert.fieldEquals('MarketAccountingStat', 'total-2', 'volume', '500');
    assert.fieldEquals('MarketAccountingStat', 'total-1', 'volume', '15');
  });

  test('Losses remain signed and day boundaries preserve lifetime totals', () => {
    const market = Market.load('1')!;
    recordMarketAccounting(market, 'a', n(1036799), n(10), ['netRevenue', 'losses'], [n(-20), n(20)]);
    recordMarketAccounting(market, 'b', n(1036800), n(11), ['netRevenue', 'revenue'], [n(8), n(8)]);
    assert.fieldEquals('MarketDailyStat', '11-1', 'netRevenue', '-20');
    assert.fieldEquals('MarketDailyStat', '12-1', 'netRevenue', '8');
    assert.fieldEquals('MarketAccountingStat', 'total-1', 'netRevenue', '-12');
    assert.fieldEquals('MarketAccountingStat', 'total-1', 'losses', '20');
  });

  test('Annualization uses elapsed time and treats zero assets as a loss', () => {
    assert.stringEquals(observedApr(n(110), n(100), n(100), n(100), n(1), n(31536001))!.toString(), '10');
    assert.stringEquals(observedApr(n(0), n(100), n(100), n(100), n(1), n(31536001))!.toString(), '-100');
    assert.assertTrue(observedApr(n(100), n(0), n(100), n(100), n(1), n(2)) === null);
  });

  test('Missing windows are not replaced by lifetime performance', () => {
    const market = Market.load('1')!;
    recordMarketReturns(market, n(1000000), n(12));
    assert.fieldEquals('MarketReturnObservation', '1', 'calculationVersion', '2');
    assert.fieldEquals('MarketReturnObservation', '1', 'methodology', 'SIMPLE_ANNUALIZED_SHARE_PRICE_CHANGE');
  });
});
