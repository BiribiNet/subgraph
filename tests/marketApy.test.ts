import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';

import { Market } from '../generated/schema';
import {
  DEFAULT_USER,
  TEST_BANK,
  createRoundForTests,
  emitBetPlaced,
  emitBetsReleased,
  emitBrbTransfer,
  emitDeposit,
  emitFundsTransferred,
  emitPayoutBatchProcessed,
  emitSideBetStakeLocked,
} from './helpers';

const ONE_BRB = '1000000000000000000';
const TWO_BRB = '2000000000000000000';
const DEPOSIT_TS = 1_000_000; // UTC day 11
const ONE_DAY_LATER = 1_086_400; // UTC day 12
const TWO_DAYS_LATER = 1_172_800; // UTC day 13

describe('Market APY recalculation on vault yield events', () => {
  beforeEach(() => {
    clearStore();
    createRoundForTests(1, DEPOSIT_TS);
  });

  test('BetsReleased recomputes APY without deposits or withdrawals', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS);
    emitBetPlaced(ONE_BRB, DEPOSIT_TS + 100);
    // Round resolves two days later: locked liquidity released, share value 1.0 -> 2.0
    emitBetsReleased(ONE_BRB, '0', TWO_DAYS_LATER);

    // growth 1.0 annualized over 2 days: 1 * (31536000 / 172800) * 100 = 18250
    assert.fieldEquals('Market', '1', 'apyLifetime', '18250');
    assert.entityCount('MarketAPYSnapshot', 2);
  });

  test('PayoutBatchProcessed recomputes APY', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS);
    emitPayoutBatchProcessed('200000000000000000', ONE_DAY_LATER);

    // growth -0.2 annualized over 1 day: -0.2 * 365 * 100 = -7300
    assert.fieldEquals('Market', '1', 'apyLifetime', '-7300');
  });

  test('FundsTransferred recomputes APY', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS);
    emitFundsTransferred('200000000000000000', ONE_DAY_LATER);

    assert.fieldEquals('Market', '1', 'apyLifetime', '-7300');
  });

  test('SideBetStakeLocked recomputes APY', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS);
    // stake 1.0 added to gross, locked total 0.5 -> totalAssets 1.5, growth 0.5
    emitSideBetStakeLocked(
      DEFAULT_USER,
      ONE_BRB,
      '500000000000000000',
      '500000000000000000',
      ONE_DAY_LATER
    );

    assert.fieldEquals('Market', '1', 'apyLifetime', '18250');
  });

  test('BRB donation to the bank recomputes APY', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS);
    // Donation amount differs from the deposit so the same-tx exclusion does not absorb it
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), TWO_BRB, ONE_DAY_LATER);

    // share value 1.0 -> 3.0, growth 2.0 annualized over 1 day: 2 * 365 * 100 = 73000
    assert.fieldEquals('Market', '1', 'apyLifetime', '73000');
  });

  test('BetPlaced does not recompute APY or create snapshots', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS);
    emitBetPlaced(ONE_BRB, TWO_DAYS_LATER);

    assert.entityCount('MarketAPYSnapshot', 1);
    assert.fieldEquals('Market', '1', 'apyLifetime', '0');
  });

  test('Snapshot created for new UTC day even when under 24h since last snapshot', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, 1_033_200); // day 11, 23:00
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, 1_038_600, 1); // day 12, 00:30 (5400s later)

    assert.entityCount('MarketAPYSnapshot', 2);
  });

  test('7-day APY scans back when exact target-day snapshot is missing', () => {
    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS); // snapshot day 11, share value 1.0
    emitBetPlaced(ONE_BRB, 1_259_100);
    emitBetsReleased(ONE_BRB, '0', 1_259_200); // snapshot day 14, share value 2.0
    emitBetPlaced(ONE_BRB, 2_310_300);
    emitBetsReleased(ONE_BRB, '0', 2_310_400); // day 26 — 7-day target is day 19 (missing)

    // Scan-back lands on the day-14 snapshot: growth 0.5 over 1051200s
    // (= 31536000 / 30) -> 0.5 * 30 * 100 = 1500
    assert.fieldEquals('Market', '1', 'apy7Day', '1500');
  });

  test('Yield events before the first deposit do not set the lifetime baseline', () => {
    emitBrbTransfer(DEFAULT_USER, TEST_BANK.toHexString(), ONE_BRB, DEPOSIT_TS);

    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTimestamp', '0');
    assert.entityCount('MarketAPYSnapshot', 0);

    emitDeposit(DEFAULT_USER, ONE_BRB, ONE_BRB, DEPOSIT_TS + 100);

    const market = Market.load('1');
    assert.assertNotNull(market);
    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTimestamp', (DEPOSIT_TS + 100).toString());
    // Baseline captures donation + deposit assets against the minted shares
    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTotalAssets', TWO_BRB);
    assert.fieldEquals('Market', '1', 'apyLifetimeBaselineTotalShares', ONE_BRB);
  });
});
