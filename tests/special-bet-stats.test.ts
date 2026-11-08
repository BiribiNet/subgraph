import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';
import { BigInt } from '@graphprotocol/graph-ts';

import { canonicalPresetId, previousDrawPresetMask } from '../src/helpers/special-bet-presets';
import { ONE_TOKEN, TEN_TOKENS, emitMaskBet, emitVrf, encodeMask, maskOf, setupMarketWithMinBet, statsId } from './special-bet-helpers';

// Mêmes vecteurs que docs/daily-challenges.json (previousDrawPresets) et le test frontend.

/** `assert.assertNull` compare avec `!=`, surchargé par BigInt : l'identité `===` évite le piège. */
function isMissing(mask: BigInt | null): boolean {
  return mask === null;
}

describe('Special bet presets — canonical id', () => {
  test('should rebuild presets 45 to 50 like the shared vectors', () => {
    assert.bigIntEquals(previousDrawPresetMask(45, 17, 3)!, maskOf([7, 17, 27]));
    assert.bigIntEquals(previousDrawPresetMask(45, 0, 3)!, maskOf([10, 20, 30]));
    assert.bigIntEquals(previousDrawPresetMask(46, 17, 7)!, maskOf([6, 8, 16, 18, 26, 28, 36]));
    assert.bigIntEquals(previousDrawPresetMask(46, 0, 7)!, maskOf([1, 9, 11, 19, 21, 29, 31]));
    assert.bigIntEquals(previousDrawPresetMask(46, 9, 6)!, maskOf([8, 10, 18, 20, 28, 30]));
    assert.bigIntEquals(
      previousDrawPresetMask(47, 0, 18)!,
      maskOf([1, 5, 6, 8, 9, 10, 11, 13, 14, 16, 20, 23, 24, 27, 30, 31, 33, 36])
    );
    assert.bigIntEquals(
      previousDrawPresetMask(47, 17, 18)!,
      maskOf([1, 3, 5, 7, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 29, 31, 33, 35])
    );
    assert.bigIntEquals(previousDrawPresetMask(48, 0, 3)!, maskOf([0, 26, 32]));
    assert.bigIntEquals(previousDrawPresetMask(48, 17, 7)!, maskOf([2, 6, 17, 21, 25, 27, 34]));
    assert.bigIntEquals(
      previousDrawPresetMask(49, 18, 18)!,
      maskOf([2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35])
    );
    assert.bigIntEquals(
      previousDrawPresetMask(50, 17, 18)!,
      maskOf([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36])
    );
  });

  test('should give no mask for colour, dozen, opposite colour and parity when p = 0', () => {
    assert.assertTrue(isMissing(previousDrawPresetMask(43, 0, 18)));
    assert.assertTrue(isMissing(previousDrawPresetMask(44, 0, 12)));
    assert.assertTrue(isMissing(previousDrawPresetMask(49, 0, 18)));
    assert.assertTrue(isMissing(previousDrawPresetMask(50, 0, 18)));
  });

  test('should refuse an even size or N outside 1..17 for preset 48', () => {
    assert.assertTrue(isMissing(previousDrawPresetMask(48, 5, 6)));
    assert.assertTrue(!isMissing(previousDrawPresetMask(48, 5, 35)));
    assert.assertTrue(isMissing(previousDrawPresetMask(48, 5, 37)));
  });

  test('should keep a matching preset id and fall back to 0 for a mislabelled mask', () => {
    const prime = maskOf([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]);
    assert.i32Equals(canonicalPresetId(prime, 1, false, 0, 11), 1);
    assert.i32Equals(canonicalPresetId(maskOf([1, 2]), 1, false, 0, 2), 0);
    assert.i32Equals(canonicalPresetId(prime, 1, true, 4, 11), 0);
    assert.i32Equals(canonicalPresetId(maskOf([7, 17, 27]), 45, true, 17, 3), 45);
    assert.i32Equals(canonicalPresetId(maskOf([7, 17, 27]), 45, false, 0, 3), 0);
    assert.i32Equals(canonicalPresetId(maskOf([7, 17, 27]), 45, true, 18, 3), 0);
    assert.i32Equals(canonicalPresetId(maskOf([4, 21]), 300, false, 0, 2), 0);
  });
});

describe('Special bet stats on settlement', () => {
  beforeEach(() => {
    clearStore();
    setupMarketWithMinBet();
  });

  test('should aggregate settled legs per canonical preset, mislabelled masks as Sélection libre', () => {
    const sameEnding = encodeMask(maskOf([7, 17, 27]), 45, true, 17);
    emitMaskBet(sameEnding, TEN_TOKENS, 1, 0);
    emitMaskBet(encodeMask(maskOf([1, 2]), 1, false, 0), ONE_TOKEN, 1, 1);
    assert.entityCount('RouletteMaskLeg', 2);
    emitVrf(1, 7);
    assert.fieldEquals('UserSpecialBetStats', statsId(45), 'betCount', '1');
    assert.fieldEquals('UserSpecialBetStats', statsId(45), 'winCount', '1');
    assert.fieldEquals('UserSpecialBetStats', statsId(45), 'totalWagered', TEN_TOKENS);
    assert.fieldEquals('UserSpecialBetStats', statsId(45), 'totalWon', '120000000000000000000');
    assert.fieldEquals('UserSpecialBetStats', statsId(45), 'netResult', '110000000000000000000');
    // Étiquette « nombres premiers » sur {1, 2} : comptée en Sélection libre, perdante.
    assert.fieldEquals('UserSpecialBetStats', statsId(0), 'betCount', '1');
    assert.fieldEquals('UserSpecialBetStats', statsId(0), 'winCount', '0');
    assert.fieldEquals('UserSpecialBetStats', statsId(0), 'netResult', '-' + ONE_TOKEN);
  });


  test('should not count a leg twice when VRFResult is replayed', () => {
    emitMaskBet(encodeMask(maskOf([7, 8]), 0, false, 0), TEN_TOKENS, 1, 0);
    emitVrf(1, 7);
    emitVrf(1, 7);
    assert.fieldEquals('UserSpecialBetStats', statsId(0), 'betCount', '1');
    assert.fieldEquals('UserSpecialBetStats', statsId(0), 'totalWon', '180000000000000000000');
  });
});
