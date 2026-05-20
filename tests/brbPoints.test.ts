import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  assert,
  afterEach,
  clearStore,
  describe,
  test,
} from "matchstick-as";

import { User } from "../generated/schema";
import {
  computeBrbPoints,
  computeTier,
  getOrCreateBrbPointsConfig,
  recomputeAndSaveUserPoints,
} from "../src/helpers/brb-points";

const USER_ADDRESS = "0xbbbbedc42dc53842141be8f70df9efe4d08538a4";

const ONE_BRB = BigInt.fromI32(10).pow(18);
const TIMESTAMP = BigInt.fromI32(1_700_000_000);

function makeUser(
  wagered: BigInt,
  staked: BigInt,
  referral: BigInt,
): User {
  const user = new User(Address.fromString(USER_ADDRESS));
  user.brbBalance = BigInt.fromI32(0);
  user.sbrbBalance = BigInt.fromI32(0);
  user.brbReferalBalance = BigInt.fromI32(0);
  user.totalStaked = staked;
  user.totalUnstaked = BigInt.fromI32(0);
  user.cumulativeDepositValue = BigInt.fromI32(0);
  user.cumulativeDepositShares = BigInt.fromI32(0);
  user.totalRouletteBets = wagered;
  user.totalRouletteWins = BigInt.fromI32(0);
  user.netProfit = BigInt.fromI32(0);
  user.tier = "BRONZE";
  user.brbpPoints = BigInt.fromI32(0);
  user.firstSeenAt = BigInt.fromI32(0);
  user.lastActiveAt = BigInt.fromI32(0);
  user.totalWon = BigInt.fromI32(0);
  user.totalLost = BigInt.fromI32(0);
  user.winCount = BigInt.fromI32(0);
  user.betCount = BigInt.fromI32(0);
  user.totalBrbrEarned = referral;
  user.totalBrbrSpent = BigInt.fromI32(0);
  user.save();
  return user;
}

describe("getOrCreateBrbPointsConfig", () => {
  afterEach(() => {
    clearStore();
  });

  test("seeds defaults on first access", () => {
    const cfg = getOrCreateBrbPointsConfig(TIMESTAMP);
    assert.bigIntEquals(cfg.wageredWeight, BigInt.fromI32(3));
    assert.bigIntEquals(cfg.stakedWeight, BigInt.fromI32(1));
    assert.bigIntEquals(cfg.referralWeight, BigInt.fromI32(2));
    assert.bigIntEquals(cfg.divisor, ONE_BRB);
    assert.bigIntEquals(cfg.lastUpdatedAt, TIMESTAMP);
  });

  test("returns the same singleton on second access", () => {
    const cfg1 = getOrCreateBrbPointsConfig(TIMESTAMP);
    const cfg2 = getOrCreateBrbPointsConfig(BigInt.fromI32(999));
    assert.bytesEquals(cfg1.id, cfg2.id);
    assert.bigIntEquals(cfg2.lastUpdatedAt, TIMESTAMP);
  });
});

describe("computeBrbPoints", () => {
  afterEach(() => {
    clearStore();
  });

  test("returns weighted sum divided by divisor for a regular user", () => {
    const cfg = getOrCreateBrbPointsConfig(TIMESTAMP);
    // 1 BRB wagered (weight 3) + 1 BRB staked (weight 1) + 1 BRB referral (weight 2) = 6 points.
    const user = makeUser(ONE_BRB, ONE_BRB, ONE_BRB);
    assert.bigIntEquals(computeBrbPoints(user, cfg), BigInt.fromI32(6));
  });

  test("returns zero for a fresh user with zero inputs", () => {
    const cfg = getOrCreateBrbPointsConfig(TIMESTAMP);
    const user = makeUser(BigInt.fromI32(0), BigInt.fromI32(0), BigInt.fromI32(0));
    assert.bigIntEquals(computeBrbPoints(user, cfg), BigInt.fromI32(0));
  });

  test("returns zero when divisor is zero (safety branch)", () => {
    const cfg = getOrCreateBrbPointsConfig(TIMESTAMP);
    cfg.divisor = BigInt.fromI32(0);
    cfg.save();
    const user = makeUser(ONE_BRB, ONE_BRB, ONE_BRB);
    assert.bigIntEquals(computeBrbPoints(user, cfg), BigInt.fromI32(0));
  });

  test("only counts the wagered component when staked and referral are zero", () => {
    const cfg = getOrCreateBrbPointsConfig(TIMESTAMP);
    // 100 BRB wagered (weight 3) => 300 points.
    const user = makeUser(ONE_BRB.times(BigInt.fromI32(100)), BigInt.fromI32(0), BigInt.fromI32(0));
    assert.bigIntEquals(computeBrbPoints(user, cfg), BigInt.fromI32(300));
  });
});

describe("computeTier", () => {
  test("returns BRONZE below the silver threshold", () => {
    assert.stringEquals(computeTier(BigInt.fromI32(0)), "BRONZE");
    assert.stringEquals(computeTier(BigInt.fromI32(499)), "BRONZE");
  });

  test("returns SILVER between 500 and 1999", () => {
    assert.stringEquals(computeTier(BigInt.fromI32(500)), "SILVER");
    assert.stringEquals(computeTier(BigInt.fromI32(1999)), "SILVER");
  });

  test("returns GOLD between 2000 and 4999", () => {
    assert.stringEquals(computeTier(BigInt.fromI32(2000)), "GOLD");
    assert.stringEquals(computeTier(BigInt.fromI32(4999)), "GOLD");
  });

  test("returns PLATINUM between 5000 and 14999", () => {
    assert.stringEquals(computeTier(BigInt.fromI32(5000)), "PLATINUM");
    assert.stringEquals(computeTier(BigInt.fromI32(14_999)), "PLATINUM");
  });

  test("returns DIAMOND between 15000 and 49999", () => {
    assert.stringEquals(computeTier(BigInt.fromI32(15_000)), "DIAMOND");
    assert.stringEquals(computeTier(BigInt.fromI32(49_999)), "DIAMOND");
  });

  test("returns LEGEND at and above 50000", () => {
    assert.stringEquals(computeTier(BigInt.fromI32(50_000)), "LEGEND");
    assert.stringEquals(computeTier(BigInt.fromI32(1_000_000)), "LEGEND");
  });
});

describe("recomputeAndSaveUserPoints", () => {
  afterEach(() => {
    clearStore();
  });

  test("writes brbpPoints and tier on the user from the formula", () => {
    // 500 BRB wagered (weight 3) + 0 staked + 0 referral = 1500 points => GOLD.
    const user = makeUser(ONE_BRB.times(BigInt.fromI32(500)), BigInt.fromI32(0), BigInt.fromI32(0));
    recomputeAndSaveUserPoints(user, TIMESTAMP);
    const reloaded = User.load(user.id);
    if (reloaded == null) {
      throw new Error("user reload returned null");
    }
    assert.bigIntEquals(reloaded.brbpPoints, BigInt.fromI32(1500));
    assert.stringEquals(reloaded.tier, "GOLD");
  });
});
