import { BigInt } from '@graphprotocol/graph-ts';
import { assert, describe, test } from 'matchstick-as';

import { calculateSharePrice } from '../src/helpers/globalState';

// BankVault4626 shares carry the ERC-4626 decimal offset: share decimals =
// asset decimals + 6 (verified on-chain: USDC bank = 12, DAI/BRB banks = 24).
describe('calculateSharePrice', () => {
  test('normalizes a 1:1 USDC (6-dec asset, 12-dec shares) vault to 1.0', () => {
    // 1000 USDC = 1e9 raw assets; 1000 whole shares = 1e15 raw shares (12-dec).
    const result = calculateSharePrice(
      BigInt.fromString('1000000000'),
      BigInt.fromString('1000000000000000'),
      6
    );
    assert.stringEquals(result.toString(), '1');
  });

  test('preserves 5% appreciation for a 6-dec asset', () => {
    // 1050 USDC of assets backing 1000 whole shares -> 1.05 per share.
    const result = calculateSharePrice(
      BigInt.fromString('1050000000'),
      BigInt.fromString('1000000000000000'),
      6
    );
    assert.stringEquals(result.toString(), '1.05');
  });

  test('normalizes a 1:1 vault for an 18-dec asset (BRB, 24-dec shares)', () => {
    // 1 BRB = 1e18 raw assets; 1 whole share = 1e24 raw shares (24-dec).
    const result = calculateSharePrice(
      BigInt.fromString('1000000000000000000'),
      BigInt.fromString('1000000000000000000000000'),
      18
    );
    assert.stringEquals(result.toString(), '1');
  });

  test('matches the live DAI vault state (regression for the 18-dec assumption)', () => {
    // Arbitrum Sepolia DAI bank snapshot: 62 942.5 DAI backing 50 000 whole
    // shares -> 1.25885 per share. The old fixed-18-dec formula returned
    // 0.00000125885 for this exact state.
    const result = calculateSharePrice(
      BigInt.fromString('62942500000000000000000'),
      BigInt.fromString('50000000000000000000000000000'),
      18
    );
    assert.stringEquals(result.toString(), '1.25885');
  });

  test('returns 1 when the vault has no shares', () => {
    const result = calculateSharePrice(BigInt.fromString('500'), BigInt.zero(), 6);
    assert.stringEquals(result.toString(), '1');
  });
});
