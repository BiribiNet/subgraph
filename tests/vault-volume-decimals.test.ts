import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';

import {
  GLOBAL_STATE_ID,
  TEST_BANK_2,
  emitBetRecorded,
  emitDeposit,
  emitWithdrawalProcessed,
  encodeBetRecordedData,
  setupSecondTestMarket,
} from './helpers';

const TIMESTAMP = 1_000_000;
const DAY_ID = (TIMESTAMP / 86400).toString();
const HOUR_ID = (TIMESTAMP / 3600).toString();

/** 1 unit of a 6-decimal asset (USDC) and of an 18-decimal one — same economic value. */
const ONE_USDC = '1000000';
const ONE_18DEC = '1000000000000000000';

const PLAYER = '0x0000000000000000000000000000000000000a11';
const OTHER_PLAYER = '0x0000000000000000000000000000000000000b22';

/**
 * `Market` totals stay in the market's own units — one vault, one asset.
 * `DailyStat` and `HourlyVolumeSnapshot` are cross-market singletons, so what
 * lands there is normalized to 18 decimals the way `volume` and `revenue`
 * already are. Raw, a 6-decimal deposit counted 10^12 times too small beside
 * an 18-decimal one.
 */
describe('Cross-market vault volumes are decimal-normalized', () => {
  beforeEach(() => {
    clearStore();
  });

  test('a 6-decimal deposit reaches the daily and hourly aggregates as 18 decimals', () => {
    setupSecondTestMarket(6);

    emitDeposit(PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 0, TEST_BANK_2);

    assert.fieldEquals('DailyStat', DAY_ID, 'depositVolume', ONE_18DEC);
    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'depositVolume', ONE_18DEC);
  });

  test('the per-market deposit total keeps the market asset units', () => {
    setupSecondTestMarket(6);

    emitDeposit(PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 0, TEST_BANK_2);

    assert.fieldEquals('Market', '2', 'totalDepositVolume', ONE_USDC);
  });

  test('a 6-decimal withdrawal reaches the daily and hourly aggregates as 18 decimals', () => {
    setupSecondTestMarket(6);
    emitDeposit(PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 0, TEST_BANK_2);

    emitWithdrawalProcessed(
      PLAYER, 10_000, PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 1, TEST_BANK_2,
    );

    assert.fieldEquals('DailyStat', DAY_ID, 'withdrawalVolume', ONE_18DEC);
    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'withdrawalVolume', ONE_18DEC);
  });

  test('the all-time GlobalState totals are normalized too', () => {
    // Same quantity as depositVolume at all-time scope, and it feeds the
    // infrastructure overview card; leaving it raw would have made the two
    // scopes disagree.
    setupSecondTestMarket(6);

    emitDeposit(PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 0, TEST_BANK_2);
    emitWithdrawalProcessed(
      PLAYER, 10_000, PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 1, TEST_BANK_2,
    );

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalDeposited', ONE_18DEC);
    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'totalWithdrawn', ONE_18DEC);
  });

  test('the per-asset-class totals keep the market asset units', () => {
    // `addVaultDepositTotals` splits BRB from stable precisely so nothing mixes
    // there — those must NOT be normalized.
    setupSecondTestMarket(6);

    emitDeposit(PLAYER, ONE_USDC, ONE_USDC, TIMESTAMP, 0, TEST_BANK_2);

    assert.fieldEquals('GlobalState', GLOBAL_STATE_ID, 'stableVaultTotalDeposits', ONE_USDC);
  });

  test('an 18-decimal deposit is unchanged by normalization', () => {
    setupSecondTestMarket(18);

    emitDeposit(PLAYER, ONE_18DEC, ONE_18DEC, TIMESTAMP, 0, TEST_BANK_2);

    assert.fieldEquals('DailyStat', DAY_ID, 'depositVolume', ONE_18DEC);
  });
});

/**
 * The hourly snapshot only ever received payouts and vault flows: `volume`,
 * `betCount` and `uniquePlayers` were initialised to zero and never written,
 * and `trackHourlyUniquePlayer` had no caller at all, so the 48h activity
 * series read as a flat line however much was wagered.
 */
describe('Hourly snapshot records betting activity', () => {
  beforeEach(() => {
    clearStore();
  });

  test('a bet increments hourly volume, bet count and unique players', () => {
    emitBetRecorded(PLAYER, ONE_18DEC, encodeBetRecordedData(ONE_18DEC, 1, 7), 1);

    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'volume', ONE_18DEC);
    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'betCount', '1');
    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'uniquePlayers', '1');
  });

  test('the same player betting twice counts once in unique players', () => {
    emitBetRecorded(PLAYER, ONE_18DEC, encodeBetRecordedData(ONE_18DEC, 1, 7), 1);
    emitBetRecorded(PLAYER, ONE_18DEC, encodeBetRecordedData(ONE_18DEC, 1, 8), 2, 1, TIMESTAMP, 1);

    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'betCount', '2');
    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'uniquePlayers', '1');
  });

  test('a second player is counted separately', () => {
    emitBetRecorded(PLAYER, ONE_18DEC, encodeBetRecordedData(ONE_18DEC, 1, 7), 1);
    emitBetRecorded(OTHER_PLAYER, ONE_18DEC, encodeBetRecordedData(ONE_18DEC, 1, 9), 1, 1, TIMESTAMP, 2);

    assert.fieldEquals('HourlyVolumeSnapshot', HOUR_ID, 'uniquePlayers', '2');
  });
});
