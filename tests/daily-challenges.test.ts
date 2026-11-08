import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';

import { UserDailyChallenges } from '../generated/schema';
import {
  CHALLENGE_IDS,
  applyLegToDay,
  challengeIndexesForDay,
  challengeProgress,
  dailyChallengesId,
  getOrCreateDailyChallenges,
} from '../src/helpers/daily-challenges';
import { DEFAULT_USER } from './helpers';
import {
  BET_TIMESTAMP,
  DAY_SECONDS,
  ONE_TOKEN,
  TEN_TOKENS,
  emitMaskBet,
  emitVrf,
  encodeMask,
  maskLegIdOf,
  maskOf,
  setupMarketWithMinBet,
  statsId,
  userBytes,
} from './special-bet-helpers';

// Mêmes cas que docs/daily-challenges.json (vectors) et que le test frontend
// test/unit/daily-challenges.test.ts : toute divergence entre les deux dépôts casse l'un des deux.

function dayId(day: i32): string {
  return dailyChallengesId(userBytes(), day).toHexString();
}

function completionId(day: i32, challengeId: i32): string {
  return userBytes().concatI32(day).concatI32(challengeId).toHexString();
}

describe('Daily challenges — shared rotation vectors', () => {
  test('should rotate (dayIndex * 3 + slot) mod 8 like the frontend', () => {
    const days: i32[] = [0, 1, 2, 7, 8, 20765, 20766, 20767];
    const expected: i32[][] = [[1, 2, 3], [4, 5, 6], [7, 8, 1], [6, 7, 8], [1, 2, 3], [8, 1, 2], [3, 4, 5], [6, 7, 8]];
    for (let index = 0; index < days.length; index++) {
      const indexes = challengeIndexesForDay(days[index]);
      for (let slot = 0; slot < 3; slot++) {
        assert.i32Equals(CHALLENGE_IDS[indexes[slot]], expected[index][slot]);
      }
    }
  });
});

class VectorLeg {
  constructor(public round: i32, public preset: i32, public size: i32, public won: boolean, public minBet: boolean) {}
}

/** Progression des 8 défis du catalogue après ces jambes, comme `buildChallengeDayState` côté frontend. */
function progressAfter(legs: VectorLeg[]): i32[] {
  const state = getOrCreateDailyChallenges(userBytes(), 0);
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index];
    if (!leg.minBet) continue;
    applyLegToDay(state, BigInt.fromI32(leg.round), leg.preset, leg.size, leg.won);
  }
  const progress = new Array<i32>();
  for (let index = 0; index < CHALLENGE_IDS.length; index++) progress.push(challengeProgress(index, state));
  return progress;
}

function assertProgress(actual: i32[], expected: i32[]): void {
  for (let index = 0; index < expected.length; index++) assert.i32Equals(actual[index], expected[index]);
}

describe('Daily challenges — shared evaluation vectors', () => {
  beforeEach(() => {
    clearStore();
  });

  test('should count three different winning presets, free selection once', () => {
    assertProgress(
      progressAfter([
        new VectorLeg(1, 1, 11, true, true),
        new VectorLeg(1, 1, 11, true, true),
        new VectorLeg(2, 20, 3, true, true),
        new VectorLeg(3, 0, 10, true, true),
        new VectorLeg(3, 0, 8, true, true),
      ]),
      [3, 0, 0, 3, 1, 1, 5, 0]
    );
  });

  test('should never count bets below the minimum stake', () => {
    assertProgress(
      progressAfter([new VectorLeg(1, 42, 5, true, false), new VectorLeg(2, 0, 2, true, false), new VectorLeg(3, 1, 11, true, false)]),
      [0, 0, 0, 0, 0, 0, 0, 0]
    );
  });

  test('should require a winning free selection of five numbers or fewer', () => {
    assertProgress(
      progressAfter([new VectorLeg(1, 0, 5, false, true), new VectorLeg(1, 0, 6, true, true), new VectorLeg(2, 0, 5, true, true)]),
      [1, 0, 1, 2, 0, 0, 3, 0]
    );
  });

  test('should validate previous-draw wins and keep the neighbours family to 42 and 48', () => {
    assertProgress(
      progressAfter([new VectorLeg(4, 45, 3, true, true), new VectorLeg(5, 48, 7, false, true), new VectorLeg(6, 47, 18, true, true)]),
      [2, 1, 0, 3, 0, 0, 3, 0]
    );
  });

  test('should validate two challenges with one neighbours win and count losses only as plays', () => {
    assertProgress(
      progressAfter([new VectorLeg(7, 42, 5, true, true), new VectorLeg(7, 12, 9, false, true), new VectorLeg(7, 25, 4, false, true)]),
      [1, 1, 0, 1, 0, 0, 3, 1]
    );
  });

  test('should report no progress without legs', () => {
    assertProgress(progressAfter([]), [0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Daily challenges on settlement', () => {
  beforeEach(() => {
    clearStore();
    setupMarketWithMinBet();
  });

  test('should award 10 points once per challenge and feed brbpPoints, tier and the daily snapshot', () => {
    const day = BET_TIMESTAMP / DAY_SECONDS;
    // Défi 2 (pari lié au tirage précédent gagné) et défi 3 (Sélection libre <= 5 numéros gagnée).
    emitMaskBet(encodeMask(maskOf([7, 17, 27]), 45, true, 17), TEN_TOKENS, 1, 0);
    emitMaskBet(encodeMask(maskOf([7, 8]), 0, false, 0), TEN_TOKENS, 1, 1);
    emitVrf(1, 7);
    assert.fieldEquals('DailyChallengeCompletion', completionId(day, 2), 'points', '10');
    assert.fieldEquals('DailyChallengeCompletion', completionId(day, 3), 'points', '10');
    assert.entityCount('DailyChallengeCompletion', 2);
    assert.fieldEquals('User', DEFAULT_USER, 'challengePoints', '20');
    assert.fieldEquals('User', DEFAULT_USER, 'challengeCount', '2');
    // 20 wagered × 3 + 20 challenge points.
    assert.fieldEquals('User', DEFAULT_USER, 'brbpPoints', '80');
    assert.fieldEquals('User', DEFAULT_USER, 'tier', 'BRONZE');
    assert.fieldEquals('UserDailyChallenges', dayId(day), 'challengeIds', '[2, 3, 4]');
    assert.fieldEquals('UserDailyChallenges', dayId(day), 'progress', '[1, 1, 1]');
    assert.fieldEquals('UserDailyChallenges', dayId(day), 'completed', '[true, true, false]');
    assert.fieldEquals('UserDailyChallenges', dayId(day), 'points', '20');
    const snapshotId = userBytes().concat(Bytes.fromI32(day)).toHexString();
    assert.fieldEquals('UserDailyPoints', snapshotId, 'pointsAtEndOfDay', '80');

    // Même jour, même défi gagné à nouveau : aucune nouvelle validation.
    emitMaskBet(encodeMask(maskOf([7, 17, 27]), 45, true, 17), TEN_TOKENS, 2, 0);
    emitVrf(2, 17);
    assert.entityCount('DailyChallengeCompletion', 2);
    assert.fieldEquals('User', DEFAULT_USER, 'challengePoints', '20');

    // Troisième tour distinct : défi 4 validé → 30 points, le plafond du jour.
    emitMaskBet(encodeMask(maskOf([7, 8]), 0, false, 0), TEN_TOKENS, 3, 0);
    emitVrf(3, 30);
    assert.fieldEquals('User', DEFAULT_USER, 'challengePoints', '30');
    assert.fieldEquals('UserDailyChallenges', dayId(day), 'completed', '[true, true, true]');
    assert.fieldEquals('UserDailyChallenges', dayId(day), 'points', '30');
  });

  test('should ignore legs below the market minimum bet', () => {
    emitMaskBet(encodeMask(maskOf([7, 8]), 0, false, 0), ONE_TOKEN, 1, 0);
    emitVrf(1, 7);
    assert.fieldEquals('RouletteMaskLeg', maskLegIdOf(1, 0), 'meetsMinBet', 'false');
    assert.entityCount('DailyChallengeCompletion', 0);
    assert.entityCount('UserDailyChallenges', 0);
    assert.fieldEquals('User', DEFAULT_USER, 'challengePoints', '0');
    // Les stats, elles, comptent tous les paris réels.
    assert.fieldEquals('UserSpecialBetStats', statsId(0), 'winCount', '1');
  });

  test('should attribute a leg to its placement day, even when settled after midnight', () => {
    const lateTimestamp = 12 * DAY_SECONDS - 1;
    emitMaskBet(encodeMask(maskOf([7, 8]), 0, false, 0), TEN_TOKENS, 1, 0, lateTimestamp);
    emitVrf(1, 7);
    assert.entityCount('UserDailyChallenges', 1);
    assert.fieldEquals('UserDailyChallenges', dayId(11), 'legCount', '1');
  });

  test('should not award a challenge twice when VRFResult is replayed', () => {
    emitMaskBet(encodeMask(maskOf([7, 8]), 0, false, 0), TEN_TOKENS, 1, 0);
    emitVrf(1, 7);
    emitVrf(1, 7);
    assert.fieldEquals('User', DEFAULT_USER, 'challengePoints', '10');
    assert.entityCount('DailyChallengeCompletion', 1);
    const state = UserDailyChallenges.load(dailyChallengesId(userBytes(), 11))!;
    assert.i32Equals(state.legCount, 1);
  });
});
