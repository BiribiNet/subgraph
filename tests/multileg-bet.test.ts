import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { assert, beforeEach, clearStore, describe, test } from 'matchstick-as';

import { DEFAULT_USER, emitBetRecorded, setupTestMarket, testRoundId } from './helpers';

function encodeMultiLegBetData(): Bytes {
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1), BigInt.fromI32(8)]),
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(7), BigInt.fromI32(0)]),
        ethereum.Value.fromUnsignedBigIntArray([
          BigInt.fromString('10000000000000000000'),
          BigInt.fromString('5000000000000000000'),
        ]),
      ])
    )
  );
  return encoded ? encoded : Bytes.empty();
}

// A straight leg on an out-of-range number (99) alongside a valid straight leg on 7.
// `number` comes from unvalidated betData; pre-L-3-fix, indexing straightBetsTotals[99]
// (a 37-slot array) trapped the WASM mapping. It must now skip the bad leg and index the rest.
function encodeOutOfRangeStraightBetData(): Bytes {
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(
      changetype<ethereum.Tuple>([
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(1), BigInt.fromI32(1)]),
        ethereum.Value.fromUnsignedBigIntArray([BigInt.fromI32(99), BigInt.fromI32(7)]),
        ethereum.Value.fromUnsignedBigIntArray([
          BigInt.fromString('10000000000000000000'),
          BigInt.fromString('3000000000000000000'),
        ]),
      ])
    )
  );
  return encoded ? encoded : Bytes.empty();
}

describe('Multi-leg BetRecorded', () => {
  beforeEach(() => {
    clearStore();
    setupTestMarket();
  });

  test('indexes all legs into round exposure components', () => {
    emitBetRecorded(DEFAULT_USER, '15000000000000000000', encodeMultiLegBetData(), 1);

    assert.entityCount('RouletteBet', 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', '15000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxStraightBet', '10000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'redBetsSum', '5000000000000000000');
    assert.fieldEquals('User', DEFAULT_USER, 'totalRouletteBets', '15000000000000000000');
  });

  test('L-3: skips an out-of-range bet number without trapping the mapping', () => {
    emitBetRecorded(DEFAULT_USER, '13000000000000000000', encodeOutOfRangeStraightBetData(), 1);

    // No WASM trap: the bet is recorded, the out-of-range leg is skipped, and the valid straight
    // leg on 7 (3e18) is the only one that lands in the exposure bucket.
    assert.entityCount('RouletteBet', 1);
    assert.fieldEquals('RouletteRound', testRoundId(1), 'totalBets', '13000000000000000000');
    assert.fieldEquals('RouletteRound', testRoundId(1), 'maxStraightBet', '3000000000000000000');
  });
});
