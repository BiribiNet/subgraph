import { Address, BigInt } from '@graphprotocol/graph-ts';
import {
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from 'matchstick-as';

import {
  updateUserWageredStats,
  updateUserStakingStats,
  updateUserBrbrEarnings,
  updateUserRouletteStats,
} from '../src/helpers/user';
import { computeTier } from '../src/helpers/brb-points';

const USER_A = '0xaaaa000000000000000000000000000000000001';
const USER_B = '0xbbbb000000000000000000000000000000000002';

const ONE_BRB = '1000000000000000000'; // 1e18 (18 decimals)
const ONE_USDC = '1000000'; // 1e6 (6 decimals)
const TS = BigInt.fromI32(1000000);

function addr(value: string): Address {
  return Address.fromString(value);
}

function bi(value: string): BigInt {
  return BigInt.fromString(value);
}

describe('BRBpoints wagered component', () => {
  beforeEach(() => {
    clearStore();
  });

  test('credits the wagered component (x3) at bet time', () => {
    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, true, TS);

    assert.fieldEquals('User', USER_A, 'totalRouletteBets', ONE_BRB);
    // points = (1e18 * 3) / 1e18 = 3
    assert.fieldEquals('User', USER_A, 'brbpPoints', '3');
    assert.fieldEquals('User', USER_A, 'tier', 'BRONZE');
    assert.fieldEquals('User', USER_A, 'betCount', '1');
    assert.fieldEquals('User', USER_A, 'totalLost', ONE_BRB);
  });

  test('counts 1 USDC and 1 BRB equally after decimals normalization', () => {
    updateUserWageredStats(addr(USER_A), bi(ONE_USDC), 6, true, TS); // 1 USDC
    updateUserWageredStats(addr(USER_B), bi(ONE_BRB), 18, true, TS); // 1 BRB

    // 1 USDC (1e6, 6 dec) normalizes to 1e18 → same as 1 BRB
    assert.fieldEquals('User', USER_A, 'totalRouletteBets', ONE_BRB);
    assert.fieldEquals('User', USER_B, 'totalRouletteBets', ONE_BRB);
    assert.fieldEquals('User', USER_A, 'brbpPoints', '3');
    assert.fieldEquals('User', USER_B, 'brbpPoints', '3');
  });

  test('betCount counts distinct rounds, not individual bets', () => {
    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, true, TS); // new round
    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, false, TS); // same round

    assert.fieldEquals('User', USER_A, 'betCount', '1');
    assert.fieldEquals('User', USER_A, 'totalRouletteBets', '2000000000000000000');
  });

  test('combines wagered + staked + referral with their weights', () => {
    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, true, TS); // x3 → 3
    updateUserStakingStats(addr(USER_A), bi(ONE_BRB), true, TS); // x1 → 1
    updateUserBrbrEarnings(addr(USER_A), bi(ONE_BRB), true, TS); // x2 → 2

    // points = (1e18*3 + 1e18*1 + 1e18*2) / 1e18 = 6
    assert.fieldEquals('User', USER_A, 'brbpPoints', '6');
  });

  test('crosses into SILVER tier at >= 500 points', () => {
    // 200 BRB wagered → (200e18 * 3) / 1e18 = 600 points
    updateUserWageredStats(addr(USER_A), bi('200000000000000000000'), 18, true, TS);

    assert.fieldEquals('User', USER_A, 'brbpPoints', '600');
    assert.fieldEquals('User', USER_A, 'tier', 'SILVER');
  });

  test('payouts update wins without inflating wagered points', () => {
    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, true, TS); // points = 3
    updateUserRouletteStats(addr(USER_A), bi('500000000000000000'), 18, true, true, TS); // win 0.5 BRB

    assert.fieldEquals('User', USER_A, 'totalWon', '500000000000000000');
    assert.fieldEquals('User', USER_A, 'winCount', '1');
    assert.fieldEquals('User', USER_A, 'totalLost', '500000000000000000');
    // wagered (and thus points) unchanged by a payout
    assert.fieldEquals('User', USER_A, 'totalRouletteBets', ONE_BRB);
    assert.fieldEquals('User', USER_A, 'brbpPoints', '3');
  });
});

describe('computeTier thresholds', () => {
  test('maps points to the correct tier boundary', () => {
    assert.stringEquals(computeTier(BigInt.fromI32(0)), 'BRONZE');
    assert.stringEquals(computeTier(BigInt.fromI32(499)), 'BRONZE');
    assert.stringEquals(computeTier(BigInt.fromI32(500)), 'SILVER');
    assert.stringEquals(computeTier(BigInt.fromI32(1999)), 'SILVER');
    assert.stringEquals(computeTier(BigInt.fromI32(2000)), 'GOLD');
    assert.stringEquals(computeTier(BigInt.fromI32(5000)), 'PLATINUM');
    assert.stringEquals(computeTier(BigInt.fromI32(15000)), 'DIAMOND');
    assert.stringEquals(computeTier(BigInt.fromI32(50000)), 'LEGEND');
  });
});

describe('UserDailyPoints snapshots', () => {
  beforeEach(() => {
    clearStore();
  });

  test('upserts one row per day and adds a new row on a new day', () => {
    const day1 = BigInt.fromI32(86400); // day 1
    const day1Later = BigInt.fromI32(86400 + 3600); // still day 1
    const day2 = BigInt.fromI32(86400 * 2); // day 2

    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, true, day1);
    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, false, day1Later);
    // Two updates on the same day → a single (upserted) snapshot.
    assert.entityCount('UserDailyPoints', 1);

    updateUserWageredStats(addr(USER_A), bi(ONE_BRB), 18, false, day2);
    // A new day → a new snapshot row.
    assert.entityCount('UserDailyPoints', 2);
  });
});
