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
});
