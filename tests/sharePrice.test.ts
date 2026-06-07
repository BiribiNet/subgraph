import { BigInt } from '@graphprotocol/graph-ts';
import { assert, describe, test } from 'matchstick-as';

import { calculateSharePrice } from '../src/helpers/globalState';

describe('calculateSharePrice', () => {
  test('normalizes a 1:1 USDC (6-dec) vault to 1.0', () => {
    // 1000 USDC = 1e9 raw assets; 1000 shares * 1e18 = 1e21 raw shares (18-dec).
    const result = calculateSharePrice(
      BigInt.fromString('1000000000'),
      BigInt.fromString('1000000000000000000000'),
      6
    );
    assert.stringEquals(result.toString(), '1');
  });

  test('preserves 5% appreciation for a 6-dec asset', () => {
    // 1050 USDC of assets backing 1000 whole shares -> 1.05 per share.
    const result = calculateSharePrice(
      BigInt.fromString('1050000000'),
      BigInt.fromString('1000000000000000000000'),
      6
    );
    assert.stringEquals(result.toString(), '1.05');
  });

  test('is a no-op for an 18-dec asset (BRB)', () => {
    const result = calculateSharePrice(
      BigInt.fromString('1000000000000000000'),
      BigInt.fromString('1000000000000000000'),
      18
    );
    assert.stringEquals(result.toString(), '1');
  });

  test('returns 1 when the vault has no shares', () => {
    const result = calculateSharePrice(BigInt.fromString('500'), BigInt.zero(), 6);
    assert.stringEquals(result.toString(), '1');
  });
});
