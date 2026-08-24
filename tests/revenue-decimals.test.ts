import { BigInt } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';

import { Market } from '../generated/schema';
import { updateRoundRevenueAggregates } from '../src/helpers/aggregation';
import { GLOBAL_STATE_ID, createRoundForTests, testRoundId } from './helpers';

const TIMESTAMP = 1_000_000;
const DAY_ID = (TIMESTAMP / 86400).toString();

/** 1 unit of a 6-decimal asset (USDC) and of an 18-decimal one — same economic value. */
const ONE_USDC = '1000000';
const ONE_18DEC = '1000000000000000000';

/**
 * `RouletteRound` totals are in the market's own units, which is correct — one round, one asset.
 * `DailyStat` and `GlobalState` are cross-market singletons, so anything landing there has to be
 * normalized to 18 decimals the way `totalWagered` already is, or a USDC round contributes 10^12
 * times too little next to a BRB one and every RTP / house-profit figure built on the pair is junk.
 */
function resolveRoundWithRevenue(
  globalRound: i32,
  assetDecimals: i32,
  totalBets: string,
  jackpotRevenue: string,
  infraRevenue: string
): void {
  const round = createRoundForTests(globalRound, TIMESTAMP);

  const market = Market.load(round.market);
  if (market == null) {
    throw new Error('market missing');
  }
  market.assetDecimals = assetDecimals;
  market.save();

  round.totalBets = BigInt.fromString(totalBets);
  round.totalPayouts = BigInt.zero();
  round.jackpotRevenue = BigInt.fromString(jackpotRevenue);
  round.infraRevenue = BigInt.fromString(infraRevenue);
  round.save();

  updateRoundRevenueAggregates(round, BigInt.fromI32(TIMESTAMP));
}

describe('Cross-market revenue is decimal-normalized', () => {
  beforeEach(() => {
    clearStore();
  });

  test('a 6-decimal market contributes revenue scaled to 18 decimals', () => {
    // 1 USDC wagered, no payouts: 0.025 to jackpot, 0.02 to infra, 0.955 to stakers.
    resolveRoundWithRevenue(7, 6, ONE_USDC, '25000', '20000');

    assert.fieldEquals('DailyStat', DAY_ID, 'revenue', ONE_18DEC);
    assert.fieldEquals('DailyStat', DAY_ID, 'stakersRevenue', '955000000000000000');
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalStakerRevenue', '955000000000000000');
  });

  test('the round itself keeps the market asset units', () => {
    resolveRoundWithRevenue(7, 6, ONE_USDC, '25000', '20000');

    // Untouched: a single round never mixes assets, so scaling it would only lose information.
    assert.fieldEquals('RouletteRound', testRoundId(7), 'stakersRevenue', '955000');
  });

  test('an 18-decimal market of equal value contributes the same amount', () => {
    resolveRoundWithRevenue(7, 18, ONE_18DEC, '25000000000000000', '20000000000000000');

    assert.fieldEquals('DailyStat', DAY_ID, 'revenue', ONE_18DEC);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalStakerRevenue', '955000000000000000');
  });
});
